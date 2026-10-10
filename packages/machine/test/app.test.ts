import { utf8ToHex } from "@dotsweb3/protocol";
import type { MatchEndedNotice, MatchStartedNotice, MoveNotice } from "@dotsweb3/protocol";
import { timeOf } from "../src/app";
import * as adapter from "../src/engine-adapter";
import {
    A, accepted, adv, advRaw, B, BOTTOM, C, code, CUTOFF, D, data, END, LEFT, newApp, notices, OWNER, paired, query,
    rejection, RIGHT, schedule, snapshot, START, T, TOP,
} from "./helpers";

describe("timeOf", () => {
    it("passes seconds through and converts milliseconds", () => {
        expect(timeOf({ block_timestamp: 1_700_000_000 })).toBe(1_700_000_000);
        expect(timeOf({ block_timestamp: 1_700_000_000_999 })).toBe(1_700_000_000);
    });
});

describe("envelope", () => {
    it("rejects non-hex / non-JSON payloads as MALFORMED_PAYLOAD with action null", () => {
        const app = newApp();
        for (const p of ["0xzz", utf8ToHex("not json"), utf8ToHex("[1]"), utf8ToHex('{"type":"move","matchId":1}')]) {
            const r = rejection(advRaw(app, A, START, p));
            expect(r.code).toBe("MALFORMED_PAYLOAD");
            expect(r.action).toBeNull();
        }
    });
    it("declines an oversize payload (> 1 KiB) as MALFORMED_PAYLOAD without touching state", () => {
        const app = newApp();
        const r = rejection(advRaw(app, A, START, utf8ToHex(JSON.stringify({ type: "joinQueue", pad: "x".repeat(2000) }))));
        expect(r).toMatchObject({ code: "MALFORMED_PAYLOAD", action: null });
        expect(data(app, { route: "session" }).machineTime).toBeNull();
    });
    it("rejects unknown action types", () => {
        const app = newApp();
        expect(code(advRaw(app, A, START, utf8ToHex('{"type":"rematch"}')))).toBe("UNKNOWN_ACTION");
    });
    it("a declined input (finished accept) does not set machineTime", () => {
        const app = newApp();
        expect(advRaw(app, A, START, "0x00").status).toBe("accept");
        expect(code(adv(app, A, START, { type: "joinQueue" }))).toBe("NO_OPEN_SESSION");
        expect(data(app, { route: "session" }).machineTime).toBeNull();
        accepted(schedule(app));
        expect(data(app, { route: "session" }).machineTime).toBe(START - 100);
    });
});

describe("scheduleSession", () => {
    it("rejects non-owner", () => {
        const app = newApp();
        const r = rejection(adv(app, A, 0, { type: "scheduleSession", sessionStart: START, sessionEnd: END }));
        expect(r).toMatchObject({ code: "NOT_OWNER", action: "scheduleSession" });
    });
    it("accepts owner in any casing and applies defaults", () => {
        const app = newApp();
        accepted(adv(app, OWNER.toUpperCase().replace("0X", "0x"), START, { type: "scheduleSession", sessionStart: START, sessionEnd: END }));
        const s = data(app, { route: "session" }).session;
        expect(s).toEqual({
            sessionId: 1, sessionStart: START, sessionEnd: END, cutoffAt: CUTOFF,
            gridSize: 6, turnTimeout: 60, firstMoveGrace: 120, sweepIdle: 600,
        });
    });
    it.each([
        ["start >= end", { sessionStart: END, sessionEnd: END }],
        ["end in the past", { t: END, sessionEnd: END }],
        ["shorter than cutoff", { sessionEnd: START + 899 }],
        ["odd grid", { gridSize: 3 }],
        ["grid too small", { gridSize: 0 }],
        ["grid too big", { gridSize: 12 }],
        ["timeout too short", { turnTimeout: 9 }],
        ["timeout too long", { turnTimeout: 3601 }],
        ["timeout in ms", { turnTimeout: 60_000 }],
        ["sessionEnd in ms", { sessionEnd: 1_791_623_120_000 }],
        ["both times in ms", { sessionStart: 1_791_623_120_000, sessionEnd: 1_791_626_720_000 }],
        ["sessionEnd exactly 1e12", { sessionEnd: 1e12 }],
    ])("rejects INVALID_SESSION: %s", (_n, o) => {
        const app = newApp();
        expect(code(schedule(app, o))).toBe("INVALID_SESSION");
        expect(data(app, { route: "session" }).session).toBeNull();
    });
    it("accepts the boundary values", () => {
        accepted(schedule(newApp(), { sessionEnd: START + 900, gridSize: 10, turnTimeout: 10 }));
        accepted(schedule(newApp(), { turnTimeout: 3600 }));
        accepted(schedule(newApp(), { sessionEnd: 1e12 - 1 }));
    });
    it("assigns sequential session ids", () => {
        const app = newApp();
        accepted(schedule(app));
        accepted(schedule(app));
        expect(data(app, { route: "session" }).session?.sessionId).toBe(2);
    });
});

