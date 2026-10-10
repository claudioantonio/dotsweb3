import type { Address, ClaimForfeit, MatchEndedNotice, Move, MoveNotice, MoveRecordWire, Notice } from "@dotsweb3/protocol";
import {
    applyMove,
    boardHash,
    checkClaim,
    ENGINE_VERSION,
    forfeitDeadline,
    longestChainOf,
    scoresOf,
    turnOf,
    winnerOf,
} from "./engine-adapter";
import { Reject } from "./reject";
import type { Ctx, Match, State } from "./state";

/** Looks up a live match the sender plays in; throws the F3/F4 envelope rejections. */
function liveMatchFor(state: State, matchId: string, sender: Address): Match {
    const match = state.matches.get(matchId);
    if (!match) throw new Reject("NO_SUCH_MATCH", `no match ${matchId}`);
    if (match.ended) throw new Reject("MATCH_ENDED", `match ${matchId} has already ended`);
    if (match.players[0] !== sender && match.players[1] !== sender) {
        throw new Reject("NOT_A_PLAYER", `sender is not a player in match ${matchId}`);
    }
    return match;
}

function otherPlayer(match: Match, player: Address): Address {
    return match.players[0] === player ? match.players[1] : match.players[0];
}

export interface EndInfo {
    winner: Address | null;
    loser: Address | null;
    forfeit: boolean;
    zeroMoveForfeit: boolean;
    abandoned: boolean;
    closingMove: MoveRecordWire | null;
}

/** MatchEnded builder (F5). Pure: does not mutate `match`. Fixed key order. */
export function buildMatchEnded(match: Match, info: EndInfo, now: number): MatchEndedNotice {
    return {
        type: "MatchEnded",
        matchId: match.id,
        sessionId: match.sessionId,
        players: [match.players[0], match.players[1]],
        winner: info.winner,
        loser: info.loser,
        squares: scoresOf(match.game),
        forfeit: info.forfeit,
        zeroMoveForfeit: info.zeroMoveForfeit,
        abandoned: info.abandoned,
        durationSeconds: now - match.startedAt,
        longestChain: longestChainOf(match.game),
        closingMove: info.closingMove,
        finalBoardHash: boardHash(match.game),
        engineVersion: ENGINE_VERSION,
        timestamp: now,
    };
}

/** Commits a match end. Call only after every check has passed. */
export function endMatch(state: State, match: Match, ended: MatchEndedNotice): void {
    match.ended = ended;
    state.liveByPlayer.delete(match.players[0]);
    state.liveByPlayer.delete(match.players[1]);
}

/** F3/F6. Moves after the deadline are still accepted until someone claims. */
export function move(state: State, ctx: Ctx, action: Move): Notice[] {
    const match = liveMatchFor(state, action.matchId, ctx.sender);
    const moveIndex = match.moves.length;
    // Engine call last: on throw it has not mutated anything.
    const outcome = applyMove(match.game, action.edge, ctx.sender);

    const record: MoveRecordWire = {
        matchId: match.id,
        moveIndex,
        edge: [
            [action.edge[0][0], action.edge[0][1]],
            [action.edge[1][0], action.edge[1][1]],
        ],
        submitter: ctx.sender,
        squaresClosed: outcome.squaresClosed,
        turnAfter: outcome.turnAfter,
        timestamp: ctx.now,
    };
    match.moves.push(record);
    match.lastMoveAt = ctx.now;

    const moveNotice: MoveNotice = {
        type: "Move",
        matchId: record.matchId,
        moveIndex: record.moveIndex,
        edge: record.edge,
        submitter: record.submitter,
        squaresClosed: record.squaresClosed,
        turnAfter: record.turnAfter,
        timestamp: record.timestamp,
        forfeitDeadline: outcome.over ? null : forfeitDeadline(match),
    };
    if (!outcome.over) return [moveNotice];

    // gridSize is validated even ⇒ odd square count ⇒ the engine always has a winner.
    const winner = winnerOf(match.game);
    const ended = buildMatchEnded(
        match,
        {
            winner,
            loser: winner === null ? null : otherPlayer(match, winner),
            forfeit: false,
            zeroMoveForfeit: false,
            abandoned: false,
            closingMove: record,
        },
        ctx.now,
    );
    endMatch(state, match, ended);
    return [moveNotice, ended];
}

/** F4. Valid iff sender is the waiting player and now > resolved deadline (strict). */
export function claimForfeit(state: State, ctx: Ctx, action: ClaimForfeit): Notice[] {
    const match = liveMatchFor(state, action.matchId, ctx.sender);
    checkClaim(match, ctx.sender, ctx.now);
    const loser = turnOf(match.game);
    let loserMoved = false;
    for (const m of match.moves) {
        if (m.submitter === loser) {
            loserMoved = true;
            break;
        }
    }
    const ended = buildMatchEnded(
        match,
        {
            winner: ctx.sender,
            loser,
            forfeit: true,
            zeroMoveForfeit: !loserMoved,
            abandoned: false,
            closingMove: null,
        },
        ctx.now,
    );
    endMatch(state, match, ended);
    return [ended];
}
