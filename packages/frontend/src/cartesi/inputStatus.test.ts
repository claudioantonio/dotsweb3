import { encodeRejected, utf8ToHex } from "@dotsweb3/protocol";
import { describe, expect, it, vi } from "vitest";
import { A, B, rejectedAlreadyQueued, rejectedMatchEnded } from "../state/__fixtures__";
import { AwaitTimeout, awaitInput, findLateMove } from "./inputStatus";
import type { InputStatus, NodeRpc, RpcReport } from "./rpc";

const report = (inputIndex: number, raw_data: string, k = 0): RpcReport => ({
  index: `0x${k.toString(16)}`,
  input_index: `0x${inputIndex.toString(16)}`,
  raw_data,
});

/** Fake node: per-input status sequence (for input 7), a report list, and input senders. */
function rpcWith(statuses: (InputStatus | null)[], reports: RpcReport[] = [], senders: Record<number, string> = {}): NodeRpc {
  let i = 0;
  return {
    listOutputs: vi.fn(),
    getApplication: vi.fn(),
    getInput: vi.fn(async (idx: number) => {
      if (idx in senders) return { index: `0x${idx.toString(16)}`, status: "ACCEPTED" as const, decoded_data: { sender: senders[idx] } };
      const s = statuses[Math.min(i++, statuses.length - 1)];
      return s === null ? null : { index: "0x7", status: s };
    }),
    listReports: vi.fn(async ({ inputIndex, offset = 0, limit = 50 }) => {
      const all = inputIndex === undefined ? reports : reports.filter((r) => parseInt(r.input_index, 16) === inputIndex);
      return { data: all.slice(offset, offset + limit), pagination: { total_count: all.length, limit, offset } };
    }),
  };
}
const sleep = async () => {};

describe("awaitInput (architecture §1.4 client rule)", () => {
  it("ACCEPTED with no report → APPLIED (after polling through unknown/NONE)", async () => {
    const rpc = rpcWith([null, "NONE", "ACCEPTED"]);
    expect(await awaitInput(rpc, 7, { sleep })).toEqual({ status: "APPLIED" });
    expect(rpc.getInput).toHaveBeenCalledTimes(3);
    expect(rpc.listReports).toHaveBeenCalledWith({ inputIndex: 7 });
  });

  it("ACCEPTED + Rejected report → DECLINED with matchId (move)", async () => {
    const rpc = rpcWith(["ACCEPTED"], [report(7, utf8ToHex("debug")), report(7, encodeRejected(rejectedMatchEnded), 1)]);
    const out = await awaitInput(rpc, 7, { sleep });
    expect(out).toEqual({ status: "DECLINED", report: rejectedMatchEnded });
    expect(out.status === "DECLINED" && out.report.matchId).toBe("1");
  });

  it("ACCEPTED + Rejected report without matchId (queue action) → DECLINED", async () => {
    const rpc = rpcWith(["ACCEPTED"], [report(7, encodeRejected(rejectedAlreadyQueued))]);
    const out = await awaitInput(rpc, 7, { sleep });
    expect(out).toEqual({ status: "DECLINED", report: rejectedAlreadyQueued });
    expect(out.status === "DECLINED" && "matchId" in out.report).toBe(false);
  });

  it("only this input's reports count", async () => {
    const rpc = rpcWith(["ACCEPTED"], [report(6, encodeRejected(rejectedMatchEnded))]);
    expect(await awaitInput(rpc, 7, { sleep })).toEqual({ status: "APPLIED" });
  });

  it("REJECTED → ENGINE_ERROR (report is lost; not looked up)", async () => {
    const rpc = rpcWith(["REJECTED"]);
    expect(await awaitInput(rpc, 7, { sleep })).toEqual({ status: "ENGINE_ERROR" });
    expect(rpc.listReports).not.toHaveBeenCalled();
  });

  it("node-level failures → FAILED", async () => {
    expect(await awaitInput(rpcWith(["EXCEPTION"]), 7, { sleep })).toEqual({ status: "FAILED", nodeStatus: "EXCEPTION" });
  });

  it("times out", async () => {
    await expect(awaitInput(rpcWith(["NONE"]), 7, { sleep, intervalMs: 10, timeoutMs: 30 })).rejects.toBeInstanceOf(AwaitTimeout);
  });
});

describe("findLateMove (cross-tab forfeit race)", () => {
  const { matchId: _omit, ...noMatchId } = rejectedMatchEnded;
  const reports = [
    report(3, encodeRejected(rejectedAlreadyQueued), 0),
    report(4, encodeRejected({ ...rejectedMatchEnded, matchId: "2" }), 1), // other match
    report(5, encodeRejected(noMatchId), 2), // can't attribute → skipped
    report(9, encodeRejected(rejectedMatchEnded), 3), // A's late move
    report(11, encodeRejected(rejectedMatchEnded), 4), // B's late move
  ];
  const senders = { 4: B, 5: B, 9: A, 11: B };

  it("finds my declined MATCH_ENDED move for this match by sender, paginating", async () => {
    const rpc = rpcWith([], reports, senders);
    expect(await findLateMove(rpc, "1", B.toUpperCase().replace("0X", "0x"), 2)).toEqual(rejectedMatchEnded);
    expect(rpc.getInput).toHaveBeenCalledWith(9);
    expect(rpc.getInput).toHaveBeenCalledWith(11);
    expect(rpc.getInput).not.toHaveBeenCalledWith(5);
  });

  it("null when no attributable report exists", async () => {
    expect(await findLateMove(rpcWith([], reports.slice(0, 3), senders), "1", B)).toBeNull();
    expect(await findLateMove(rpcWith([], [], {}), "1", B)).toBeNull();
  });
});