describe("queue", () => {
    it("NO_OPEN_SESSION before any session and before sessionStart", () => {
        const app = newApp();
        expect(code(adv(app, A, START, { type: "joinQueue" }))).toBe("NO_OPEN_SESSION");
        accepted(schedule(app));
        expect(code(adv(app, A, START - 1, { type: "joinQueue" }))).toBe("NO_OPEN_SESSION");
        accepted(adv(app, A, START, { type: "joinQueue" }));
    });
    it("cutoff boundary: last second accepted, cutoffAt rejected", () => {
        const app = newApp();
        accepted(schedule(app));
        accepted(adv(app, A, CUTOFF - 1, { type: "joinQueue" }));
        expect(code(adv(app, B, CUTOFF, { type: "joinQueue" }))).toBe("PAST_CUTOFF");
    });
    it("ALREADY_QUEUED, NOT_QUEUED, leaveQueue", () => {
        const app = newApp();
        accepted(schedule(app));
        expect(code(adv(app, A, START, { type: "leaveQueue" }))).toBe("NOT_QUEUED");
        accepted(adv(app, A, START, { type: "joinQueue" }));
        expect(code(adv(app, A.toUpperCase().replace("0X", "0x"), START, { type: "joinQueue" }))).toBe("ALREADY_QUEUED");
        expect(data(app, { route: "queue" }).entries).toEqual([{ address: A, joinedAt: START }]);
        expect(accepted(adv(app, A, START + 1, { type: "leaveQueue" }))).toEqual([]);
        expect(data(app, { route: "queue" }).entries).toEqual([]);
    });
    it("pairs the first two joiners, first joiner moves first", () => {
        const app = newApp();
        accepted(schedule(app));
        expect(accepted(adv(app, A, START, { type: "joinQueue" }))).toEqual([]);
        const [n] = accepted(adv(app, B, START + 5, { type: "joinQueue" })) as [MatchStartedNotice];
        expect(n).toEqual({
            type: "MatchStarted", matchId: "1", sessionId: 1, players: [A, B], firstMover: A,
            gridSize: 2, turnTimeout: T, forfeitDeadline: START + 5 + 2 * T, timestamp: START + 5,
        });
        expect(data(app, { route: "queue" }).entries).toEqual([]);
        const view = data(app, { route: "state", player: B });
        expect(view).toMatchObject({ matchId: "1", status: "live", turn: A, scores: { [A]: 0, [B]: 0 } });
        expect(data(app, { route: "session" }).liveMatches.map((m) => m.matchId)).toEqual(["1"]);
    });
    it("IN_LIVE_MATCH", () => {
        const app = paired();
        expect(code(adv(app, A, START + 1, { type: "joinQueue" }))).toBe("IN_LIVE_MATCH");
    });
    it("can requeue after the match ends; next match id is 2", () => {
        const app = paired();
        accepted(adv(app, B, START + 2 * T + 1, { type: "claimForfeit", matchId: "1" }));
        accepted(adv(app, A, START + 30, { type: "joinQueue" }));
        const [n] = accepted(adv(app, C, START + 31, { type: "joinQueue" }));
        expect(n).toMatchObject({ type: "MatchStarted", matchId: "2", players: [A, C] });
    });
});

