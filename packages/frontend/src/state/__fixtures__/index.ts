/**
 * Protocol-typed fixtures for developing/testing without a running machine.
 * A full 2×2-dot match (4 edges, 1 square): A, B, A move; B closes the square.
 */
import type {
  MatchEndedNotice,
  MatchStartedNotice,
  MatchView,
  MoveNotice,
  MoveRecordWire,
  QueueView,
  RejectedReport,
  SessionConfig,
  SessionView,
} from "@dotsweb3/protocol";

export const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const C = "0xcccccccccccccccccccccccccccccccccccccccc";

export const T0 = 1_800_000_000; // session start
export const TURN = 60;

export const session: SessionConfig = {
  sessionId: 1,
  sessionStart: T0,
  sessionEnd: T0 + 7200,
  cutoffAt: T0 + 7200 - 900,
  gridSize: 2,
  turnTimeout: TURN,
  firstMoveGrace: 2 * TURN,
  sweepIdle: 10 * TURN,
};

export const started: MatchStartedNotice = {
  type: "MatchStarted",
  matchId: "1",
  sessionId: 1,
  players: [A, B],
  firstMover: A,
  gridSize: 2,
  turnTimeout: TURN,
  forfeitDeadline: T0 + 100 + 2 * TURN,
  timestamp: T0 + 100,
};

const rec = (
  moveIndex: number,
  edge: MoveRecordWire["edge"],
  submitter: string,
  squaresClosed: number,
  turnAfter: string,
  timestamp: number,
): MoveRecordWire => ({ matchId: "1", moveIndex, edge, submitter, squaresClosed, turnAfter, timestamp });

export const records: MoveRecordWire[] = [
  rec(0, [[0, 0], [1, 0]], A, 0, B, T0 + 110),
  rec(1, [[0, 0], [0, 1]], B, 0, A, T0 + 120),
  rec(2, [[1, 0], [1, 1]], A, 0, B, T0 + 130),
  rec(3, [[0, 1], [1, 1]], B, 1, B, T0 + 140),
];

export const moveNotices: MoveNotice[] = records.map((r, i) => ({
  ...r,
  type: "Move",
  forfeitDeadline: i === records.length - 1 ? null : r.timestamp + TURN,
}));

export const ended: MatchEndedNotice = {
  type: "MatchEnded",
  matchId: "1",
  sessionId: 1,
  players: [A, B],
  winner: B,
  loser: A,
  squares: { [A]: 0, [B]: 1 },
  forfeit: false,
  zeroMoveForfeit: false,
  abandoned: false,
  durationSeconds: 40,
  longestChain: { [A]: 0, [B]: 1 },
  closingMove: records[3],
  finalBoardHash: null,
  engineVersion: "0.1.0-alpha.0",
  timestamp: T0 + 140,
};

export const forfeitEnded: MatchEndedNotice = {
  ...ended,
  winner: A,
  loser: B,
  squares: { [A]: 0, [B]: 0 },
  forfeit: true,
  longestChain: { [A]: 0, [B]: 0 },
  closingMove: null,
  durationSeconds: 200,
  timestamp: T0 + 300,
};

/** Live match after the first two moves (A on turn). */
export const liveView: MatchView = {
  matchId: "1",
  sessionId: 1,
  gridSize: 2,
  turnTimeout: TURN,
  players: [A, B],
  status: "live",
  turn: A,
  scores: { [A]: 0, [B]: 0 },
  longestChain: { [A]: 0, [B]: 0 },
  startedAt: T0 + 100,
  forfeitDeadline: T0 + 120 + TURN,
  moves: records.slice(0, 2),
  ended: null,
};

export const queue: QueueView = { entries: [{ address: C, joinedAt: T0 + 50 }] };

export const sessionView: SessionView = {
  session,
  liveMatches: [],
  queueLength: 1,
  machineTime: T0 + 50,
  engineVersion: "0.1.0-alpha.0",
};

export const rejectedMatchEnded: RejectedReport = {
  type: "Rejected",
  action: "move",
  matchId: "1",
  code: "MATCH_ENDED",
  message: "match 1 has ended",
};

/** Declined queue action: no match, so no `matchId`. */
export const rejectedAlreadyQueued: RejectedReport = {
  type: "Rejected",
  action: "joinQueue",
  code: "ALREADY_QUEUED",
  message: "already queued",
};
