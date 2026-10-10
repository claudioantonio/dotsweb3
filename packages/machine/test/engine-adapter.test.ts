import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Dots } from "dots-engine";
import { applyMove, classify, ENGINE_VERSION, newGame, scoresOf, turnOf } from "../src/engine-adapter";
import { Reject } from "../src/reject";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);

function thrown(fn: () => unknown): unknown {
    try {
        fn();
    } catch (e) {
        return e;
    }
    throw new Error("did not throw");
}

describe("engine-adapter", () => {
    it("ENGINE_VERSION equals the installed dots-engine version", () => {
        const pkg = JSON.parse(readFileSync(join(require.resolve("dots-engine"), "../../package.json"), "utf8"));
        expect(pkg.name).toBe("dots-engine");
        expect(ENGINE_VERSION).toBe(pkg.version);
    });

    // Pins the message-prefix mapping against the real engine (TODO-engine: typed errors).
    it.each([
        ["NOT_YOUR_TURN", (g: Dots) => g.play([0, 0], [1, 0], B)],
        ["OUT_OF_BOUNDS", (g: Dots) => g.play([0, 0], [-1, 0], A)],
        ["NOT_ADJACENT", (g: Dots) => g.play([0, 0], [1, 1], A)],
        ["EDGE_TAKEN", (g: Dots) => { g.play([0, 0], [1, 0], A); g.play([0, 0], [1, 0], B); }],
        ["MATCH_ENDED", (g: Dots) => {
            g.play([0, 0], [1, 0], A); g.play([0, 0], [0, 1], B); g.play([1, 0], [1, 1], A); g.play([0, 1], [1, 1], B);
            g.play([0, 0], [1, 0], B);
        }],
    ] as const)("classifies the engine's %s message", (expected, fn) => {
        const g = new Dots(2, [A, B], "1");
        expect(classify(thrown(() => fn(g)))).toBe(expected);
    });

    it("classifies unknown errors as ENGINE_ERROR", () => {
        expect(classify(new Error("boom"))).toBe("ENGINE_ERROR");
        expect(classify("weird")).toBe("ENGINE_ERROR");
    });

    it("a rejected move does not mutate the engine game", () => {
        const g = newGame(2, [A, B], "1");
        applyMove(g, [[0, 0], [1, 0]], A);
        const before = JSON.stringify({ log: g.moveLog, turn: g.turn, scores: g.scores });
        const err = thrown(() => applyMove(g, [[1, 0], [0, 0]], B));
        expect(err).toBeInstanceOf(Reject);
        expect((err as Reject).code).toBe("EDGE_TAKEN");
        expect(JSON.stringify({ log: g.moveLog, turn: g.turn, scores: g.scores })).toBe(before);
        expect(turnOf(g)).toBe(B);
        expect(scoresOf(g)).toEqual({ [A]: 0, [B]: 0 });
    });
});
