/**
 * QA edge cases for the frontend's pure logic: reducers under gaps/casing,
 * pending reconciliation races, live list, phases, rejection mapping and the
 * replay driver. Fixtures: a 2×2-dot match (see __fixtures__).
 */
import type { HistoryView, MatchStartedNotice, MoveNotice } from "@dotsweb3/protocol";
import { describe, expect, it } from "vitest";
import { isForfeitRace, rejectionCopy, resultVariant } from "../copy/rejections";
import { A, B, C, T0, TURN, ended, forfeitEnded, liveView, moveNotices, records, rejectedMatchEnded, session, started } from "./__fixtures__";
import { applyToLiveList, liveListFrom } from "./liveList";
import { applyNotices, fromMatchView, fromStarted, turnStatus } from "./match";
import { reconcilePending, type PendingMove } from "./pending";
import { myLiveMatchId } from "./player";
import { buildFrames } from "./replay";
import { formatCountdown, sessionPhase } from "./session";

const up = (a: string) => "0x" + a.slice(2).toUpperCase();

describe("match reducer edge cases", () => {
  it("normalises checksummed addresses from notices so turnStatus still recognises me", () => {
    const n: MatchStartedNotice = { ...started, players: [up(A), up(B)], firstMover: up(A) };
    const m = applyNotices(fromStarted(n), [{ ...moveNotices[0], submitter: up(A), turnAfter: up(B) }]);
    expect(m.players).toEqual([A, B]);
    expect(m.turn).toBe(B);
    expect(m.moves[0].submitter).toBe(A);
    expect(turnStatus(m, B, T0)).toBe("MY_TURN");
  });

  it("notices after MatchEnded are ignored (ended is terminal)", () => {
    const m = applyNotices(fromStarted(started), [...moveNotices, ended, { ...moveNotices[0], moveIndex: 4 }]);
    expect(m.moves).toHaveLength(4);
    expect(m.ended).toBe(ended);
  });

  it("a forfeit MatchEnded keeps the moves and clears the deadline", () => {
    const m = applyNotices(fromStarted(started), [moveNotices[0], forfeitEnded]);
    expect(m.moves).toHaveLength(1);
    expect(m.forfeitDeadline).toBeNull();
    expect(turnStatus(m, A, T0 + 10_000)).toBe("ENDED");
  });

  // Regression (fixed, low): a MatchEnded whose closingMove skips ahead of the local log
  // (moves 1–2 missed) is applied without flagging `stale`, so useLiveMatch
  // never re-inspects and the final board/replay frame is missing edges.
  // Move notices with the same gap DO set stale (state/match.ts:85 vs :94-96).
  it("a MatchEnded whose closingMove skips ahead marks the view stale", () => {
    const m = applyNotices(fromStarted(started), [moveNotices[0], ended]); // closingMove index 3, local has 1
    expect(m.stale).toBe(true);
  });
});

describe("turnStatus boundaries agree with the machine's strict `now > deadline`", () => {
  const m = fromMatchView(liveView); // A on turn
  const D = liveView.forfeitDeadline!;
  it("on-turn player is warned from D+1 — the first second the machine would accept a claim", () => {
    expect(turnStatus(m, A, D)).toBe("MY_TURN");
    expect(turnStatus(m, A, D + 1)).toBe("I_TIMED_OUT");
  });
  it("a null deadline never times out", () => {
    expect(turnStatus({ ...m, forfeitDeadline: null }, B, D + 10_000)).toBe("THEIR_TURN");
  });
});

describe("myLiveMatchId", () => {
  const started2: MatchStartedNotice = { ...started, matchId: "2", timestamp: T0 + 500 };
  it("ignores other players' pairings and ends", () => {
    const other: MatchStartedNotice = { ...started, matchId: "3", players: [C, "0x" + "d".repeat(40)] };
    expect(myLiveMatchId(null, [other, { ...ended, matchId: "3" }], A)).toBeNull();
    expect(myLiveMatchId("1", [other], A)).toBe("1");
  });
  it("tracks pairing with checksummed players and my checksummed address", () => {
    expect(myLiveMatchId(null, [{ ...started2, players: [up(A), up(B)] }], up(A))).toBe("2");
  });

  // Regression (fixed, low): the fold replays every notice since boot OVER the inspect seed,
  // so a seed fresher than the notice store is overwritten by older notices.
  // Repro: store holds [MatchStarted 1, MatchEnded 1] (my previous match); the
  // re-fetched inspect seed already says I'm in match 2, but the poller hasn't
  // delivered MatchStarted 2 yet → result null (UI shows IDLE / enables Join,
  // which then bounces IN_LIVE_MATCH) until the next poll.
  it("a fresher inspect seed is not overwritten by older notices", () => {
    expect(myLiveMatchId("2", [started, ended], A)).toBe("2");
  });
});

