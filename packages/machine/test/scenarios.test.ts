/**
 * QA scenarios beyond app.test.ts: forfeit timing after extra moves and late
 * moves, queue/pairing edges, session reschedule/cutoff, overtime + sweep,
 * address case at ingress, and inspect-vs-notice consistency.
 */
import type { MatchEndedNotice, MatchStartedNotice, MoveNotice, Notice } from "@dotsweb3/protocol";
import { createApp } from "../src/app";
import {
    A, accepted, adv, B, BOTTOM, C, code, CUTOFF, D, data, END, LEFT, newApp, OWNER, paired, rejection, RIGHT, schedule,
    snapshot, START, T, TOP,
} from "./helpers";

type Edge = [[number, number], [number, number]];
const mixed = (addr: string) => "0x" + addr.slice(2).toUpperCase();
const move = (matchId: string, edge: Edge) => ({ type: "move" as const, matchId, edge });
const claim = (matchId: string) => ({ type: "claimForfeit" as const, matchId });
const join = { type: "joinQueue" as const };

/** 4x4-dot session, A vs B paired at START; A on turn. */
function paired4() {
    const app = newApp();
    accepted(schedule(app, { gridSize: 4 }));
    accepted(adv(app, A, START, join));
    accepted(adv(app, B, START, join));
    return app;
}

describe("forfeit timing", () => {
    it("after a closing move the closer keeps the turn: only the opponent may claim, at lastMoveAt + T + 1", () => {
        const app = paired4();
        accepted(adv(app, A, START + 1, move("1", TOP)));
        accepted(adv(app, B, START + 2, move("1", LEFT)));
        accepted(adv(app, A, START + 3, move("1", RIGHT)));
        const [close] = accepted(adv(app, B, START + 4, move("1", BOTTOM))) as [MoveNotice];
        expect(close).toMatchObject({ squaresClosed: 1, turnAfter: B, forfeitDeadline: START + 4 + T });
        expect(code(adv(app, B, START + 100, claim("1")))).toBe("NOT_THE_WAITING_PLAYER");
        expect(code(adv(app, A, START + 4 + T, claim("1")))).toBe("DEADLINE_NOT_ELAPSED");
        const [e] = accepted(adv(app, A, START + 5 + T, claim("1"))) as [MatchEndedNotice];
        expect(e).toMatchObject({ winner: A, loser: B, forfeit: true, zeroMoveForfeit: false, squares: { [A]: 0, [B]: 1 } });
    });

    it("a late move resets the deadline: a claim at the old deadline + 1 is then too early", () => {
        const app = paired();
        const late = START + 2 * T + 5; // A is past the grace deadline but nobody claimed
        accepted(adv(app, A, late, move("1", TOP)));
        // B is now on turn; A waits. A's claim at the *old* deadline+1 is judged against late + T.
        expect(code(adv(app, A, late + 1, claim("1")))).toBe("DEADLINE_NOT_ELAPSED");
        expect(code(adv(app, A, late + T, claim("1")))).toBe("DEADLINE_NOT_ELAPSED");
        accepted(adv(app, A, late + T + 1, claim("1")));
    });

    it("first-move grace applies only to move 0: after move 0 the deadline is T, not 2T", () => {
        const app = paired();
        accepted(adv(app, A, START + 1, move("1", TOP)));
        expect(data(app, { route: "state", matchId: "1" })?.forfeitDeadline).toBe(START + 1 + T);
        accepted(adv(app, A, START + 2 + T, claim("1")));
    });

    it("same timestamp: claim and move at deadline+1 resolve strictly in input order", () => {
        const t = START + 2 * T + 1;
        const claimFirst = paired();
        accepted(adv(claimFirst, B, t, claim("1")));
        expect(rejection(adv(claimFirst, A, t, move("1", TOP)))).toMatchObject({ code: "MATCH_ENDED", matchId: "1" });

        const moveFirst = paired();
        accepted(adv(moveFirst, A, t, move("1", TOP)));
        expect(code(adv(moveFirst, B, t, claim("1")))).toBe("NOT_THE_WAITING_PLAYER");
        expect(code(adv(moveFirst, A, t, claim("1")))).toBe("DEADLINE_NOT_ELAPSED");
    });

    it("declined spam (wrong-turn moves, early claims) does not move the deadline", () => {
        const app = paired();
        for (let i = 1; i <= 2 * T; i++) {
            code(adv(app, B, START + i, move("1", TOP))); // NOT_YOUR_TURN
            code(adv(app, B, START + i, claim("1"))); // DEADLINE_NOT_ELAPSED
        }
        expect(data(app, { route: "state", matchId: "1" })?.forfeitDeadline).toBe(START + 2 * T);
        accepted(adv(app, B, START + 2 * T + 1, claim("1")));
    });

    it("a claim works in overtime (past sessionEnd) and on a match from a replaced session", () => {
        const app = paired();
        accepted(schedule(app, { t: START + 5, sessionStart: START + 5000, sessionEnd: START + 9000 }));
        const [e] = accepted(adv(app, B, END + 1000, claim("1"))) as [MatchEndedNotice];
        expect(e).toMatchObject({ sessionId: 1, winner: B, forfeit: true, timestamp: END + 1000, durationSeconds: END + 1000 - START });
    });
});

