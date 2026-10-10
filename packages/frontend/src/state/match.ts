import type {
  Address,
  MatchEndedNotice,
  MatchId,
  MatchStartedNotice,
  MatchView,
  MoveRecordWire,
  Notice,
  UnixSeconds,
} from "@dotsweb3/protocol";

/**
 * Client-side view of one match: seeded from inspect `state` (or a
 * `MatchStarted` notice) and advanced by the notice stream. Holds only what
 * the machine said — scores/board come from the engine adapter's rebuild.
 */
export interface LiveMatch {
  matchId: MatchId;
  sessionId: number;
  gridSize: number;
  turnTimeout: number;
  players: [Address, Address];
  turn: Address;
  /** Machine-resolved deadline for `turn` (F9); null once ended. Never recomputed here. */
  forfeitDeadline: UnixSeconds | null;
  startedAt: UnixSeconds;
  moves: MoveRecordWire[];
  ended: MatchEndedNotice | null;
  /** A notice skipped ahead of `moves` (we missed one) — re-inspect to recover. */
  stale: boolean;
}

export function fromMatchView(v: MatchView): LiveMatch {
  return {
    matchId: v.matchId,
    sessionId: v.sessionId,
    gridSize: v.gridSize,
    turnTimeout: v.turnTimeout,
    players: [v.players[0].toLowerCase(), v.players[1].toLowerCase()],
    turn: v.turn.toLowerCase(),
    forfeitDeadline: v.forfeitDeadline,
    startedAt: v.startedAt,
    moves: v.moves,
    ended: v.ended,
    stale: false,
  };
}

export function fromStarted(n: MatchStartedNotice): LiveMatch {
  return {
    matchId: n.matchId,
    sessionId: n.sessionId,
    gridSize: n.gridSize,
    turnTimeout: n.turnTimeout,
    players: [n.players[0].toLowerCase(), n.players[1].toLowerCase()],
    turn: n.firstMover.toLowerCase(),
    forfeitDeadline: n.forfeitDeadline,
    startedAt: n.timestamp,
    moves: [],
    ended: null,
    stale: false,
  };
}

function toRecord(n: MoveRecordWire): MoveRecordWire {
  return {
    matchId: n.matchId,
    moveIndex: n.moveIndex,
    edge: n.edge,
    submitter: n.submitter.toLowerCase(),
    squaresClosed: n.squaresClosed,
    turnAfter: n.turnAfter.toLowerCase(),
    timestamp: n.timestamp,
  };
}

/** Idempotent: re-applying a notice the view already contains is a no-op. */
export function applyNotice(m: LiveMatch, n: Notice): LiveMatch {
  if (n.matchId !== m.matchId || m.ended) return m;
  switch (n.type) {
    case "MatchStarted":
      return m;
    case "Move":
      if (n.moveIndex < m.moves.length) return m;
      if (n.moveIndex > m.moves.length) return { ...m, stale: true };
      return {
        ...m,
        moves: [...m.moves, toRecord(n)],
        turn: n.turnAfter.toLowerCase(),
        forfeitDeadline: n.forfeitDeadline,
      };
    case "MatchEnded": {
      const cm = n.closingMove;
      const moves = cm && cm.moveIndex === m.moves.length ? [...m.moves, toRecord(cm)] : m.moves;
      // Closing move beyond what we have → we missed Move notices; re-inspect (same as a Move gap).
      const stale = m.stale || (!!cm && cm.moveIndex > m.moves.length);
      return { ...m, moves, ended: n, forfeitDeadline: null, stale };
    }
  }
}

export function applyNotices(m: LiveMatch, notices: readonly Notice[]): LiveMatch {
  let out = m;
  for (const n of notices) out = applyNotice(out, n);
  return out;
}

/** Seconds of slack past the resolved deadline before offering "Claim forfeit" (ux-plan §4). */
export const CLAIM_SLACK_SECONDS = 2;

export type TurnStatus =
  | "MY_TURN"
  | "THEIR_TURN"
  | "I_TIMED_OUT"
  | "OPPONENT_TIMED_OUT"
  | "SPECTATING"
  | "ENDED";

/**
 * UI sub-state of a match for `me` at machine-adjusted `now`. Compares
 * against the machine's resolved deadline only; no timeout rule here.
 */
export function turnStatus(m: LiveMatch, me: Address | null, now: UnixSeconds): TurnStatus {
  if (m.ended) return "ENDED";
  const self = me?.toLowerCase() ?? null;
  if (!self || !m.players.includes(self)) return "SPECTATING";
  const d = m.forfeitDeadline;
  if (m.turn === self) return d !== null && now > d ? "I_TIMED_OUT" : "MY_TURN";
  return d !== null && now > d + CLAIM_SLACK_SECONDS ? "OPPONENT_TIMED_OUT" : "THEIR_TURN";
}

export function opponentOf(m: { players: [Address, Address] }, me: Address): Address {
  return m.players[0] === me.toLowerCase() ? m.players[1] : m.players[0];
}