describe("move", () => {
    it("plays a full 2x2 match: Move notices then Move+MatchEnded", () => {
        const app = paired();
        const [m0] = accepted(adv(app, A, START + 1, { type: "move", matchId: "1", edge: TOP })) as [MoveNotice];
        expect(m0).toEqual({
            type: "Move", matchId: "1", moveIndex: 0, edge: TOP, submitter: A, squaresClosed: 0,
            turnAfter: B, timestamp: START + 1, forfeitDeadline: START + 1 + T,
        });
        accepted(adv(app, B, START + 2, { type: "move", matchId: "1", edge: LEFT }));
        accepted(adv(app, A, START + 3, { type: "move", matchId: "1", edge: RIGHT }));
        const out = accepted(adv(app, B, START + 4, { type: "move", matchId: "1", edge: BOTTOM }));
        expect(out.map((n) => n.type)).toEqual(["Move", "MatchEnded"]);
        const last = out[0] as MoveNotice;
        expect(last).toMatchObject({ squaresClosed: 1, forfeitDeadline: null, moveIndex: 3 });
        const ended = out[1] as MatchEndedNotice;
        expect(ended).toEqual({
            type: "MatchEnded", matchId: "1", sessionId: 1, players: [A, B], winner: B, loser: A,
            squares: { [A]: 0, [B]: 1 }, forfeit: false, zeroMoveForfeit: false, abandoned: false,
            durationSeconds: 4, longestChain: { [A]: 0, [B]: 1 },
            closingMove: {
                matchId: "1", moveIndex: 3, edge: BOTTOM, submitter: B, squaresClosed: 1, turnAfter: B, timestamp: START + 4,
            },
            finalBoardHash: null, engineVersion: "0.1.0-alpha.0", timestamp: START + 4,
        });
        const view = data(app, { route: "state", matchId: "1" });
        expect(view).toMatchObject({ status: "ended", forfeitDeadline: null, ended });
        expect(view?.moves).toHaveLength(4);
        expect(data(app, { route: "state", player: A })).toBeNull();
        expect(data(app, { route: "session" }).liveMatches).toEqual([]);
        expect(code(adv(app, A, START + 5, { type: "move", matchId: "1", edge: TOP }))).toBe("MATCH_ENDED");
        const hist = data(app, { route: "history", matchId: "1" });
        expect(hist).toMatchObject({ matchId: "1", gridSize: 2, players: [A, B], ended });
    });

    it("extra move on close keeps the turn (4x4 board)", () => {
        const app = newApp();
        accepted(schedule(app, { gridSize: 4 }));
        accepted(adv(app, A, START, { type: "joinQueue" }));
        accepted(adv(app, B, START, { type: "joinQueue" }));
        const mv = (s: string, e: [[number, number], [number, number]]) =>
            accepted(adv(app, s, START + 1, { type: "move", matchId: "1", edge: e }))[0] as MoveNotice;
        mv(A, TOP);
        mv(B, LEFT);
        mv(A, RIGHT);
        const close = mv(B, BOTTOM);
        expect(close).toMatchObject({ squaresClosed: 1, turnAfter: B });
        expect(mv(B, [[2, 0], [3, 0]]).turnAfter).toBe(A);
    });

    it.each([
        ["NO_SUCH_MATCH", A, "9", TOP],
        ["NOT_A_PLAYER", C, "1", TOP],
        ["NOT_YOUR_TURN", B, "1", TOP],
        ["OUT_OF_BOUNDS", A, "1", [[0, 0], [2, 0]]],
        ["NOT_ADJACENT", A, "1", [[0, 0], [1, 1]]],
    ] as const)("rejects %s", (expected, sender, matchId, edge) => {
        const app = paired();
        const r = rejection(adv(app, sender, START + 1, { type: "move", matchId, edge: edge as never }));
        expect(r).toMatchObject({ code: expected, action: "move" });
    });

    it("Rejected report carries matchId for move and claimForfeit, omits it otherwise", () => {
        const app = paired();
        expect(rejection(adv(app, B, START + 1, { type: "move", matchId: "1", edge: TOP }))).toEqual({
            type: "Rejected", action: "move", matchId: "1", code: "NOT_YOUR_TURN",
            message: expect.any(String),
        });
        expect(rejection(adv(app, C, START + 1, { type: "claimForfeit", matchId: "9" }))).toMatchObject({
            action: "claimForfeit", matchId: "9", code: "NO_SUCH_MATCH",
        });
        const q = rejection(adv(app, A, START + 1, { type: "joinQueue" }));
        expect("matchId" in q).toBe(false);
        expect(Object.keys(rejection(advRaw(app, A, START + 1, "0x00")))).toEqual(["type", "action", "code", "message"]);
    });

    it("ENGINE_ERROR (unexpected throw) finishes reject so the node rolls back", () => {
        const app = paired();
        const spy = jest.spyOn(adapter, "applyMove").mockImplementation(() => {
            throw new Error("boom");
        });
        try {
            const r = adv(app, A, START + 1, { type: "move", matchId: "1", edge: TOP });
            expect(r.status).toBe("reject");
            expect(rejection(r)).toMatchObject({ code: "ENGINE_ERROR", matchId: "1" });
        } finally {
            spy.mockRestore();
        }
    });

    it("rejects EDGE_TAKEN (also with reversed endpoints)", () => {
        const app = paired();
        accepted(adv(app, A, START + 1, { type: "move", matchId: "1", edge: TOP }));
        expect(code(adv(app, B, START + 2, { type: "move", matchId: "1", edge: [[1, 0], [0, 0]] }))).toBe("EDGE_TAKEN");
    });

    it("accepts a late move while nobody has claimed (deadline resets)", () => {
        const app = paired();
        const [n] = accepted(adv(app, A, START + 10 * T, { type: "move", matchId: "1", edge: TOP })) as [MoveNotice];
        expect(n.forfeitDeadline).toBe(START + 10 * T + T);
    });

    it("overtime: a match past sessionEnd keeps playing", () => {
        const app = paired();
        accepted(adv(app, A, END + 5, { type: "move", matchId: "1", edge: TOP }));
    });

    it("same-timestamp inputs resolve in call order", () => {
        const app = paired();
        accepted(adv(app, A, START, { type: "move", matchId: "1", edge: TOP }));
        expect(code(adv(app, A, START, { type: "move", matchId: "1", edge: LEFT }))).toBe("NOT_YOUR_TURN");
        accepted(adv(app, B, START, { type: "move", matchId: "1", edge: LEFT }));
    });
});

