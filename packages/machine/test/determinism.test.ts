import type { Action } from "@dotsweb3/protocol";
import { adv, A, B, BOTTOM, C, D, END, LEFT, newApp, OWNER, RIGHT, START, T, TOP } from "./helpers";

/** 50-input deterministic script mixing accepts and rejects (no randomness: fixed LCG). */
function script(): [string, number, Action][] {
    const players = [A, B, C, D];
    const edges = [TOP, LEFT, RIGHT, BOTTOM];
    const out: [string, number, Action][] = [
        [OWNER, START - 10, { type: "scheduleSession", sessionStart: START, sessionEnd: END, gridSize: 2, turnTimeout: T }],
    ];
    let seed = 7;
    for (let i = 1; i < 50; i++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        const p = players[seed % 4];
        const t = START + i * 3;
        const k = (seed >> 4) % 5;
        const matchId = String(1 + ((seed >> 8) % 2));
        const action: Action =
            k === 0 ? { type: "joinQueue" }
            : k === 1 ? { type: "leaveQueue" }
            : k === 2 ? { type: "claimForfeit", matchId }
            : { type: "move", matchId, edge: edges[(seed >> 12) % 4] };
        out.push([p, t, action]);
    }
    return out;
}

it("same 50-input script into two fresh apps yields identical outputs", () => {
    const run = () => {
        const app = newApp();
        const outs = script().map(([s, t, a]) => adv(app, s, t, a));
        return { outs, accepted: outs.filter((r) => r.applied).length };
    };
    const r1 = run();
    const r2 = run();
    expect(r1.outs).toEqual(r2.outs);
    expect(r1.accepted).toBeGreaterThan(5);
    expect(r1.outs.some((r) => !r.applied && r.reports.length === 1)).toBe(true);
});
