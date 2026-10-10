import { decodeInspectResponse, decodeNotice, decodeRejected, encodeAction, encodeInspectQuery, utf8ToHex } from "@dotsweb3/protocol";
import type { Action, InspectQuery, InspectResponse, InspectRoute, Notice, RejectedReport } from "@dotsweb3/protocol";
import { createApp, type App, type Result } from "../src/app";

export const OWNER = "0x" + "0".repeat(39) + "1";
export const A = "0x" + "a".repeat(40);
export const B = "0x" + "b".repeat(40);
export const C = "0x" + "c".repeat(40);
export const D = "0x" + "d".repeat(40);

export const T = 10; // turnTimeout used by tests
export const START = 1_000_000;
export const END = START + 3600;
export const CUTOFF = END - 900;

export const TOP: [[number, number], [number, number]] = [[0, 0], [1, 0]];
export const LEFT: [[number, number], [number, number]] = [[0, 0], [0, 1]];
export const RIGHT: [[number, number], [number, number]] = [[1, 0], [1, 1]];
export const BOTTOM: [[number, number], [number, number]] = [[0, 1], [1, 1]];

let inputIndex = 0;

export function newApp(): App {
    inputIndex = 0;
    return createApp({ owner: OWNER });
}

export function advRaw(app: App, sender: string, t: number, payload: string): Result {
    return app.advance(
        {
            chain_id: 31337,
            app_contract: "0x" + "e".repeat(40),
            msg_sender: sender,
            input_index: inputIndex++,
            block_number: inputIndex,
            block_timestamp: t,
            prev_randao: "0x" + "0".repeat(64),
        },
        payload,
    );
}

export function adv(app: App, sender: string, t: number, action: Action): Result {
    return advRaw(app, sender, t, encodeAction(action));
}

export const notices = (r: Result): Notice[] => r.notices.map(decodeNotice);

/** A declined input: finishes "accept" (so the node keeps the report), applies nothing, one Rejected report. */
export function rejection(r: Result): RejectedReport {
    const report = r.reports.length === 1 ? decodeRejected(r.reports[0]) : null;
    expect(r.status).toBe(report?.code === "ENGINE_ERROR" ? "reject" : "accept");
    expect(r.applied).toBe(false);
    expect(r.notices).toEqual([]);
    expect(r.reports).toHaveLength(1);
    return decodeRejected(r.reports[0]);
}

export function code(r: Result): string {
    return rejection(r).code;
}

export function accepted(r: Result): Notice[] {
    if (!r.applied) throw new Error(`expected applied, got ${JSON.stringify(decodeRejected(r.reports[0]))}`);
    expect(r.status).toBe("accept");
    expect(r.reports).toEqual([]);
    return notices(r);
}

export function query<R extends InspectRoute>(app: App, q: InspectQuery): InspectResponse<R> {
    return decodeInspectResponse<R>(app.inspect(utf8ToHex(encodeInspectQuery(q))));
}

export function data<R extends InspectRoute>(app: App, q: InspectQuery & { route: R }) {
    const res = query<R>(app, q);
    if (!res.ok) throw new Error(res.message);
    return res.data;
}

/** Owner schedules a session [START, END) with gridSize 2, T=10, at time START-100. */
export function schedule(app: App, overrides: Partial<{ t: number; gridSize: number; turnTimeout: number; sessionStart: number; sessionEnd: number }> = {}): Result {
    return adv(app, OWNER, overrides.t ?? START - 100, {
        type: "scheduleSession",
        sessionStart: overrides.sessionStart ?? START,
        sessionEnd: overrides.sessionEnd ?? END,
        gridSize: overrides.gridSize ?? 2,
        turnTimeout: overrides.turnTimeout ?? T,
    });
}

/** Scheduled session + A then B joined at START → match "1", A moves first. */
export function paired(): App {
    const app = newApp();
    accepted(schedule(app));
    accepted(adv(app, A, START, { type: "joinQueue" }));
    accepted(adv(app, B, START, { type: "joinQueue" }));
    return app;
}

/** Snapshot of every inspect view, for "rejected input does not mutate" checks. */
export function snapshot(app: App): string[] {
    const qs: InspectQuery[] = [
        { route: "session" },
        { route: "queue" },
        { route: "state", matchId: "1" },
        { route: "history", matchId: "1" },
        { route: "state", player: A },
        { route: "state", player: C },
    ];
    return qs.map((q) => app.inspect(utf8ToHex(encodeInspectQuery(q))));
}
