import { decodeRejected, type Address, type MatchId, type RejectedReport } from "@dotsweb3/protocol";
import { fromHexIndex, type InputStatus, type NodeRpc } from "./rpc";

/**
 * Machine verdict on one advance input (architecture §1.4):
 * - ACCEPTED, no Rejected report  → APPLIED
 * - ACCEPTED + a Rejected report  → DECLINED (state untouched; show `code`)
 * - REJECTED                      → ENGINE_ERROR (machine rolled back; its report is lost)
 * - EXCEPTION / limits / halted   → FAILED (node-level failure)
 */
export type InputOutcome =
  | { status: "APPLIED" }
  | { status: "DECLINED"; report: RejectedReport }
  | { status: "ENGINE_ERROR" }
  | { status: "FAILED"; nodeStatus: InputStatus };

export interface AwaitOptions {
  intervalMs?: number;
  /** Give up after this long (the caller surfaces "still processing"). */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

export class AwaitTimeout extends Error {
  constructor(inputIndex: number) {
    super(`input #${inputIndex} not processed yet`);
    this.name = "AwaitTimeout";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Poll the node until `inputIndex` is processed, then classify it per §1.4. */
export async function awaitInput(rpc: NodeRpc, inputIndex: number, opts: AwaitOptions = {}): Promise<InputOutcome> {
  const { intervalMs = 1500, timeoutMs = 120_000, sleep = defaultSleep, signal } = opts;
  let waited = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const input = await rpc.getInput(inputIndex).catch(() => null);
    const status = input?.status ?? "NONE";
    if (status === "ACCEPTED") {
      const report = await rejectedReport(rpc, inputIndex);
      return report ? { status: "DECLINED", report } : { status: "APPLIED" };
    }
    if (status === "REJECTED") return { status: "ENGINE_ERROR" };
    if (status !== "NONE") return { status: "FAILED", nodeStatus: status };
    if (waited >= timeoutMs) throw new AwaitTimeout(inputIndex);
    await sleep(intervalMs);
    waited += intervalMs;
  }
}

function tryDecode(raw: string): RejectedReport | null {
  try {
    return decodeRejected(raw);
  } catch {
    return null; // not ours (e.g. a debug report)
  }
}

/** The machine's single Rejected report for an input, if any (cartesi_listReports by input_index). */
async function rejectedReport(rpc: NodeRpc, inputIndex: number): Promise<RejectedReport | null> {
  const page = await rpc.listReports({ inputIndex });
  for (const r of page.data) {
    const report = tryDecode(r.raw_data);
    if (report) return report;
  }
  return null;
}

/**
 * Cross-tab forfeit-race lookup (F12): find a declined `move` by `me` for
 * `matchId` with code MATCH_ENDED. Scans the app's reports (only declined
 * inputs produce persisted reports, so the list is short) and checks the
 * sender of each candidate input. Reports without `matchId` can't be
 * attributed and are skipped.
 */
export async function findLateMove(
  rpc: NodeRpc,
  matchId: MatchId,
  me: Address,
  pageLimit = 100,
): Promise<RejectedReport | null> {
  const self = me.toLowerCase();
  let offset = 0;
  for (;;) {
    const page = await rpc.listReports({ offset, limit: pageLimit });
    for (const r of page.data) {
      const report = tryDecode(r.raw_data);
      if (!report || report.action !== "move" || report.code !== "MATCH_ENDED" || report.matchId !== matchId) continue;
      const input = await rpc.getInput(fromHexIndex(r.input_index));
      if (input?.decoded_data?.sender.toLowerCase() === self) return report;
    }
    offset += page.data.length;
    if (page.data.length === 0 || offset >= page.pagination.total_count) return null;
  }
}