describe("claimForfeit", () => {
    it("grace on move 0: deadline startedAt + 2T, now == deadline rejects, +1 accepts; zero-move forfeit", () => {
        const app = paired();
        const deadline = START + 2 * T;
        expect(data(app, { route: "state", matchId: "1" })?.forfeitDeadline).toBe(deadline);
        expect(code(adv(app, B, deadline, { type: "claimForfeit", matchId: "1" }))).toBe("DEADLINE_NOT_ELAPSED");
        const [e] = accepted(adv(app, B, deadline + 1, { type: "claimForfeit", matchId: "1" })) as [MatchEndedNotice];
        expect(e).toMatchObject({
            type: "MatchEnded", winner: B, loser: A, forfeit: true, zeroMoveForfeit: true, abandoned: false,
            closingMove: null, durationSeconds: 2 * T + 1, squares: { [A]: 0, [B]: 0 },
        });
    });

    it("after a move the deadline is lastMoveAt + T; not a zero-move forfeit if loser moved", () => {
        const app = paired();
        accepted(adv(app, A, START + 1, { type: "move", matchId: "1", edge: TOP }));
        accepted(adv(app, B, START + 2, { type: "move", matchId: "1", edge: LEFT }));
        // A on turn; B waits.
        expect(code(adv(app, B, START + 2 + T, { type: "claimForfeit", matchId: "1" }))).toBe("DEADLINE_NOT_ELAPSED");
        const [e] = accepted(adv(app, B, START + 3 + T, { type: "claimForfeit", matchId: "1" })) as [MatchEndedNotice];
        expect(e).toMatchObject({ winner: B, loser: A, zeroMoveForfeit: false });
    });

    it("zeroMoveForfeit when the second mover never moved", () => {
        const app = paired();
        accepted(adv(app, A, START + 1, { type: "move", matchId: "1", edge: TOP }));
        const [e] = accepted(adv(app, A, START + 2 + T, { type: "claimForfeit", matchId: "1" })) as [MatchEndedNotice];
        expect(e).toMatchObject({ winner: A, loser: B, zeroMoveForfeit: true });
    });

    it("rejects NOT_THE_WAITING_PLAYER, NOT_A_PLAYER, NO_SUCH_MATCH", () => {
        const app = paired();
        const t = START + 100;
        expect(code(adv(app, A, t, { type: "claimForfeit", matchId: "1" }))).toBe("NOT_THE_WAITING_PLAYER");
        expect(code(adv(app, C, t, { type: "claimForfeit", matchId: "1" }))).toBe("NOT_A_PLAYER");
        expect(code(adv(app, B, t, { type: "claimForfeit", matchId: "2" }))).toBe("NO_SUCH_MATCH");
    });

    it("forfeit race: move-then-claim → claim rejected", () => {
        const app = paired();
        const t = START + 2 * T + 5;
        accepted(adv(app, A, t, { type: "move", matchId: "1", edge: TOP }));
        // A moved, now B on turn → A is waiting but deadline not elapsed; B is on turn.
        expect(code(adv(app, B, t, { type: "claimForfeit", matchId: "1" }))).toBe("NOT_THE_WAITING_PLAYER");
    });

    it("forfeit race: claim-then-move → move rejected MATCH_ENDED", () => {
        const app = paired();
        const t = START + 2 * T + 5;
        accepted(adv(app, B, t, { type: "claimForfeit", matchId: "1" }));
        const r = rejection(adv(app, A, t, { type: "move", matchId: "1", edge: TOP }));
        expect(r).toMatchObject({ code: "MATCH_ENDED", action: "move" });
        expect(code(adv(app, B, t, { type: "claimForfeit", matchId: "1" }))).toBe("MATCH_ENDED");
    });
});