describe("queue and pairing", () => {
    it("pairs strictly FIFO: third joiner waits, fourth pairs with third", () => {
        const app = newApp();
        accepted(schedule(app));
        accepted(adv(app, A, START, join));
        expect(accepted(adv(app, B, START + 1, join))[0]).toMatchObject({ matchId: "1", players: [A, B] });
        expect(accepted(adv(app, C, START + 2, join))).toEqual([]);
        expect(data(app, { route: "queue" }).entries).toEqual([{ address: C, joinedAt: START + 2 }]);
        expect(accepted(adv(app, D, START + 3, join))[0]).toMatchObject({ matchId: "2", players: [C, D], firstMover: C });
        expect(data(app, { route: "session" }).liveMatches.map((m) => m.matchId)).toEqual(["1", "2"]);
    });

    it("leave then rejoin keeps the new joinedAt", () => {
        const app = newApp();
        accepted(schedule(app));
        accepted(adv(app, A, START, join));
        accepted(adv(app, A, START + 5, { type: "leaveQueue" }));
        accepted(adv(app, A, START + 9, join));
        expect(data(app, { route: "queue" }).entries).toEqual([{ address: A, joinedAt: START + 9 }]);
    });

    it("leaveQueue while in a live match is NOT_QUEUED; a player cannot pair with themselves", () => {
        const app = paired();
        expect(code(adv(app, A, START + 1, { type: "leaveQueue" }))).toBe("NOT_QUEUED");
        const solo = newApp();
        accepted(schedule(solo));
        accepted(adv(solo, A, START, join));
        expect(code(adv(solo, mixed(A), START, join))).toBe("ALREADY_QUEUED");
        expect(data(solo, { route: "session" }).liveMatches).toEqual([]);
    });

    it("the owner can also play", () => {
        const app = newApp();
        accepted(schedule(app));
        accepted(adv(app, OWNER, START, join));
        expect(accepted(adv(app, A, START, join))[0]).toMatchObject({ players: [OWNER, A] });
    });

    it("players freed by a forfeit can requeue in the same input timestamp", () => {
        const app = paired();
        const t = START + 2 * T + 1;
        accepted(adv(app, B, t, claim("1")));
        accepted(adv(app, B, t, join));
        expect(accepted(adv(app, A, t, join))[0]).toMatchObject({ matchId: "2", players: [B, A], firstMover: B });
    });
});

