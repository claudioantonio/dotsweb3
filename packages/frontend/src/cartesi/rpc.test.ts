/**
 * createNodeRpc against the node's REAL JSON-RPC wire shapes. The fixtures
 * below are trimmed copies of responses captured from the local devnet
 * (cartesi CLI 2.0.0-alpha.35, rollups node 0.12.0-alpha.41, 2026-10-10):
 * list methods answer `{result: {data: [...], pagination}}` and — the
 * important part — single-object getters answer `{result: {data: {...}}}`.
 */
import { encodeRejected, utf8ToHex } from "@dotsweb3/protocol";
import { describe, expect, it, vi } from "vitest";
import { awaitInput, findLateMove } from "./inputStatus";
import { createNodeRpc, RpcError } from "./rpc";

const A = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

/** cartesi_getInput, input #12 (A's move that arrived after B's forfeit claim). */
const getInputResult = {
  data: {
    epoch_index: "0x0",
    index: "0xc",
    block_number: "0x56",
    raw_data: "0x415bf363",
    decoded_data: {
      chain_id: "0x7a69",
      application_contract: "0x30733caea2758e71be90813313efb0eb735eb600",
      sender: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // checksum case on the wire
      block_number: "0x56",
      block_timestamp: "0x6aca19f6",
      prev_randao: "0x00",
      index: "0xc",
      payload: "0x7b7d",
    },
    status: "ACCEPTED",
    machine_hash: null,
    outputs_hash: null,
    transaction_reference: "0x0c",
  },
};

/** cartesi_getApplication. */
const getApplicationResult = {
  data: { name: "machine", iapplication_address: "0x30733caea2758e71be90813313efb0eb735eb600", enabled: true, status: "OK", reason: null },
};

const lateMoveReport = encodeRejected({
  type: "Rejected",
  action: "move",
  matchId: "2",
  code: "MATCH_ENDED",
  message: "match 2 has already ended",
});

/** cartesi_listReports. */
const listReportsResult = (inputIndex?: string) => {
  const all = [
    { epoch_index: "0x0", input_index: "0xa", index: "0x1", raw_data: encodeRejected({ type: "Rejected", action: "claimForfeit", matchId: "2", code: "DEADLINE_NOT_ELAPSED", message: "" }) },
    { epoch_index: "0x0", input_index: "0xc", index: "0x2", raw_data: lateMoveReport },
  ].filter((r) => inputIndex === undefined || r.input_index === inputIndex);
  return { data: all, pagination: { total_count: all.length, limit: 50, offset: 0 } };
};

/** fetch stub speaking the node's JSON-RPC dialect. */
function nodeFetch(overrides: Record<string, unknown> = {}) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: Record<string, unknown> };
    calls.push({ method: body.method, params: body.params });
    let result: unknown;
    if (body.method in overrides) result = overrides[body.method];
    else if (body.method === "cartesi_getInput") {
      if (body.params.input_index !== "0xc") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32001, message: "Input not found" } }));
      }
      result = getInputResult;
    } else if (body.method === "cartesi_getApplication") result = getApplicationResult;
    else if (body.method === "cartesi_listReports") result = listReportsResult(body.params.input_index as string | undefined);
    else if (body.method === "cartesi_listOutputs") result = { data: [], pagination: { total_count: 0, limit: 50, offset: 0 } };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