describe("sweep on scheduleSession", () => {
    function twoMatches() {
        const app = paired(); // match 1 at START (A,B)
        accepted(adv(app, C, START + 50, { type: "joinQueue" }));
        accepted(adv(app, D, START + 50, { type: "joinQueue" })); // match 2 at START+50 (C,D)
        return app;
    }
    it("abandons matches idle > 10T in ascending matchId, spares idle == 10T", () => {
        const app = twoMatches();
        const t = START + 50 + 10 * T; // match1 idle 10T+50, match2 idle exactly 10T
        const out = accepted(schedule(app, { t, sessionStart: t, sessionEnd: t + 3600 }));
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            type: "MatchEnded", matchId: "1", winner: null, loser: null, abandoned: true, forfeit: false, closingMove: null,
        });
        expect(data(app, { route: "session" }).liveMatches.map((m) => m.matchId)).toEqual(["2"]);
        const out2 = accepted(schedule(app, { t: t + 1, sessionStart: t, sessionEnd: t + 3600 }));
        expect(out2.map((n) => (n as MatchEndedNotice).matchId)).toEqual(["2"]);
    });
    it("sweeps several matches in ascending order", () => {
        const app = twoMatches();
        const t = START + 1000;
        const out = notices(schedule(app, { t, sessionStart: t, sessionEnd: t + 3600 }));
        expect(out.map((n) => (n as MatchEndedNotice).matchId)).toEqual(["1", "2"]);
    });
    it("keeps the queue during an open session, clears it after cutoff", () => {
        const app = newApp();
        accepted(schedule(app));
        accepted(adv(app, A, START, { type: "joinQueue" }));
        accepted(schedule(app, { t: START + 1 }));
        expect(data(app, { route: "queue" }).entries).toHaveLength(1);
        accepted(schedule(app, { t: CUTOFF, sessionStart: CUTOFF, sessionEnd: CUTOFF + 3600 }));
        expect(data(app, { route: "queue" }).entries).toHaveLength(0);
    });
});

