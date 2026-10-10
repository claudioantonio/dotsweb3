import type { Address, Coord, MatchId, MoveRecordWire } from "@dotsweb3/protocol";
import type { InputOutcome } from "../cartesi/inputStatus";

/** Optimistic move: drawn dashed with a "pending" badge until resolved (F12). */
export interface PendingMove {
  matchId: MatchId;
  /** = moves.length when submitted. */
  moveIndex: number;
  edge: [Coord, Coord];
  submitter: Address;
}

export type PendingResolution =
  | "waiting" // no notice and no rejection yet
  | "confirmed" // the Move notice at moveIndex is ours
  | "superseded" // someone else's move took moveIndex (ours will be rejected)
  | "rejected"; // the input was declined, hit an engine error, or failed

const sameDot = (a: Coord, b: Coord) => a[0] === b[0] && a[1] === b[1];
export function sameEdge(a: [Coord, Coord], b: [Coord, Coord]): boolean {
  return (sameDot(a[0], b[0]) && sameDot(a[1], b[1])) || (sameDot(a[0], b[1]) && sameDot(a[1], b[0]));
}

/**
 * Pure reconciliation of a pending move against confirmed moves and the
 * input outcome. The badge clears on anything but "waiting". An APPLIED
 * outcome alone keeps waiting: the board only changes on the Move notice.
 * DECLINED (ACCEPTED + Rejected report), ENGINE_ERROR and FAILED all clear it.
 */
export function reconcilePending(
  pending: PendingMove | null,
  moves: readonly MoveRecordWire[],
  outcome: InputOutcome | null,
): { pending: PendingMove | null; resolution: PendingResolution | null } {
  if (!pending) return { pending: null, resolution: null };
  const landed = moves[pending.moveIndex];
  if (landed) {
    const ours = landed.submitter.toLowerCase() === pending.submitter.toLowerCase() && sameEdge(landed.edge, pending.edge);
    return { pending: null, resolution: ours ? "confirmed" : "superseded" };
  }
  if (outcome && outcome.status !== "APPLIED") return { pending: null, resolution: "rejected" };
  return { pending, resolution: "waiting" };
}