describe("pending move reconciliation races", () => {
  const p: PendingMove = { matchId: "1", moveIndex: 2, edge: [[1, 1], [1, 0]], submitter: up(A) };
  it("a landed Move notice wins over a DECLINED outcome (the notice is the truth)", () => {
    expect(reconcilePending(p, records, { status: "DECLINED", report: rejectedMatchEnded }).resolution).toBe("confirmed");
  });
  it("my own different edge at that index (e.g. another tab) is 'superseded', not confirmed", () => {
    const other = { ...p, edge: [[0, 1], [1, 1]] as PendingMove["edge"] };
    expect(reconcilePending(other, records, null).resolution).toBe("superseded");
  });
  it("FAILED / ENGINE_ERROR clear the badge; APPLIED keeps waiting for the notice", () => {
    const early = records.slice(0, 2);
    expect(reconcilePending(p, early, { status: "FAILED", nodeStatus: "CYCLE_LIMIT_EXCEEDED" }).resolution).toBe("rejected");
    expect(reconcilePending(p, early, { status: "ENGINE_ERROR" }).resolution).toBe("rejected");
    expect(reconcilePending(p, early, { status: "APPLIED" })).toEqual({ pending: p, resolution: "waiting" });
  });
});

describe("live list edge cases", () => {
  it("duplicate MatchStarted and replayed Moves are idempotent; the final Move keeps the last deadline", () => {
    const list = liveListFrom([], [started, started, ...moveNotices.slice(0, 3), ...moveNotices.slice(0, 3)]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ moveCount: 3, turn: B, forfeitDeadline: records[2].timestamp + TURN });
    const final = applyToLiveList(list, moveNotices[3]);
    expect(final[0]).toMatchObject({ moveCount: 4, scores: { [A]: 0, [B]: 1 }, forfeitDeadline: records[2].timestamp + TURN });
  });
  it("lowercases checksummed players and scores by lowercase submitter", () => {
    const list = liveListFrom([], [{ ...started, players: [up(A), up(B)], firstMover: up(A) }, { ...moveNotices[0], submitter: up(A) } as MoveNotice]);
    expect(list[0].players).toEqual([A, B]);
    expect(Object.keys(list[0].scores)).toEqual([A, B]);
  });
  it("MatchEnded for an unknown match is a no-op", () => {
    expect(liveListFrom([], [{ ...ended, matchId: "9" }])).toEqual([]);
  });
});

describe("session phase boundaries", () => {
  it("a zero-length open window (cutoffAt == sessionStart) goes straight to CUTOFF, like the machine's PAST_CUTOFF", () => {
    const s = { ...session, cutoffAt: session.sessionStart };
    expect(sessionPhase(s, s.sessionStart - 1).phase).toBe("SCHEDULED");
    expect(sessionPhase(s, s.sessionStart).phase).toBe("CUTOFF");
  });
  it("formatCountdown floors fractions and clamps negatives", () => {
    expect(formatCountdown(59.9)).toBe("0:59");
    expect(formatCountdown(-5)).toBe("0:00");
    expect(formatCountdown(3600)).toBe("1:00:00");
  });
});

describe("rejection mapping", () => {
  it("unknown codes fall back to the machine's message", () => {
    expect(rejectionCopy({ type: "Rejected", action: "move", code: "FUTURE_CODE" as never, message: "m" })).toEqual({ title: "Input rejected", description: "m" });
  });
  it("forfeit race: case-insensitive on me, only for move + MATCH_ENDED", () => {
    const end = { ...forfeitEnded, winner: B, loser: A };
    expect(isForfeitRace(rejectedMatchEnded, end, up(A))).toBe(true);
    expect(isForfeitRace({ ...rejectedMatchEnded, action: "claimForfeit" }, end, A)).toBe(false);
    expect(isForfeitRace(rejectedMatchEnded, { ...end, forfeit: false }, A)).toBe(false);
    expect(isForfeitRace(rejectedMatchEnded, end, B)).toBe(false);
  });
  it("result variants: zero-move forfeit and swept matches", () => {
    expect(resultVariant({ ...forfeitEnded, zeroMoveForfeit: true }, A, false)).toBe("WON_BY_FORFEIT");
    expect(resultVariant({ ...ended, abandoned: true, winner: null, loser: null }, C, false)).toBe("ABANDONED");
    expect(resultVariant(ended, up(B), false)).toBe("WON");
  });
});

describe("replay driver edge cases", () => {
  const hist: HistoryView = { matchId: "1", gridSize: 2, players: [A, B], moves: records, ended };
  it("an empty history yields only the empty frame", () => {
    const r = buildFrames({ ...hist, moves: [], ended: null });
    expect(r.frames).toHaveLength(1);
    expect(r.divergence).toBeNull();
  });
  it("checksummed submitter/turnAfter in records do not cause a divergence", () => {
    const moves = records.map((m) => ({ ...m, submitter: up(m.submitter), turnAfter: up(m.turnAfter) }));
    expect(buildFrames({ ...hist, moves }).divergence).toBeNull();
  });
  it("a record attributed to the wrong player diverges at that move", () => {
    const moves = records.map((m, i) => (i === 1 ? { ...m, submitter: A } : m));
    expect(buildFrames({ ...hist, moves }).divergence).toMatchObject({ moveIndex: 1 });
  });
  it("a duplicated record diverges (index gap) instead of throwing", () => {
    const r = buildFrames({ ...hist, moves: [records[0], records[0]] });
    expect(r.divergence).toMatchObject({ moveIndex: 1 });
    expect(r.frames).toHaveLength(2);
  });
});