describe("rejected inputs do not mutate state", () => {
    it("every rejection leaves all inspect views byte-identical", () => {
        const app = paired();
        accepted(adv(app, A, START + 1, { type: "move", matchId: "1", edge: TOP }));
        accepted(adv(app, C, START + 1, { type: "joinQueue" }));
        const before = snapshot(app);
        const t = START + 2;
        const bad = [
            advRaw(app, A, t, "0x1234"),
            adv(app, A, t, { type: "scheduleSession", sessionStart: 0, sessionEnd: 1 }),
            adv(app, OWNER, t, { type: "scheduleSession", sessionStart: START, sessionEnd: START + 10 }),
            adv(app, C, t, { type: "joinQueue" }),
            adv(app, A, t, { type: "joinQueue" }),
            adv(app, D, t, { type: "leaveQueue" }),
            adv(app, A, t, { type: "move", matchId: "1", edge: LEFT }),
            adv(app, B, t, { type: "move", matchId: "1", edge: TOP }),
            adv(app, B, t, { type: "move", matchId: "1", edge: [[0, 0], [5, 0]] }),
            adv(app, B, t, { type: "claimForfeit", matchId: "1" }),
            adv(app, A, t, { type: "claimForfeit", matchId: "1" }),
            adv(app, C, t, { type: "move", matchId: "1", edge: LEFT }),
        ];
        for (const r of bad) {
            expect(r.status).toBe("accept"); // declined, not REJECTED: the node keeps the report
            expect(r.applied).toBe(false);
            expect(r.notices).toEqual([]);
            expect(r.reports).toHaveLength(1);
        }
        expect(snapshot(app)).toEqual(before); // includes machineTime (session view)
    });
});

describe("inspect", () => {
    it("rejects malformed and unknown routes with one response", () => {
        const app = newApp();
        expect(decodeAny(app.inspect("0xzz"))).toMatchObject({ ok: false, code: "MALFORMED_PAYLOAD" });
        expect(query(app, { route: "nope" } as never)).toMatchObject({ ok: false, code: "UNKNOWN_ROUTE" });
    });
    it("unwraps a {payload} wrapper and lowercases player", () => {
        const app = paired();
        const inner = utf8ToHex(JSON.stringify({ route: "state", player: B.toUpperCase().replace("0X", "0x") }));
        const res = decodeAny(app.inspect(utf8ToHex(JSON.stringify({ payload: inner }))));
        expect(res).toMatchObject({ ok: true, route: "state", data: { matchId: "1" } });
    });
    it("returns null for unknown match/history", () => {
        const app = newApp();
        expect(data(app, { route: "state", matchId: "7" })).toBeNull();
        expect(data(app, { route: "history", matchId: "7" })).toBeNull();
        expect(data(app, { route: "session" })).toEqual({
            session: null, liveMatches: [], queueLength: 0, machineTime: null, engineVersion: "0.1.0-alpha.0",
        });
    });
    it("does not change machineTime or anything else", () => {
        const app = paired();
        const before = snapshot(app);
        snapshot(app);
        expect(snapshot(app)).toEqual(before);
    });
});

function decodeAny(hex: string): unknown {
    return JSON.parse(Buffer.from(hex.slice(2), "hex").toString("utf8"));
}
