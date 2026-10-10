import type { ReasonCode } from "@dotsweb3/protocol";

/**
 * Thrown by handlers (and the engine adapter) to reject an advance input.
 * The router turns it into `/finish {status:"accept"}` + exactly one Rejected
 * report, no notices, no state change (ENGINE_ERROR excepted: that finishes
 * "reject" so the node rolls back — architecture §1.4). Handlers validate
 * before mutating, so a Reject never leaves partial state.
 */
export class Reject extends Error {
    constructor(
        public readonly code: ReasonCode,
        message: string,
    ) {
        super(message);
        this.name = "Reject";
    }
}
