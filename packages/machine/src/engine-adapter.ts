/**
 * The ONLY file in packages/machine that imports dots-engine
 * (docs/architecture.md §4). Everything here is a thin seam over the engine;
 * every stub for a feature the engine has not shipped yet is marked
 * `TODO-engine:` and should shrink to a re-export once it lands.
 *
 * No rules live here: turn order, bounds, adjacency, scoring, extra move on
 * close and game-over are all decided by `Dots.play()`.
 */
import { Dots } from "dots-engine";
import type { Address, Coord, Hex, MatchId, ReasonCode } from "@dotsweb3/protocol";
import { Reject } from "./reject";

/** Opaque handle to one engine game. Never serialized (§2 determinism rule 6). */
export type EngineMatch = Dots;

// TODO-engine: replace with the engine's own ENGINE_VERSION export once it
// ships. A test asserts this equals node_modules/dots-engine/package.json.
export const ENGINE_VERSION = "0.1.0-alpha.0";

export function newGame(gridSize: number, players: readonly [Address, Address], matchId: MatchId): EngineMatch {
    return new Dots(gridSize, [players[0], players[1]], matchId);
}

export interface MoveOutcome {
    squaresClosed: number;
    turnAfter: Address;
    /** True when this move filled the board. */
    over: boolean;
}

/**
 * Apply one move. On failure throws a `Reject` with a classified code; the
 * engine validates fully before mutating, so a throw leaves `game` untouched.
 */
export function applyMove(game: EngineMatch, edge: readonly [Coord, Coord], submitter: Address): MoveOutcome {
    const from: Coord = [edge[0][0], edge[0][1]];
    const to: Coord = [edge[1][0], edge[1][1]];
    let squaresClosed: number;
    try {
        squaresClosed = game.play(from, to, submitter).squaresClosed;
    } catch (err) {
        throw new Reject(classify(err), errorMessage(err));
    }
    return { squaresClosed, turnAfter: game.turn, over: game.isOVer() };
}

// TODO-engine: the engine throws plain Error strings. Until it ships typed
// error codes, map message prefixes. test/engine-adapter.test.ts pins every
// mapping so an engine bump that rewords a message fails loudly.
const ERROR_PREFIXES: readonly (readonly [string, ReasonCode])[] = [
    ["Not this player's turn", "NOT_YOUR_TURN"],
    ["Invalid ", "OUT_OF_BOUNDS"],
    ["Dots must be adjacent", "NOT_ADJACENT"],
    ["Edge already drawn", "EDGE_TAKEN"],
    ["Game is over", "MATCH_ENDED"],
];

export function classify(err: unknown): ReasonCode {
    const message = errorMessage(err);
    for (const [prefix, code] of ERROR_PREFIXES) {
        if (message.startsWith(prefix)) return code;
    }
    return "ENGINE_ERROR";
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export function turnOf(game: EngineMatch): Address {
    return game.turn;
}

/** Per-player record built in `players` order (never Object.keys over engine records). */
function perPlayer(game: EngineMatch, source: Record<string, number>): Record<Address, number> {
    const [a, b] = game.players;
    const out: Record<Address, number> = {};
    out[a] = source[a] ?? 0;
    out[b] = source[b] ?? 0;
    return out;
}

export function scoresOf(game: EngineMatch): Record<Address, number> {
    return perPlayer(game, game.getScore());
}

export function longestChainOf(game: EngineMatch): Record<Address, number> {
    return perPlayer(game, game.getLongestChain());
}

/** Winner of a completed board, null on a draw (impossible with even gridSize). */
export function winnerOf(game: EngineMatch): Address | null {
    return game.getWinner();
}

// TODO-engine: finalBoardHash needs the engine's canonical board encoding +
// keccak256. Never invent one here — MatchEnded carries null until it ships.
export function boardHash(game: EngineMatch): Hex | null {
    void game;
    return null;
}

// ---------------------------------------------------------------------------
// Forfeit timing. TODO-engine: candidates for the engine (it is time-free
// today). Callers pass machine time from timeOf(meta) only.
// ---------------------------------------------------------------------------

export interface DeadlineInput {
    startedAt: number;
    lastMoveAt: number | null;
    turnTimeout: number;
}

/** First move gets FIRST_MOVE_GRACE (2·T) from pairing; later moves T from the last move. */
export function forfeitDeadline(m: DeadlineInput): number {
    return m.lastMoveAt === null ? m.startedAt + 2 * m.turnTimeout : m.lastMoveAt + m.turnTimeout;
}

/** Throws Reject unless `sender` (already known to be a player) may claim a forfeit at `now`. */
export function checkClaim(m: DeadlineInput & { game: EngineMatch }, sender: Address, now: number): void {
    if (sender === turnOf(m.game)) {
        throw new Reject("NOT_THE_WAITING_PLAYER", "only the player waiting on their opponent can claim a forfeit");
    }
    const deadline = forfeitDeadline(m);
    if (!(now > deadline)) {
        throw new Reject("DEADLINE_NOT_ELAPSED", `forfeit deadline ${deadline} has not elapsed (now ${now})`);
    }
}
