/**
 * F9 read-only views. Takes Readonly<State> and never writes (§2 rule 7).
 * Always answers with exactly one InspectResponse.
 */
import { decodeInspectQuery, encodeInspectResponse, ProtocolError } from "@dotsweb3/protocol";
import type {
    Hex,
    HistoryView,
    InspectQuery,
    InspectResponse,
    MatchSummary,
    MatchView,
    MoveRecordWire,
    QueueView,
    SessionView,
} from "@dotsweb3/protocol";
import { ENGINE_VERSION, forfeitDeadline, longestChainOf, scoresOf, turnOf } from "./engine-adapter";
import type { Match, State } from "./state";

function copyMoves(moves: readonly MoveRecordWire[]): MoveRecordWire[] {
    return moves.map((m) => ({
        matchId: m.matchId,
        moveIndex: m.moveIndex,
        edge: [
            [m.edge[0][0], m.edge[0][1]],
            [m.edge[1][0], m.edge[1][1]],
        ],
        submitter: m.submitter,
        squaresClosed: m.squaresClosed,
        turnAfter: m.turnAfter,
        timestamp: m.timestamp,
    }));
}

function matchView(m: Match): MatchView {
    return {
        matchId: m.id,
        sessionId: m.sessionId,
        gridSize: m.gridSize,
        turnTimeout: m.turnTimeout,
        players: [m.players[0], m.players[1]],
        status: m.ended ? "ended" : "live",
        turn: turnOf(m.game),
        scores: scoresOf(m.game),
        longestChain: longestChainOf(m.game),
        startedAt: m.startedAt,
        forfeitDeadline: m.ended ? null : forfeitDeadline(m),
        moves: copyMoves(m.moves),
        ended: m.ended,
    };
}

function summary(m: Match): MatchSummary {
    return {
        matchId: m.id,
        players: [m.players[0], m.players[1]],
        scores: scoresOf(m.game),
        moveCount: m.moves.length,
        turn: turnOf(m.game),
        forfeitDeadline: forfeitDeadline(m),
        startedAt: m.startedAt,
    };
}

function answer(state: Readonly<State>, q: InspectQuery): InspectResponse {
    switch (q.route) {
        case "state": {
            const id = "matchId" in q ? q.matchId : state.liveByPlayer.get(q.player);
            const m = id === undefined ? undefined : state.matches.get(id);
            return { ok: true, route: "state", data: m ? matchView(m) : null };
        }
        case "queue": {
            const data: QueueView = { entries: state.queue.map((e) => ({ address: e.address, joinedAt: e.joinedAt })) };
            return { ok: true, route: "queue", data };
        }
        case "session": {
            const liveMatches: MatchSummary[] = [];
            // Map insertion order = ascending matchId.
            for (const m of state.matches.values()) if (!m.ended) liveMatches.push(summary(m));
            const data: SessionView = {
                session: state.session ? { ...state.session } : null,
                liveMatches,
                queueLength: state.queue.length,
                machineTime: state.machineTime,
                engineVersion: ENGINE_VERSION,
            };
            return { ok: true, route: "session", data };
        }
        case "history": {
            const m = state.matches.get(q.matchId);
            const data: HistoryView | null = m
                ? { matchId: m.id, gridSize: m.gridSize, players: [m.players[0], m.players[1]], moves: copyMoves(m.moves), ended: m.ended }
                : null;
            return { ok: true, route: "history", data };
        }
    }
}

export function inspect(state: Readonly<State>, payload: string): Hex {
    let query: InspectQuery;
    try {
        query = decodeInspectQuery(payload);
    } catch (err) {
        const code = err instanceof ProtocolError && err.code === "UNKNOWN_ROUTE" ? "UNKNOWN_ROUTE" : "MALFORMED_PAYLOAD";
        return encodeInspectResponse({ ok: false, code, message: err instanceof Error ? err.message : String(err) });
    }
    try {
        return encodeInspectResponse(answer(state, query));
    } catch (err) {
        // Should be unreachable; never crash the loop.
        return encodeInspectResponse({ ok: false, code: "MALFORMED_PAYLOAD", message: err instanceof Error ? err.message : String(err) });
    }
}
