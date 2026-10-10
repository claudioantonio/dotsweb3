/** Notice poller cursor + findLateMove/awaitInput edge cases (mocked NodeRpc). */
import { encodeNotice, encodeRejected, utf8ToHex } from "@dotsweb3/protocol";
import { describe, expect, it, vi } from "vitest";
import { A, B, moveNotices, rejectedMatchEnded, started } from "../state/__fixtures__";
import { AwaitTimeout, awaitInput, findLateMove } from "./inputStatus";
import { NoticeStore, pollOnce } from "./notices";
import type { NodeRpc, RpcOutput, RpcReport } from "./rpc";

const out = (i: number, payload: string | null): RpcOutput => ({
  index: `0x${i.toString(16)}`,
  input_index: "0x0",
  raw_data: "0x",
  decoded_data: payload === null ? null : { type: "0xc258d6e5", payload },
});

function growingNode(outputs: RpcOutput[]) {
  const listOutputs = vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => ({
    data: outputs.slice(offset, offset + limit),
    pagination: { total_count: outputs.length, limit, offset },
  }));
  return { listOutputs };
}

describe("pollOnce cursor", () => {
  it("an output appended after a page was served is picked up by the next poll, not lost", async () => {
    const outputs = [out(0, encodeNotice(started)), out(1, encodeNotice(moveNotices[0]))];
    const node = growingNode(outputs);
    node.listOutputs.mockImplementationOnce(async ({ offset, limit }) => {
      const page = { data: outputs.slice(offset, offset + limit), pagination: { total_count: outputs.length, limit, offset } };
      outputs.push(out(2, encodeNotice(moveNotices[1])));
      return page;
    });
    const r = await pollOnce(node, 0, 2);
    expect(r.cursor).toBe(2);
    expect(r.notices.map((n) => n.type)).toEqual(["MatchStarted", "Move"]);
    const next = await pollOnce(node, r.cursor, 2);
    expect(next).toEqual({ notices: [moveNotices[1]], cursor: 3 });
  });

  it("skips null decoded_data, non-hex and non-notice JSON payloads but counts them in the cursor", async () => {
    const node = growingNode([out(0, null), out(1, "0xzz"), out(2, utf8ToHex('{"type":"Rejected"}')), out(3, encodeNotice(started))]);
    const r = await pollOnce(node, 0, 50);
    expect(r).toEqual({ notices: [started], cursor: 4 });
  });

  it("a cursor past the end (e.g. node reset) returns nothing and keeps the cursor", async () => {
    const r = await pollOnce(growingNode([out(0, encodeNotice(started))]), 5);
    expect(r).toEqual({ notices: [], cursor: 5 });
  });
});

describe("NoticeStore failure recovery", () => {
  it("a failed page does not advance the cursor: the next tick re-reads it, nothing lost or duplicated", async () => {
    const outputs = [out(0, encodeNotice(started))];
    const node = growingNode(outputs);
    const store = new NoticeStore(node, () => 1);
    await store.tick(); // tail = 1
    outputs.push(out(1, encodeNotice(moveNotices[0])), out(2, encodeNotice(moveNotices[1])));
    node.listOutputs.mockRejectedValueOnce(new Error("502"));
    await store.tick();
    expect(store.getSnapshot()).toMatchObject({ notices: [], lastError: "502" });
    await store.tick();
    expect(store.getSnapshot().notices).toEqual([moveNotices[0], moveNotices[1]]);
    expect(store.getSnapshot().lastError).toBeNull();
    await store.tick();
    expect(store.getSnapshot().notices).toHaveLength(2);
  });

  it("if the initial tail lookup fails it is retried, starting at the tail at recovery time", async () => {
    const outputs = [out(0, encodeNotice(started))];
    const node = growingNode(outputs);
    node.listOutputs.mockRejectedValueOnce(new Error("down"));
    const store = new NoticeStore(node, () => 1);
    await store.tick();
    expect(store.getSnapshot().lastError).toBe("down");
    await store.tick(); // tail = 1
    outputs.push(out(1, encodeNotice(moveNotices[0])));
    await store.tick();
    expect(store.getSnapshot().notices).toEqual([moveNotices[0]]);
  });
});

const rep = (inputIndex: number, raw: string, k: number): RpcReport => ({
  index: `0x${k.toString(16)}`,
  input_index: `0x${inputIndex.toString(16)}`,
  raw_data: raw,
});

function reportsNode(reports: RpcReport[], senders: Record<number, string>): NodeRpc {
  return {
    listOutputs: vi.fn(),
    getApplication: vi.fn(),
    getInput: vi.fn(async (i: number) => (i in senders ? { index: `0x${i.toString(16)}`, status: "ACCEPTED" as const, decoded_data: { sender: senders[i] } } : null)),
    listReports: vi.fn(async ({ offset = 0, limit = 50 }) => ({
      data: reports.slice(offset, offset + limit),
      pagination: { total_count: reports.length, limit, offset },
    })),
  };
}

describe("findLateMove attribution", () => {
  const raw = encodeRejected(rejectedMatchEnded); // move, match 1, MATCH_ENDED
  it("skips other matches, other codes, other senders and junk; matches a checksummed sender", async () => {
    const reports = [
      rep(1, encodeRejected({ ...rejectedMatchEnded, matchId: "2" }), 0),
      rep(2, encodeRejected({ ...rejectedMatchEnded, code: "NOT_YOUR_TURN" }), 1),
      rep(3, raw, 2), // B's late move
      rep(4, "0xdeadbeef", 3),
      rep(5, raw, 4), // A's late move (checksummed sender on the wire)
    ];
    const rpc = reportsNode(reports, { 1: A, 2: A, 3: B, 5: "0x" + A.slice(2).toUpperCase() });
    expect(await findLateMove(rpc, "1", A, 2)).toEqual(rejectedMatchEnded);
    expect(rpc.getInput).toHaveBeenCalledTimes(2); // only candidates (3, 5) are looked up
  });
  it("returns null on an empty report list", async () => {
    expect(await findLateMove(reportsNode([], {}), "1", A)).toBeNull();
  });
});

describe("awaitInput timing", () => {
  it("polls timeout/interval + 1 times before AwaitTimeout", async () => {
    const getInput = vi.fn(async () => null);
    const rpc = { getInput, listReports: vi.fn(), listOutputs: vi.fn(), getApplication: vi.fn() } as unknown as NodeRpc;
    await expect(awaitInput(rpc, 1, { intervalMs: 10, timeoutMs: 30, sleep: async () => {} })).rejects.toBeInstanceOf(AwaitTimeout);
    expect(getInput).toHaveBeenCalledTimes(4);
  });
  it("a transient getInput error is treated as not-yet-processed, not as failure", async () => {
    let n = 0;
    const rpc = {
      getInput: vi.fn(async () => {
        if (n++ === 0) throw new Error("network");
        return { index: "0x1", status: "ACCEPTED" as const };
      }),
      listReports: vi.fn(async () => ({ data: [], pagination: { total_count: 0, limit: 50, offset: 0 } })),
      listOutputs: vi.fn(),
      getApplication: vi.fn(),
    } as unknown as NodeRpc;
    expect(await awaitInput(rpc, 1, { sleep: async () => {} })).toEqual({ status: "APPLIED" });
  });
});