describe("session schedule, cutoff, reschedule", () => {
    it("a session exactly LAST_MATCH_CUTOFF long is accepted but never open (cutoffAt == sessionStart)", () => {
        const app = newApp();
        accepted(schedule(app, { sessionEnd: START + 900 }));
        expect(code(adv(app, A, START, join))).toBe("PAST_CUTOFF");
    });

    it("rescheduling mid-session keeps the queue; the next pairing uses the NEW session's id/gridSize/T", () => {
        const app = newApp();
        accepted(schedule(app));
        accepted(adv(app, A, START, join));
        accepted(schedule(app, { t: START + 1, sessionStart: START + 1, sessionEnd: START + 3601, gridSize: 4, turnTimeout: 30 }));
        const [s] = accepted(adv(app, B, START + 2, join)) as [MatchStartedNotice];
        expect(s).toMatchObject({ sessionId: 2, players: [A, B], gridSize: 4, turnTimeout: 30, forfeitDeadline: START + 2 + 60 });
    });

    it("a live match keeps its snapshotted gridSize/T after a reschedule", () => {
        const app = paired(); // gridSize 2, T=10
        accepted(schedule(app, { t: START + 1, sessionStart: START + 1, sessionEnd: START + 3601, gridSize: 6, turnTimeout: 60 }));
        accepted(adv(app, A, START + 2, move("1", TOP)));
        expect(data(app, { route: "state", matchId: "1" })).toMatchObject({ gridSize: 2, turnTimeout: T, forfeitDeadline: START + 2 + T });
        expect(code(adv(app, A, START + 2, { type: "move", matchId: "1", edge: [[2, 0], [3, 0]] }))).toBe("NOT_YOUR_TURN");
        expect(code(adv(app, B, START + 3, { type: "move", matchId: "1", edge: [[2, 0], [3, 0]] }))).toBe("OUT_OF_BOUNDS");
    });

    it("the queue is cleared by a schedule at/after the old cutoff even though sessionEnd has not passed", () => {
        const app = newApp();
        accepted(schedule(app));
        accepted(adv(app, A, CUTOFF - 1, join)); // stranded at cutoff
        expect(code(adv(app, B, CUTOFF, join))).toBe("PAST_CUTOFF");
        expect(data(app, { route: "queue" }).entries).toHaveLength(1); // stays queued, harmless
        accepted(schedule(app, { t: CUTOFF + 1, sessionStart: END + 100, sessionEnd: END + 4000 }));
        expect(data(app, { route: "queue" }).entries).toEqual([]);
    });

    it("a rejected scheduleSession neither sweeps nor clears the queue", () => {
        const app = paired();
        accepted(adv(app, C, START, join));
        const t = START + 1000; // match 1 idle > 10T
        expect(code(schedule(app, { t, sessionStart: t, sessionEnd: t + 10 }))).toBe("INVALID_SESSION");
        expect(code(adv(app, A, t, { type: "scheduleSession", sessionStart: t, sessionEnd: t + 3600 }))).toBe("NOT_OWNER");
        expect(data(app, { route: "session" }).liveMatches).toHaveLength(1);
        expect(data(app, { route: "queue" }).entries).toHaveLength(1);
    });
});

describe("overtime and sweep", () => {
    it("a match finishes normally past sessionEnd and a later schedule does not touch it", () => {
        const app = paired();
        accepted(adv(app, A, END + 1, move("1", TOP)));
        accepted(adv(app, B, END + 2, move("1", LEFT)));
        // Owner schedules the next session while the overtime match is active (idle 1s).
        expect(accepted(schedule(app, { t: END + 3, sessionStart: END + 100, sessionEnd: END + 4000 }))).toEqual([]);
        accepted(adv(app, A, END + 4, move("1", RIGHT)));
        const out = accepted(adv(app, B, END + 5, move("1", BOTTOM)));
        expect(out.map((n) => n.type)).toEqual(["Move", "MatchEnded"]);
        expect(out[1]).toMatchObject({ sessionId: 1, winner: B, durationSeconds: END + 5 - START });
    });

    it("sweep idle is measured from the last move, and uses each match's own T", () => {
        const app = paired(); // match 1, T = 10, sweepIdle 100
        accepted(adv(app, A, START + 50, move("1", TOP)));
        // A new session with T = 60 must not change match 1's threshold.
        expect(accepted(schedule(app, { t: START + 150, sessionStart: START + 150, sessionEnd: START + 4000, turnTimeout: 60 }))).toEqual([]);
        const out = accepted(schedule(app, { t: START + 151, sessionStart: START + 151, sessionEnd: START + 4000, turnTimeout: 60 }));
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ matchId: "1", abandoned: true, winner: null, loser: null, durationSeconds: 151 });
    });

    it("a swept match frees both players and rejects later claims/moves with MATCH_ENDED", () => {
        const app = paired();
        const t = START + 10 * T + 1;
        accepted(schedule(app, { t, sessionStart: t, sessionEnd: t + 3600 }));
        expect(data(app, { route: "state", player: A })).toBeNull();
        expect(code(adv(app, B, t, claim("1")))).toBe("MATCH_ENDED");
        expect(code(adv(app, A, t, move("1", TOP)))).toBe("MATCH_ENDED");
        accepted(adv(app, A, t, join));
        expect(accepted(adv(app, B, t, join))[0]).toMatchObject({ matchId: "2", sessionId: 2 });
        expect(data(app, { route: "history", matchId: "1" })?.ended).toMatchObject({ abandoned: true });
    });
});

