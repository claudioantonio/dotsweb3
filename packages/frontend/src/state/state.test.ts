import { describe, expect, it } from "vitest";
import { A, B, C, T0, TURN, ended, liveView, moveNotices, queue, records, rejectedMatchEnded, session, started } from "./__fixtures__";
import { liveListFrom } from "./liveList";
import { CLAIM_SLACK_SECONDS, applyNotices, fromMatchView, fromStarted, turnStatus } from "./match";
import { myLiveMatchId, playerPhase } from "./player";
import { reconcilePending, type PendingMove } from "./pending";
import { formatCountdown, sessionPhase, skewOffset } from "./session";

describe("match reducer", () => {
  it("builds the full match from MatchStarted + notices", () => {
    const m = applyNotices(fromStarted(started), [...moveNotices, ended]);
    expect(m.moves).toEqual(records);
    expect(m.ended).toBe(ended);
    expect(m.forfeitDeadline).toBeNull();
  });

  it("is idempotent and merges notices onto an inspect seed", () => {
    const seeded = fromMatchView(liveView);
    const m = applyNotices(seeded, [started, ...moveNotices, ...moveNotices]);
    expect(m.moves).toEqual(records);
    expect(m.turn).toBe(B);
    expect(m.stale).toBe(false);
  });

  it("marks a gap as stale instead of applying it", () => {
    const m = applyNotices(fromStarted(started), [moveNotices[1]]);
    expect(m.moves).toHaveLength(0);
    expect(m.stale).toBe(true);
  });

  it("appends the closing move if only MatchEnded arrived", () => {
    const m = applyNotices(fromMatchView({ ...liveView, moves: records.slice(0, 3), turn: B }), [ended]);
    expect(m.moves).toHaveLength(4);
  });

  it("ignores other matches' notices", () => {
    const other = { ...moveNotices[0], matchId: "2" };
    expect(applyNotices(fromStarted(started), [other]).moves).toHaveLength(0);
  });
});

describe("turnStatus (resolved deadline only)", () => {
  const m = fromMatchView(liveView); // A on turn, deadline D
  const D = liveView.forfeitDeadline!;
  it("my turn / I timed out", () => {
    expect(turnStatus(m, A, D)).toBe("MY_TURN");
    expect(turnStatus(m, A.toUpperCase().replace("0X", "0x"), D + 1)).toBe("I_TIMED_OUT");
  });
  it("their turn / opponent timed out after slack", () => {
    expect(turnStatus(m, B, D + CLAIM_SLACK_SECONDS)).toBe("THEIR_TURN");
    expect(turnStatus(m, B, D + CLAIM_SLACK_SECONDS + 1)).toBe("OPPONENT_TIMED_OUT");
  });
  it("spectator and ended", () => {
    expect(turnStatus(m, C, D)).toBe("SPECTATING");
    expect(turnStatus(m, null, D)).toBe("SPECTATING");
    expect(turnStatus({ ...m, ended }, A, D)).toBe("ENDED");
  });
});

describe("session phase", () => {
  it("at each boundary", () => {
    expect(sessionPhase(null, T0).phase).toBe("NONE");
    expect(sessionPhase(session, T0 - 1)).toEqual({ phase: "SCHEDULED", target: T0 });
    expect(sessionPhase(session, T0).phase).toBe("OPEN");
    expect(sessionPhase(session, session.cutoffAt - 1).phase).toBe("OPEN");
    expect(sessionPhase(session, session.cutoffAt)).toEqual({ phase: "CUTOFF", target: session.sessionEnd });
    expect(sessionPhase(session, session.sessionEnd).phase).toBe("ENDED");
  });
  it("skew offset only corrects a slow local clock", () => {
    expect(skewOffset(T0 + 10, T0)).toBe(10);
    expect(skewOffset(T0 - 10, T0)).toBe(0);
    expect(skewOffset(null, T0)).toBe(0);
  });
  it("formats countdowns", () => {
    expect(formatCountdown(47)).toBe("0:47");
    expect(formatCountdown(-3)).toBe("0:00");
    expect(formatCountdown(3 * 3600 + 61)).toBe("3:01:01");
    expect(formatCountdown(2 * 86400 + 4 * 3600 + 12 * 60 + 33)).toBe("2d 04:12:33");
  });
});

