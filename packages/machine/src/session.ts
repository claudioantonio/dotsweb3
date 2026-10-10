import { DEFAULTS } from "@dotsweb3/protocol";
import type { Address, MatchEndedNotice, Notice, ScheduleSession, SessionConfig } from "@dotsweb3/protocol";
import { buildMatchEnded, endMatch } from "./match";
import { Reject } from "./reject";
import type { Ctx, Match, State } from "./state";

/** Owner footgun guards (review S2): a 1 h turn is already absurd; ≥ 1e12 "seconds" is ms by mistake. */
const MAX_TURN_TIMEOUT = 3600;
const MS_LOOKING = 1e12;

function invalid(message: string): never {
    throw new Reject("INVALID_SESSION", message);
}

/**
 * F2. Owner only. Validates, then sweeps live matches idle > SWEEP_IDLE as
 * abandoned (ascending matchId), clears a stale queue, and replaces the session.
 */
export function scheduleSession(state: State, ctx: Ctx, action: ScheduleSession, owner: Address): Notice[] {
    if (ctx.sender !== owner) throw new Reject("NOT_OWNER", "only the owner can schedule a session");

    const gridSize = action.gridSize ?? DEFAULTS.gridSize;
    const turnTimeout = action.turnTimeout ?? DEFAULTS.turnTimeout;
    const { sessionStart, sessionEnd } = action;
    const cutoffAt = sessionEnd - DEFAULTS.lastMatchCutoff;
    if (sessionStart >= MS_LOOKING || sessionEnd >= MS_LOOKING) invalid("session times look like milliseconds; use unix seconds");
    if (!(sessionStart < sessionEnd)) invalid("sessionStart must be before sessionEnd");
    if (!(sessionEnd > ctx.now)) invalid("sessionEnd must be in the future");
    if (!(cutoffAt >= sessionStart)) invalid(`session must be at least ${DEFAULTS.lastMatchCutoff}s long`);
    // Even dot count ⇒ odd square count ⇒ no draws (MatchEnded has no draw shape).
    if (gridSize < 2 || gridSize > 10 || gridSize % 2 !== 0) invalid("gridSize must be even, in [2, 10]");
    if (turnTimeout < 10 || turnTimeout > MAX_TURN_TIMEOUT) invalid(`turnTimeout must be in [10, ${MAX_TURN_TIMEOUT}] seconds`);

    const session: SessionConfig = {
        sessionId: state.nextSessionId,
        sessionStart,
        sessionEnd,
        cutoffAt,
        gridSize,
        turnTimeout,
        firstMoveGrace: DEFAULTS.firstMoveGraceFactor * turnTimeout,
        sweepIdle: DEFAULTS.sweepIdleFactor * turnTimeout,
    };

    // Sweep (F2 / PRD §6.5): each match by its own snapshotted T. Map order = ascending matchId.
    const swept: [Match, MatchEndedNotice][] = [];
    for (const match of state.matches.values()) {
        if (match.ended) continue;
        const idle = ctx.now - (match.lastMoveAt ?? match.startedAt);
        if (idle > DEFAULTS.sweepIdleFactor * match.turnTimeout) {
            const ended = buildMatchEnded(
                match,
                { winner: null, loser: null, forfeit: false, zeroMoveForfeit: false, abandoned: true, closingMove: null },
                ctx.now,
            );
            swept.push([match, ended]);
        }
    }
    const clearQueue = state.session === null || ctx.now >= state.session.cutoffAt;

    // Commit.
    for (const [match, ended] of swept) endMatch(state, match, ended);
    if (clearQueue) state.queue = [];
    state.session = session;
    state.nextSessionId += 1;
    return swept.map(([, ended]) => ended);
}
