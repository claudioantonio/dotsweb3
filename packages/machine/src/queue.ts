import type { JoinQueue, LeaveQueue, MatchStartedNotice, Notice } from "@dotsweb3/protocol";
import { forfeitDeadline, newGame } from "./engine-adapter";
import { Reject } from "./reject";
import type { Ctx, Match, QueueEntry, State } from "./state";

/** F1. Joins the FIFO queue; the join that makes the queue hold two pairs them. */
export function joinQueue(state: State, ctx: Ctx, action: JoinQueue): Notice[] {
    void action;
    const session = state.session;
    if (session === null || ctx.now < session.sessionStart) {
        throw new Reject("NO_OPEN_SESSION", "no session is open");
    }
    if (ctx.now >= session.cutoffAt) {
        throw new Reject("PAST_CUTOFF", `no new matches at or after ${session.cutoffAt}`);
    }
    for (const e of state.queue) {
        if (e.address === ctx.sender) throw new Reject("ALREADY_QUEUED", "sender is already queued");
    }
    if (state.liveByPlayer.has(ctx.sender)) {
        throw new Reject("IN_LIVE_MATCH", `sender is in live match ${state.liveByPlayer.get(ctx.sender)}`);
    }

    const queue: QueueEntry[] = [...state.queue, { address: ctx.sender, joinedAt: ctx.now }];
    if (queue.length < 2) {
        state.queue = queue;
        return [];
    }

    // Pair the two oldest entries; first joiner moves first.
    const matchId = String(state.nextMatchId);
    const players: [string, string] = [queue[0].address, queue[1].address];
    const match: Match = {
        id: matchId,
        sessionId: session.sessionId,
        players,
        gridSize: session.gridSize,
        turnTimeout: session.turnTimeout,
        startedAt: ctx.now,
        lastMoveAt: null,
        game: newGame(session.gridSize, players, matchId), // may throw: nothing mutated yet
        moves: [],
        ended: null,
    };
    const notice: MatchStartedNotice = {
        type: "MatchStarted",
        matchId,
        sessionId: match.sessionId,
        players: [players[0], players[1]],
        firstMover: players[0],
        gridSize: match.gridSize,
        turnTimeout: match.turnTimeout,
        forfeitDeadline: forfeitDeadline(match),
        timestamp: ctx.now,
    };

    state.queue = queue.slice(2);
    state.nextMatchId += 1;
    state.matches.set(matchId, match);
    state.liveByPlayer.set(players[0], matchId);
    state.liveByPlayer.set(players[1], matchId);
    return [notice];
}

/** F1. Removes the sender from the queue. No notice. */
export function leaveQueue(state: State, ctx: Ctx, action: LeaveQueue): Notice[] {
    void action;
    const next = state.queue.filter((e) => e.address !== ctx.sender);
    if (next.length === state.queue.length) throw new Reject("NOT_QUEUED", "sender is not queued");
    state.queue = next;
    return [];
}
