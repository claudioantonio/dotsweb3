import { encodeNotice, utf8ToHex } from "@dotsweb3/protocol";
import { describe, expect, it, vi } from "vitest";
import { moveNotices, started } from "../state/__fixtures__";
import { NoticeStore, pollOnce } from "./notices";
import type { NodeRpc, RpcOutput } from "./rpc";

const out = (i: number, payload: string | null): RpcOutput => ({
  index: `0x${i.toString(16)}`,
  input_index: "0x0",
  raw_data: "0x",
  decoded_data: payload === null ? null : { type: "0xc258d6e5", payload },
});

/** Fake node with a growing output list. */
function fakeNode(outputs: RpcOutput[]) {
  const listOutputs = vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => ({
    data: outputs.slice(offset, offset + limit),
    pagination: { total_count: outputs.length, limit, offset },
  }));
  return { listOutputs } satisfies Pick<NodeRpc, "listOutputs">;
}

describe("pollOnce", () => {
  it("paginates from the cursor to the end and decodes notices", async () => {
    const outputs = [started, ...moveNotices].map((n, i) => out(i, encodeNotice(n)));
    const node = fakeNode(outputs);
    const res = await pollOnce(node, 1, 2);
    expect(res.cursor).toBe(5);
    expect(res.notices.map((n) => n.type)).toEqual(["Move", "Move", "Move", "Move"]);
    expect(node.listOutputs).toHaveBeenCalledTimes(2);
    expect(node.listOutputs.mock.calls.map((c) => c[0].offset)).toEqual([1, 3]);
  });

  it("skips foreign/undecodable outputs but still advances the cursor", async () => {
    const outputs = [out(0, utf8ToHex("hello")), out(1, null), out(2, "0xzz"), out(3, encodeNotice(started))];
    const res = await pollOnce(fakeNode(outputs), 0);
    expect(res.cursor).toBe(4);
    expect(res.notices).toEqual([started]);
  });

  it("returns the same cursor when nothing is new", async () => {
    const res = await pollOnce(fakeNode([out(0, encodeNotice(started))]), 1);
    expect(res).toEqual({ notices: [], cursor: 1 });
  });
});

describe("NoticeStore", () => {
  it("starts at the tail, then only delivers new notices", async () => {
    const outputs = [out(0, encodeNotice(started))];
    const store = new NoticeStore(fakeNode(outputs), () => 1000);
    const seen = vi.fn();
    store.subscribe(seen);
    await store.tick();
    expect(store.getSnapshot().notices).toEqual([]);
    expect(store.getSnapshot().lastOkAt).toBe(1000);
    outputs.push(out(1, encodeNotice(moveNotices[0])));
    await store.tick();
    expect(store.getSnapshot().notices).toEqual([moveNotices[0]]);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("records errors without losing notices", async () => {
    const store = new NoticeStore({ listOutputs: async () => Promise.reject(new Error("down")) });
    await store.tick();
    expect(store.getSnapshot()).toMatchObject({ lastError: "down", lastOkAt: null, notices: [] });
  });
});
