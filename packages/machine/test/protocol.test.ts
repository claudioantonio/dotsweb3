/**
 * @dotsweb3/protocol codecs: round-trips and malformed input (architecture §1.1).
 * Validators check shape only, never legality.
 */
import {
    decodeAction,
    decodeInspectQuery,
    decodeInspectResponse,
    decodeJson,
    decodeNotice,
    decodeRejected,
    encodeAction,
    MAX_ACTION_BYTES,
    encodeInspectQuery,
    encodeInspectResponse,
    encodeJson,
    encodeRejected,
    hexToUtf8,
    ProtocolError,
    utf8ToHex,
} from "@dotsweb3/protocol";
import type { Action, InspectQuery } from "@dotsweb3/protocol";

const hexOf = (text: string) => utf8ToHex(text);
const json = (v: unknown) => utf8ToHex(JSON.stringify(v));

function codeOf(fn: () => unknown): string {
    try {
        fn();
    } catch (err) {
        if (err instanceof ProtocolError) return err.code;
        return `non-protocol error: ${String(err)}`;
    }
    return "no error";
}

describe("hex / utf-8", () => {
    it("round-trips multi-byte utf-8", () => {
        const text = 'ação ✓ 𝔇 "quoted" \\ \n';
        expect(hexToUtf8(utf8ToHex(text))).toBe(text);
    });
    it("accepts 0x, 0X and no prefix, upper and lower case hex", () => {
        expect(hexToUtf8("0x6869")).toBe("hi");
        expect(hexToUtf8("0X6869")).toBe("hi");
        expect(hexToUtf8("6869")).toBe("hi");
        expect(hexToUtf8("0x4A4b")).toBe("JK");
        expect(hexToUtf8("0x")).toBe("");
    });
    it.each([
        ["odd length", "0x123"],
        ["non-hex chars", "0xzz"],
        ["embedded space", "0x68 69"],
        ["overlong utf-8 encoding of '/'", "0xc0af"],
        ["lone continuation byte", "0x80"],
        ["truncated multi-byte", "0xe282"],
    ])("rejects %s as MALFORMED_PAYLOAD", (_n, hex) => {
        expect(codeOf(() => hexToUtf8(hex))).toBe("MALFORMED_PAYLOAD");
    });
    it("non-JSON and empty payloads are MALFORMED_PAYLOAD", () => {
        expect(codeOf(() => decodeJson("0x"))).toBe("MALFORMED_PAYLOAD");
        expect(codeOf(() => decodeJson(hexOf("{")))).toBe("MALFORMED_PAYLOAD");
        expect(codeOf(() => decodeJson(hexOf("NaN")))).toBe("MALFORMED_PAYLOAD");
    });
    it("deeply nested JSON is a ProtocolError, never an escaping RangeError", () => {
        const deep = "[".repeat(200_000) + "]".repeat(200_000);
        // Now declined by the size cap before parsing; still never an escaping RangeError.
        expect(codeOf(() => decodeAction(hexOf(deep)))).toBe("MALFORMED_PAYLOAD");
    });
    it("encodeJson is byte-stable for the same literal", () => {
        expect(encodeJson({ a: 1, b: [2] })).toBe(encodeJson({ a: 1, b: [2] }));
    });
});

