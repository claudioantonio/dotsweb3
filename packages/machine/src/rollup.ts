/**
 * Tiny client for the Cartesi Rollup HTTP API (Rollups 2.0, openapi-interfaces
 * rollup.yaml): POST /finish, /notice, /report. No logic, no retries.
 */
import type { Hex } from "@dotsweb3/protocol";

export interface AdvanceMetadata {
    chain_id: number;
    app_contract: string;
    msg_sender: string;
    input_index: number;
    block_number: number;
    /** Raw block timestamp. Read ONLY through timeOf() in app.ts. */
    block_timestamp: number;
    prev_randao: string;
}

export type RollupRequest =
    | { request_type: "advance_state"; data: { metadata: AdvanceMetadata; payload: Hex } }
    | { request_type: "inspect_state"; data: { payload: Hex } };

export interface Rollup {
    /** Returns the next request, or null when the server answered 202 (nothing pending). */
    finish(status: "accept" | "reject"): Promise<RollupRequest | null>;
    notice(payload: Hex): Promise<void>;
    report(payload: Hex): Promise<void>;
}

export function createRollup(baseUrl: string): Rollup {
    async function post(path: string, body: unknown): Promise<Response> {
        const res = await fetch(`${baseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (res.status >= 400) throw new Error(`rollup ${path} failed: ${res.status} ${await res.text()}`);
        return res;
    }
    return {
        async finish(status) {
            const res = await post("/finish", { status });
            if (res.status === 202) return null;
            return (await res.json()) as RollupRequest;
        },
        async notice(payload) {
            await post("/notice", { payload });
        },
        async report(payload) {
            await post("/report", { payload });
        },
    };
}