describe("createNodeRpc request encoding", () => {
  it("sends application + hex input_index, offset/limit as numbers", async () => {
    const { fetchFn, calls } = nodeFetch();
    const rpc = createNodeRpc("http://node/rpc", "machine", fetchFn);
    await rpc.listReports({ inputIndex: 12 });
    await rpc.listOutputs({ offset: 3, limit: 7 });
    expect(calls[0]).toEqual({ method: "cartesi_listReports", params: { application: "machine", input_index: "0xc", offset: 0, limit: 50 } });
    expect(calls[1]).toEqual({ method: "cartesi_listOutputs", params: { application: "machine", offset: 3, limit: 7 } });
  });

  it("maps the node's -32001 'Input not found' to null", async () => {
    const { fetchFn } = nodeFetch();
    expect(await createNodeRpc("http://node/rpc", "machine", fetchFn).getInput(99)).toBeNull();
  });

  it("surfaces HTTP and other JSON-RPC errors as RpcError", async () => {
    const http = vi.fn(async () => new Response("nope", { status: 502 })) as unknown as typeof fetch;
    await expect(createNodeRpc("http://node/rpc", "machine", http).listOutputs({ offset: 0, limit: 1 })).rejects.toBeInstanceOf(RpcError);
    const rpcErr = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "db" } }))) as unknown as typeof fetch;
    await expect(createNodeRpc("http://node/rpc", "machine", rpcErr).getInput(1)).rejects.toMatchObject({ code: -32000 });
  });

  it("list methods return the {data, pagination} page as-is", async () => {
    const { fetchFn } = nodeFetch();
    const page = await createNodeRpc("http://node/rpc", "machine", fetchFn).listReports({ inputIndex: 12 });
    expect(page.pagination.total_count).toBe(1);
    expect(page.data[0].raw_data).toBe(lateMoveReport);
  });
});

describe("single-object getters against the real node shape {result: {data: {...}}}", () => {
  // Regression (fixed): createNodeRpc returns `body.result` verbatim, but cartesi_getInput /
  // cartesi_getApplication wrap the object in `data` (verified on devnet).
  // So `input.status` is undefined → treated as "NONE" forever.
  it("getInput exposes status and decoded_data.sender", async () => {
    const { fetchFn } = nodeFetch();
    const input = await createNodeRpc("http://node/rpc", "machine", fetchFn).getInput(12);
    expect(input?.status).toBe("ACCEPTED");
    expect(input?.decoded_data?.sender.toLowerCase()).toBe(A);
  });

  // Regression (fixed): same root cause — every processed input times out (AwaitTimeout after
  // 120 s in production) instead of resolving APPLIED/DECLINED, so the UI never
  // shows a rejection reason and the match screen's pending state never clears
  // via the outcome. Reproduced live against the devnet.
  it("awaitInput resolves an already-processed declined input", async () => {
    const { fetchFn } = nodeFetch();
    const rpc = createNodeRpc("http://node/rpc", "machine", fetchFn);
    const outcome = await awaitInput(rpc, 12, { intervalMs: 1, timeoutMs: 3, sleep: async () => {} });
    expect(outcome).toMatchObject({ status: "DECLINED", report: { code: "MATCH_ENDED", matchId: "2" } });
  });

  // Regression (fixed): same root cause — the F12 cross-tab forfeit-race lookup can never match
  // a sender, so the result screen always says "Lost by forfeit" instead of
  // "your move arrived after the forfeit claim".
  it("findLateMove finds A's MATCH_ENDED move for match 2", async () => {
    const { fetchFn } = nodeFetch();
    const rpc = createNodeRpc("http://node/rpc", "machine", fetchFn);
    expect(await findLateMove(rpc, "2", A)).toMatchObject({ code: "MATCH_ENDED", matchId: "2" });
  });

  // Regression (fixed): same root cause — useHealth() reads `app.data.enabled/status` from
  // getApplication(); with the wrapper both are undefined, so the health banner
  // permanently reads "Application undefined" on a healthy node.
  it("getApplication exposes enabled/status", async () => {
    const { fetchFn } = nodeFetch();
    const app = await createNodeRpc("http://node/rpc", "machine", fetchFn).getApplication();
    expect(app).toMatchObject({ enabled: true, status: "OK" });
  });

  it("(control) a raw report payload from the node decodes through the protocol", () => {
    expect(lateMoveReport.startsWith(utf8ToHex('{"type":"Rejected"'))).toBe(true);
  });
});
