/**
 * createApp(cfg) → { advance, inspect }. Pure with respect to I/O: returns
 * outputs instead of POSTing them, so handlers are testable without a rollup
 * server (docs/architecture.md §2).
 */
import type { Address, Hex } from "@dotsweb3/protocol";
import { inspect as inspectState } from "./inspect";
import type { AdvanceMetadata } from "./rollup";
import { route, type Result } from "./router";
import { initialState, type Ctx, type State } from "./state";

export type { Result } from "./router";

export interface AppConfig {
    /** Owner address (lowercased by the caller). */
    owner: Address;
}

export interface App {
    advance(meta: AdvanceMetadata, payload: string): Result;
    inspect(payload: string): Hex;
}

/** Above this, a raw block_timestamp is taken to be milliseconds. (1e12 s ≈ year 33658; 1e12 ms ≈ 2001.) */
const MS_THRESHOLD = 1e12;

/**
 * The ONLY reader of metadata.block_timestamp. Returns integer unix seconds.
 * Rollups v2 forwards the EVM block.timestamp (seconds); older docs/READMEs
 * claimed ms. The threshold makes both safe and is deterministic.
 */
export function timeOf(meta: Pick<AdvanceMetadata, "block_timestamp">): number {
    const raw = Number(meta.block_timestamp);
    return Math.floor(raw >= MS_THRESHOLD ? raw / 1000 : raw);
}

export function createApp(cfg: AppConfig, state: State = initialState()): App {
    const owner = cfg.owner.toLowerCase();
    return {
        advance(meta, payload) {
            const ctx: Ctx = {
                sender: String(meta.msg_sender).toLowerCase(),
                now: timeOf(meta),
                inputIndex: meta.input_index,
            };
            const result = route(state, ctx, payload, owner);
            // Declined inputs finish "accept" too, but must not move machineTime.
            if (result.applied) state.machineTime = ctx.now;
            return result;
        },
        inspect(payload) {
            return inspectState(state, payload);
        },
    };
}