describe("address case normalisation at ingress", () => {
    it("checksummed senders are lowercased for join, move, claim and leave; outputs carry lowercase only", () => {
        const app = newApp();
        accepted(schedule(app));
        const started = accepted(adv(app, mixed(A), START, join)).concat(accepted(adv(app, mixed(B), START, join)));
        const moved = accepted(adv(app, mixed(A), START + 1, move("1", TOP)));
        expect(code(adv(app, mixed(A), START + 2, move("1", LEFT)))).toBe("NOT_YOUR_TURN");
        const ended = accepted(adv(app, mixed(A), START + 2 + T, claim("1")));
        const all: Notice[] = [...started, ...moved, ...ended];
        const text = JSON.stringify(all);
        expect(text).not.toMatch(/0x[0-9a-f]*[A-F]/);
        expect(all[0]).toMatchObject({ players: [A, B], firstMover: A });
        expect(ended[0]).toMatchObject({ winner: A, loser: B });
    });

    it("owner config given in checksum case still authorises the lowercase sender", () => {
        const app = createApp({ owner: mixed(OWNER) });
        const r = app.advance(
            { chain_id: 1, app_contract: OWNER, msg_sender: OWNER, input_index: 0, block_number: 0, block_timestamp: START - 1, prev_randao: "0x" },
            "0x" + Buffer.from(JSON.stringify({ type: "scheduleSession", sessionStart: START, sessionEnd: END })).toString("hex"),
        );
        expect(r).toMatchObject({ status: "accept", applied: true });
    });

    it("inspect state(player) and queue entries agree regardless of the query's casing", () => {
        const app = paired();
        expect(data(app, { route: "state", player: mixed(A) })?.matchId).toBe("1");
    });
});

describe("inspect views agree with the notice stream", () => {
    it("after every accepted input of a full game, state/session/history match the notices", () => {
        const app = newApp();
        accepted(schedule(app, { gridSize: 4 }));
        accepted(adv(app, A, START, join));
        const [started] = accepted(adv(app, B, START, join)) as [MatchStartedNotice];
        let deadline: number | null = started.forfeitDeadline;
        let turn = started.firstMover;
        const recorded: unknown[] = [];
        const check = () => {
            const view = data(app, { route: "state", matchId: "1" })!;
            expect(view.forfeitDeadline).toBe(view.ended ? null : deadline);
            if (!view.ended) expect(view.turn).toBe(turn);
            expect(view.moves).toEqual(recorded);
            const hist = data(app, { route: "history", matchId: "1" })!;
            expect(hist.moves).toEqual(view.moves);
            expect(hist.ended).toEqual(view.ended);
            const live = data(app, { route: "session" }).liveMatches;
            if (view.ended) expect(live).toEqual([]);
            else {
                expect(live[0]).toMatchObject({ forfeitDeadline: deadline, turn, moveCount: recorded.length, scores: view.scores });
                expect(data(app, { route: "state", player: turn })?.matchId).toBe("1");
            }
        };
        check();
        // Every edge of a 4x4 board, played by whoever is on turn (engine decides closes/extra moves).
        const edges: Edge[] = [];
        for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) edges.push([[x, y], [x + 1, y]]);
        for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) edges.push([[x, y], [x, y + 1]]);
        let t = START;
        let ended: MatchEndedNotice | null = null;
        for (const e of edges) {
            t += 1;
            const out = accepted(adv(app, turn, t, move("1", e)));
            const m = out[0] as MoveNotice;
            const { type: _type, forfeitDeadline, ...record } = m;
            void _type;
            recorded.push(record);
            deadline = forfeitDeadline;
            turn = m.turnAfter;
            if (out[1]) ended = out[1] as MatchEndedNotice;
            check();
        }
        expect(ended).not.toBeNull();
        expect(recorded).toHaveLength(24);
        const view = data(app, { route: "state", matchId: "1" })!;
        expect(view.ended).toEqual(ended);
        expect(view.scores).toEqual(ended!.squares);
        expect(view.longestChain).toEqual(ended!.longestChain);
        const total = ended!.squares[A] + ended!.squares[B];
        expect(total).toBe(9);
        expect(ended!.winner).toBe(ended!.squares[A] > ended!.squares[B] ? A : B);
        expect(ended!.closingMove).toEqual(recorded[23]);
    });

    it("inspect is read-only even for malformed / unknown queries", () => {
        const app = paired();
        const before = snapshot(app);
        for (const p of ["0x", "0xzz", "0x" + Buffer.from('{"route":"x"}').toString("hex")]) app.inspect(p);
        expect(snapshot(app)).toEqual(before);
    });
});