describe("decodeAction", () => {
    const actions: Action[] = [
        { type: "joinQueue" },
        { type: "leaveQueue" },
        { type: "move", matchId: "1", edge: [[0, 0], [1, 0]] },
        { type: "move", matchId: "9007199254740991", edge: [[-1, 5], [99, 0]] }, // shape only: legality is the engine's
        { type: "claimForfeit", matchId: "42" },
        { type: "scheduleSession", sessionStart: 1, sessionEnd: 2 },
        { type: "scheduleSession", sessionStart: 1, sessionEnd: 2, gridSize: 4, turnTimeout: 30 },
    ];
    it.each(actions.map((a) => [JSON.stringify(a), a] as const))("round-trips %s", (_n, a) => {
        expect(decodeAction(encodeAction(a))).toEqual(a);
    });

    it("drops unknown fields and returns a fresh object", () => {
        expect(decodeAction(json({ type: "joinQueue", extra: 1, matchId: "3" }))).toEqual({ type: "joinQueue" });
        const raw = { type: "move", matchId: "1", edge: [[0, 0], [1, 0]], submitter: "0xevil", __proto__x: 1 };
        expect(decodeAction(json(raw))).toEqual({ type: "move", matchId: "1", edge: [[0, 0], [1, 0]] });
        expect(decodeAction(json({ type: "claimForfeit", matchId: "1", winner: "me" }))).toEqual({ type: "claimForfeit", matchId: "1" });
    });

    it("a __proto__ key in the payload cannot pollute anything", () => {
        const a = decodeAction(hexOf('{"type":"joinQueue","__proto__":{"polluted":true}}'));
        expect(a).toEqual({ type: "joinQueue" });
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("treats integral floats as integers (1.0 is JSON 1)", () => {
        expect(decodeAction(hexOf('{"type":"move","matchId":"1","edge":[[0,0],[1.0,0]]}'))).toEqual({
            type: "move", matchId: "1", edge: [[0, 0], [1, 0]],
        });
    });

    it.each([
        ["array", []],
        ["null", null],
        ["string", "joinQueue"],
        ["number type", { type: 1 }],
        ["missing type", { matchId: "1" }],
        ["move numeric matchId", { type: "move", matchId: 1, edge: [[0, 0], [1, 0]] }],
        ["move matchId 0", { type: "move", matchId: "0", edge: [[0, 0], [1, 0]] }],
        ["move matchId leading zero", { type: "move", matchId: "01", edge: [[0, 0], [1, 0]] }],
        ["move matchId 17 digits", { type: "move", matchId: "1".repeat(17), edge: [[0, 0], [1, 0]] }],
        ["move matchId negative", { type: "move", matchId: "-1", edge: [[0, 0], [1, 0]] }],
        ["move matchId hex", { type: "move", matchId: "0x1", edge: [[0, 0], [1, 0]] }],
        ["move missing edge", { type: "move", matchId: "1" }],
        ["move edge of 3 dots", { type: "move", matchId: "1", edge: [[0, 0], [1, 0], [2, 0]] }],
        ["move 3-element coord", { type: "move", matchId: "1", edge: [[0, 0, 0], [1, 0]] }],
        ["move fractional coord", { type: "move", matchId: "1", edge: [[0, 0], [1.5, 0]] }],
        ["move string coord", { type: "move", matchId: "1", edge: [["0", 0], [1, 0]] }],
        ["move unsafe-integer coord", { type: "move", matchId: "1", edge: [[2 ** 53, 0], [1, 0]] }],
        ["move object edge", { type: "move", matchId: "1", edge: { from: [0, 0], to: [1, 0] } }],
        ["claim missing matchId", { type: "claimForfeit" }],
        ["schedule string times", { type: "scheduleSession", sessionStart: "1", sessionEnd: 2 }],
        ["schedule float time", { type: "scheduleSession", sessionStart: 1.5, sessionEnd: 2 }],
        ["schedule null gridSize", { type: "scheduleSession", sessionStart: 1, sessionEnd: 2, gridSize: null }],
        ["schedule string turnTimeout", { type: "scheduleSession", sessionStart: 1, sessionEnd: 2, turnTimeout: "60" }],
    ])("MALFORMED_PAYLOAD: %s", (_n, raw) => {
        expect(codeOf(() => decodeAction(json(raw)))).toBe("MALFORMED_PAYLOAD");
    });

    it.each(["JoinQueue", "rematch", "", "move "])("UNKNOWN_ACTION for type %j", (type) => {
        expect(codeOf(() => decodeAction(json({ type })))).toBe("UNKNOWN_ACTION");
    });

    it("UNKNOWN_ACTION message truncates an attacker-sized type", () => {
        try {
            decodeAction(json({ type: "x".repeat(100_000) }));
            throw new Error("expected throw");
        } catch (err) {
            expect((err as Error).message.length).toBeLessThan(80);
        }
    });

    describe(`size cap (MAX_ACTION_BYTES = ${MAX_ACTION_BYTES})`, () => {
        // {"type":"leaveQueue","pad":"…"} padded to an exact decoded byte length.
        const padded = (bytes: number) => {
            const base = '{"type":"leaveQueue","pad":""}';
            return hexOf(base.slice(0, -2) + "x".repeat(bytes - base.length) + '"}');
        };
        it("is 1 KiB", () => expect(MAX_ACTION_BYTES).toBe(1024));
        it("accepts exactly 1024 bytes", () => {
            expect((padded(1024).length - 2) / 2).toBe(1024);
            expect(decodeAction(padded(1024))).toEqual({ type: "leaveQueue" });
        });
        it("declines 1025 bytes as MALFORMED_PAYLOAD", () => {
            expect(codeOf(() => decodeAction(padded(1025)))).toBe("MALFORMED_PAYLOAD");
        });
        it("counts bytes without the 0x prefix (also when absent)", () => {
            expect(decodeAction(padded(1024).slice(2))).toEqual({ type: "leaveQueue" });
            expect(codeOf(() => decodeAction(padded(1025).slice(2)))).toBe("MALFORMED_PAYLOAD");
        });
        it("declines a ~1 MB payload fast, before decoding (even if it is not valid hex)", () => {
            const huge = "0x" + "zz".repeat(1_000_000);
            const bigValid = json({ type: "leaveQueue", pad: "x".repeat(1_000_000) });
            const t0 = process.hrtime.bigint();
            expect(codeOf(() => decodeAction(huge))).toBe("MALFORMED_PAYLOAD");
            expect(codeOf(() => decodeAction(bigValid))).toBe("MALFORMED_PAYLOAD");
            expect(Number(process.hrtime.bigint() - t0) / 1e6).toBeLessThan(50);
        });
        it("decodeJson stays uncapped (large inspect responses)", () => {
            expect(decodeJson(hexOf(JSON.stringify({ pad: "x".repeat(100_000) })))).toEqual({ pad: "x".repeat(100_000) });
        });
    });
});

describe("decodeInspectQuery", () => {
    const P = "0x" + "ab".repeat(20);
    const queries: InspectQuery[] = [
        { route: "queue" },
        { route: "session" },
        { route: "history", matchId: "3" },
        { route: "state", matchId: "3" },
        { route: "state", player: P },
    ];
    it.each(queries.map((q) => [JSON.stringify(q), q] as const))("round-trips %s through the raw POST body", (_n, q) => {
        expect(decodeInspectQuery(utf8ToHex(encodeInspectQuery(q)))).toEqual(q);
    });
    it("lowercases a checksummed player", () => {
        expect(decodeInspectQuery(json({ route: "state", player: "0x" + "AB".repeat(20) }))).toEqual({ route: "state", player: P });
    });
    it("prefers matchId when both matchId and player are given", () => {
        expect(decodeInspectQuery(json({ route: "state", matchId: "2", player: P }))).toEqual({ route: "state", matchId: "2" });
    });
    it("unwraps exactly one {payload} wrapper", () => {
        const inner = json({ route: "session" });
        expect(decodeInspectQuery(json({ payload: inner }))).toEqual({ route: "session" });
        expect(codeOf(() => decodeInspectQuery(json({ payload: json({ payload: inner }) })))).toBe("MALFORMED_PAYLOAD");
        expect(codeOf(() => decodeInspectQuery(json({ payload: "0xzz" })))).toBe("MALFORMED_PAYLOAD");
    });
    it("does not unwrap when a route is present alongside payload", () => {
        expect(decodeInspectQuery(json({ route: "queue", payload: json({ route: "session" }) }))).toEqual({ route: "queue" });
    });
    it.each([
        ["no route", {}],
        ["numeric route", { route: 1 }],
        ["state without id", { route: "state" }],
        ["state numeric matchId", { route: "state", matchId: 1 }],
        ["state short address", { route: "state", player: "0xabc" }],
        ["state 0X-prefixed address", { route: "state", player: "0X" + "ab".repeat(20) }],
        ["history without matchId", { route: "history" }],
    ])("MALFORMED_PAYLOAD: %s", (_n, raw) => {
        expect(codeOf(() => decodeInspectQuery(json(raw)))).toBe("MALFORMED_PAYLOAD");
    });
    it("UNKNOWN_ROUTE for unknown routes", () => {
        expect(codeOf(() => decodeInspectQuery(json({ route: "matches" })))).toBe("UNKNOWN_ROUTE");
    });
});

describe("notice / report / inspect-response decoders", () => {
    it("decodeNotice checks only the discriminant", () => {
        expect(decodeNotice(json({ type: "Move", matchId: "1" }))).toMatchObject({ type: "Move" });
        for (const bad of [{ type: "Rejected" }, { type: "move" }, [], null]) {
            expect(codeOf(() => decodeNotice(json(bad)))).toBe("MALFORMED_PAYLOAD");
        }
    });
    it("decodeRejected round-trips with and without matchId", () => {
        const withId = { type: "Rejected", action: "move", matchId: "4", code: "EDGE_TAKEN", message: "m" } as const;
        const without = { type: "Rejected", action: null, code: "MALFORMED_PAYLOAD", message: "m" } as const;
        expect(decodeRejected(encodeRejected(withId))).toEqual(withId);
        expect(decodeRejected(encodeRejected(without))).toEqual(without);
        expect(codeOf(() => decodeRejected(json({ type: "MatchEnded" })))).toBe("MALFORMED_PAYLOAD");
    });
    it("a notice is never mistaken for a Rejected report and vice versa", () => {
        const report = encodeRejected({ type: "Rejected", action: "joinQueue", code: "NOT_QUEUED", message: "" });
        expect(codeOf(() => decodeNotice(report))).toBe("MALFORMED_PAYLOAD");
    });
    it("decodeInspectResponse round-trips ok and error envelopes", () => {
        const ok = { ok: true as const, route: "queue" as const, data: { entries: [] } };
        const err = { ok: false as const, code: "UNKNOWN_ROUTE" as const, message: "x" };
        expect(decodeInspectResponse(encodeInspectResponse(ok))).toEqual(ok);
        expect(decodeInspectResponse(encodeInspectResponse(err))).toEqual(err);
        expect(codeOf(() => decodeInspectResponse(json({ ok: "yes" })))).toBe("MALFORMED_PAYLOAD");
    });
});