describe("player phase", () => {
  it("derives from queue, live match and pending action", () => {
    expect(playerPhase({ me: null, queue, liveMatchId: null, pendingAction: null }).kind).toBe("DISCONNECTED");
    expect(playerPhase({ me: C, queue, liveMatchId: null, pendingAction: null })).toEqual({ kind: "QUEUED", position: 1, joinedAt: T0 + 50 });
    expect(playerPhase({ me: A, queue, liveMatchId: null, pendingAction: "joinQueue" }).kind).toBe("JOINING");
    expect(playerPhase({ me: C, queue, liveMatchId: null, pendingAction: "leaveQueue" }).kind).toBe("LEAVING");
    expect(playerPhase({ me: A, queue, liveMatchId: "1", pendingAction: null })).toEqual({ kind: "IN_MATCH", matchId: "1" });
    expect(playerPhase({ me: A, queue, liveMatchId: null, pendingAction: null }).kind).toBe("IDLE");
  });
  it("tracks my live match through pairing and end", () => {
    expect(myLiveMatchId(null, [started], A)).toBe("1");
    expect(myLiveMatchId(null, [started], C)).toBeNull();
    expect(myLiveMatchId(null, [started, ended], B)).toBeNull();
    expect(myLiveMatchId("1", [], A)).toBe("1");
  });
});

describe("live list", () => {
  it("adds on start, tallies moves idempotently, removes on end", () => {
    const list = liveListFrom([], [started, moveNotices[0], moveNotices[3], moveNotices[3]]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ moveCount: 4, turn: B });
    expect(list[0].scores[B]).toBe(1);
    expect(liveListFrom(list, [ended])).toEqual([]);
  });
  it("keeps ascending matchId order", () => {
    const s2 = { ...started, matchId: "10" };
    const s3 = { ...started, matchId: "9" };
    expect(liveListFrom([], [s2, s3, started]).map((m) => m.matchId)).toEqual(["1", "9", "10"]);
  });
});

describe("pending move reconciliation", () => {
  const p: PendingMove = { matchId: "1", moveIndex: 2, edge: [[1, 1], [1, 0]], submitter: A };
  it("waits until the notice with that moveIndex arrives (even after APPLIED)", () => {
    expect(reconcilePending(p, records.slice(0, 2), null).resolution).toBe("waiting");
    expect(reconcilePending(p, records.slice(0, 2), { status: "APPLIED" }).resolution).toBe("waiting");
  });
  it("confirms on our edge in either direction", () => {
    expect(reconcilePending(p, records.slice(0, 3), null)).toEqual({ pending: null, resolution: "confirmed" });
  });
  it("superseded when another move took the index", () => {
    expect(reconcilePending({ ...p, edge: [[0, 1], [1, 1]] }, records.slice(0, 3), null).resolution).toBe("superseded");
  });
  it("clears when declined, on engine error, or on machine failure", () => {
    const declined = { status: "DECLINED" as const, report: { ...rejectedMatchEnded, code: "EDGE_TAKEN" as const } };
    expect(reconcilePending(p, records.slice(0, 2), declined).resolution).toBe("rejected");
    expect(reconcilePending(p, records.slice(0, 2), { status: "ENGINE_ERROR" }).resolution).toBe("rejected");
    expect(reconcilePending(p, records.slice(0, 2), { status: "FAILED", nodeStatus: "EXCEPTION" }).pending).toBeNull();
  });
  it("no pending → nothing", () => {
    expect(reconcilePending(null, records, null)).toEqual({ pending: null, resolution: null });
  });
  void TURN;
});
