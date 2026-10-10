/**
 * Determinism / replay across the wire: the machine's history fed to the
 * FRONTEND's replay driver (same dots-engine pin) must rebuild the board with
 * zero divergence and the same scores/chains the machine reported (F13).
 * Also: identical outputs regardless of timestamp unit or sender casing.
 */
import { decodeNotice, encodeAction, utf8ToHex } from "@dotsweb3/protocol";
import type { Action, MatchEndedNotice } from "@dotsweb3/protocol";
import { buildFrames, verify } from "../../frontend/src/state/replay";
import { ENGINE_VERSION as FRONTEND_ENGINE_VERSION } from "../../frontend/src/engine-adapter";
import { ENGINE_VERSION } from "../src/engine-adapter";
import { createApp, type Result } from "../src/app";
import { A, accepted, adv, B, data, newApp, OWNER, schedule, START } from "./helpers";

type Edge = [[number, number], [number, number]];

function allEdges(n: number): Edge[] {
    const edges: Edge[] = [];
    // Interleave rows/columns so closes and extra moves happen mid-game.
    for (let y = 0; y < n; y++) for (let x = 0; x < n - 1; x++) edges.push([[x, y], [x + 1, y]]);
    for (let x = 0; x < n; x++) for (let y = 0; y < n - 1; y++) edges.push([[x, y], [x, y + 1]]);
    return edges;
}

describe("machine history → frontend replay", () => {
    it.each([2, 4, 6])("gridSize %i replays with zero divergence and matching final scores", (gridSize) => {
        const app = newApp();
        accepted(schedule(app, { gridSize }));
        accepted(adv(app, A, START, { type: "joinQueue" }));
        accepted(adv(app, B, START, { type: "joinQueue" }));
        let turn = A;
        let ended: MatchEndedNotice | null = null;
        allEdges(gridSize).forEach((e, i) => {
            const out = accepted(adv(app, turn, START + 1 + i, { type: "move", matchId: "1", edge: e }));
            turn = (out[0] as { turnAfter: string }).turnAfter;
            if (out[1]) ended = out[1] as MatchEndedNotice;
        });
        expect(ended).not.toBeNull();
        const hist = data(app, { route: "history", matchId: "1" })!;
        const r = buildFrames(hist);
        expect(r.divergence).toBeNull();
        expect(r.frames).toHaveLength(hist.moves.length + 1);
        const last = r.frames[r.frames.length - 1];
        expect(last.over).toBe(true);
        expect(last.scores[A] ?? 0).toBe(ended!.squares[A]);
        expect(last.scores[B] ?? 0).toBe(ended!.squares[B]);
        expect(last.longestChain[A] ?? 0).toBe(ended!.longestChain[A]);
        expect(last.longestChain[B] ?? 0).toBe(ended!.longestChain[B]);
        expect(last.squares).toHaveLength((gridSize - 1) ** 2);
        expect(verify({
            divergence: r.divergence, moveCount: hist.moves.length, replayHash: r.replayHash,
            onChainHash: ended!.finalBoardHash, onChainEngineVersion: ended!.engineVersion,
        }).status).toBe("unavailable"); // hash stub until TODO-engine
    });

    it("machine and frontend adapters declare the same engine version", () => {
        expect(FRONTEND_ENGINE_VERSION).toBe(ENGINE_VERSION);
    });
});

describe("determinism of outputs", () => {
    // Realistic epoch seconds: the ms heuristic in timeOf() only kicks in at >= 1e12.
    const S0 = 1_800_000_000;
    const run = (ms: boolean, casing: (s: string) => string) => {
        const app = createApp({ owner: OWNER });
        let i = 0;
        const step = (sender: string, t: number, payload: string): Result =>
            app.advance(
                { chain_id: 31337, app_contract: "0x" + "e".repeat(40), msg_sender: casing(sender), input_index: i, block_number: i++,
                  block_timestamp: ms ? t * 1000 + 999 : t, prev_randao: "0x" },
                payload,
            );
        const act = (sender: string, t: number, a: Action) => step(sender, t, encodeAction(a));
        const outs: Result[] = [
            act(OWNER, S0 - 1, { type: "scheduleSession", sessionStart: S0, sessionEnd: S0 + 3600, gridSize: 2, turnTimeout: 10 }),
            step(A, S0, "0xzz"),
            step(A, S0, utf8ToHex('{"type":"joinQueue","noise":[1,2,3]}')),
            act(B, S0, { type: "joinQueue" }),
            act(B, S0 + 1, { type: "move", matchId: "1", edge: [[0, 0], [1, 0]] }),
            act(A, S0 + 2, { type: "move", matchId: "1", edge: [[0, 0], [1, 0]] }),
            act(A, S0 + 50, { type: "claimForfeit", matchId: "1" }),
            act(B, S0 + 50, { type: "move", matchId: "1", edge: [[1, 0], [0, 0]] }),
        ];
        return { outs, inspect: app.inspect(utf8ToHex('{"route":"session"}')) };
    };
    const lower = (s: string) => s.toLowerCase();
    const upper = (s: string) => "0x" + s.slice(2).toUpperCase();

    it("seconds vs milliseconds block_timestamp and sender casing give byte-identical outputs", () => {
        const base = run(false, lower);
        expect(run(true, lower)).toEqual(base);
        expect(run(false, upper)).toEqual(base);
        expect(run(true, upper)).toEqual(base);
        const ended = base.outs[6].notices.map(decodeNotice);
        expect(ended[0]).toMatchObject({ type: "MatchEnded", forfeit: true, winner: A });
    });
});

describe("timeOf boundary", () => {
    it("values below 1e12 are seconds, 1e12 and above are milliseconds (floored)", async () => {
        const { timeOf } = await import("../src/app");
        expect(timeOf({ block_timestamp: 1e12 - 1 })).toBe(1e12 - 1);
        expect(timeOf({ block_timestamp: 1e12 })).toBe(1e9);
        expect(timeOf({ block_timestamp: 1_791_629_718_999 })).toBe(1_791_629_718);
        // Rollups v2 node delivered seconds on devnet (raw 0x6aca1998 = 1791629720).
        expect(timeOf({ block_timestamp: 0x6aca1998 })).toBe(1_791_629_720);
    });
});
