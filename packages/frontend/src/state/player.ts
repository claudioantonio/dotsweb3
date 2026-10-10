import type { ActionType, Address, MatchId, Notice, QueueView } from "@dotsweb3/protocol";

export type PlayerPhase =
  | { kind: "DISCONNECTED" }
  | { kind: "IDLE" }
  | { kind: "JOINING" }
  | { kind: "QUEUED"; position: number; joinedAt: number }
  | { kind: "LEAVING"; position: number }
  | { kind: "IN_MATCH"; matchId: MatchId };

/**
 * My current live match, from the inspect `state(player)` seed plus every
 * notice since boot, independent of which is fresher: candidates are the
 * seed and my pairings, minus any match with a MatchEnded; the newest
 * (highest sequential matchId) wins — a player has at most one live match.
 */
export function myLiveMatchId(seed: MatchId | null, notices: readonly Notice[], me: Address): MatchId | null {
  const self = me.toLowerCase();
  const endedIds = new Set<MatchId>();
  const candidates: MatchId[] = seed ? [seed] : [];
  for (const n of notices) {
    if (n.type === "MatchEnded") endedIds.add(n.matchId);
    else if (n.type === "MatchStarted" && n.players.some((p) => p.toLowerCase() === self)) candidates.push(n.matchId);
  }
  let best: MatchId | null = null;
  for (const id of candidates) {
    if (!endedIds.has(id) && (best === null || Number(id) > Number(best))) best = id;
  }
  return best;
}

/** Queue membership from the inspect snapshot, corrected by later pairings. */
export function queuePosition(queue: QueueView | undefined, me: Address): { position: number; joinedAt: number } | null {
  if (!queue) return null;
  const i = queue.entries.findIndex((e) => e.address.toLowerCase() === me.toLowerCase());
  return i < 0 ? null : { position: i + 1, joinedAt: queue.entries[i].joinedAt };
}

export function playerPhase(input: {
  me: Address | null;
  queue: QueueView | undefined;
  liveMatchId: MatchId | null;
  pendingAction: ActionType | null;
}): PlayerPhase {
  const { me, queue, liveMatchId, pendingAction } = input;
  if (!me) return { kind: "DISCONNECTED" };
  if (liveMatchId) return { kind: "IN_MATCH", matchId: liveMatchId };
  const q = queuePosition(queue, me);
  if (pendingAction === "joinQueue" && !q) return { kind: "JOINING" };
  if (pendingAction === "leaveQueue" && q) return { kind: "LEAVING", position: q.position };
  if (q) return { kind: "QUEUED", ...q };
  return { kind: "IDLE" };
}
