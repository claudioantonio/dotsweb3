/**
 * Decodes an advance payload and dispatches to the handler. Never lets an
 * exception escape (§2 determinism rule 8).
 *
 * Declined inputs (architecture §1.4) emit exactly one Rejected report and no
 * notices, change no state, and finish with status "accept" — the node does not
 * persist reports of REJECTED inputs, so "reject" would hide the reason.
 * Safe because every Reject/ProtocolError is thrown before any mutation
 * (validate-then-mutate). ENGINE_ERROR (unexpected throw, or an engine error
 * the adapter cannot classify) is the exception: we cannot prove nothing was
 * mutated, so it finishes "reject" and the node rolls the machine back.
 */
import { decodeAction, encodeNotice, encodeRejected, ProtocolError } from "@dotsweb3/protocol";
import type { Action, Address, Hex, Notice, ReasonCode, RejectedReport } from "@dotsweb3/protocol";
import { claimForfeit, move } from "./match";
import { joinQueue, leaveQueue } from "./queue";
import { Reject } from "./reject";
import { scheduleSession } from "./session";
import type { Ctx, State } from "./state";

export interface Result {
    status: "accept" | "reject";
    notices: Hex[];
    reports: Hex[];
    /** True only when the action was applied (state may have changed). False for every declined input. */
    applied: boolean;
}

function dispatch(state: State, ctx: Ctx, action: Action, owner: Address): Notice[] {
    switch (action.type) {
        case "joinQueue":
            return joinQueue(state, ctx, action);
        case "leaveQueue":
            return leaveQueue(state, ctx, action);
        case "move":
            return move(state, ctx, action);
        case "claimForfeit":
            return claimForfeit(state, ctx, action);
        case "scheduleSession":
            return scheduleSession(state, ctx, action, owner);
    }
}

function rejected(action: Action | null, code: ReasonCode, message: string): Result {
    const report: RejectedReport =
        action !== null && (action.type === "move" || action.type === "claimForfeit")
            ? { type: "Rejected", action: action.type, matchId: action.matchId, code, message: message.slice(0, 256) }
            : { type: "Rejected", action: action === null ? null : action.type, code, message: message.slice(0, 256) };
    return {
        status: code === "ENGINE_ERROR" ? "reject" : "accept",
        notices: [],
        reports: [encodeRejected(report)],
        applied: false,
    };
}

export function route(state: State, ctx: Ctx, payload: string, owner: Address): Result {
    let action: Action;
    try {
        action = decodeAction(payload);
    } catch (err) {
        if (err instanceof ProtocolError) {
            return rejected(null, err.code === "UNKNOWN_ACTION" ? "UNKNOWN_ACTION" : "MALFORMED_PAYLOAD", err.message);
        }
        return rejected(null, "MALFORMED_PAYLOAD", String(err));
    }
    try {
        const notices = dispatch(state, ctx, action, owner);
        return { status: "accept", notices: notices.map(encodeNotice), reports: [], applied: true };
    } catch (err) {
        if (err instanceof Reject) return rejected(action, err.code, err.message);
        return rejected(action, "ENGINE_ERROR", err instanceof Error ? err.message : String(err));
    }
}
