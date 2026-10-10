/**
 * The ONLY module in packages/frontend that imports dots-engine
 * (docs/architecture.md §4). Everything else works with the plain
 * `BoardView` / `ReplayStep` shapes below, so an engine bump only touches
 * this file. Stubs for features the engine does not ship yet are marked
 * `// TODO-engine:`.
 *
 * No rules live here: every legality/scoring/turn decision is the engine's
 * `play()`. This file only feeds it records and reads its state back.
 */
import { Dots } from "dots-engine";
import type { Address, Coord, Hex, MatchId, MoveRecordWire } from "@dotsweb3/protocol";

// TODO-engine: replace with the engine's own ENGINE_VERSION export once it ships.
// A test asserts this equals node_modules/dots-engine/package.json#version.
export const ENGINE_VERSION = "0.1.0-alpha.0";

export interface BoardEdge {
  edge: [Coord, Coord];
  owner: Address;
  moveIndex: number;
}

export interface BoardSquare {
  row: number;
  col: number;
  owner: Address;
}

/** Plain, render-ready snapshot of an engine board. */
export interface BoardView {
  /** Dots per side (protocol `gridSize`). */
  size: number;
  edges: BoardEdge[];
  /** Owned squares only. */
  squares: BoardSquare[];
  scores: Record<Address, number>;
  longestChain: Record<Address, number>;
  turn: Address;
  over: boolean;
}

export interface Divergence {
  /** 0-based index of the first record the engine disagreed with. */
  moveIndex: number;
  reason: string;
}

function view(game: Dots): BoardView {
  const edges: BoardEdge[] = game.moveLog.map((m) => ({
    edge: [
      [m.edge[0][0], m.edge[0][1]],
      [m.edge[1][0], m.edge[1][1]],
    ],
    owner: m.submitter,
    moveIndex: m.moveIndex,
  }));
  const squares: BoardSquare[] = [];
  for (const sq of game.grid.getSquares()) {
    if (!sq.hasOwner()) continue;
    const [row, col] = game.grid.getSquarePosition(sq.id);
    squares.push({ row, col, owner: sq.owner });
  }
  return {
    size: game.grid.size,
    edges,
    squares,
    scores: { ...game.getScore() },
    longestChain: { ...game.getLongestChain() },
    turn: game.turn,
    over: game.isOVer(),
  };
}

/**
 * Feeds machine move records to a fresh engine one at a time and checks
 * that the engine agrees with each record (squaresClosed, turnAfter,
 * submitter). This is the frontend's replay (F13) and board rebuild.
 *
 * TODO-engine: switch to the engine's `replay(log)` once it ships; the
 * public surface of this class stays the same.
 */
export class Replayer {
  private readonly game: Dots;
  private divergence: Divergence | null = null;

  constructor(gridSize: number, players: [Address, Address], matchId: MatchId) {
    this.game = new Dots(gridSize, [players[0], players[1]], matchId);
  }

  get applied(): number {
    return this.game.moveLog.length;
  }

  get diverged(): Divergence | null {
    return this.divergence;
  }

  /** Apply one record. Returns the divergence (sticky) if the engine disagrees. */
  apply(record: MoveRecordWire): Divergence | null {
    if (this.divergence) return this.divergence;
    const k = record.moveIndex;
    if (k !== this.applied) {
      this.divergence = { moveIndex: this.applied, reason: `expected move #${this.applied}, got #${k}` };
      return this.divergence;
    }
    try {
      const result = this.game.play(record.edge[0], record.edge[1], record.submitter);
      const turnAfter = this.game.turn;
      if (result.squaresClosed !== record.squaresClosed) {
        this.divergence = {
          moveIndex: k,
          reason: `engine closed ${result.squaresClosed} square(s), record says ${record.squaresClosed}`,
        };
      } else if (turnAfter !== record.turnAfter.toLowerCase()) {
        this.divergence = { moveIndex: k, reason: `engine gives the turn to ${turnAfter}, record says ${record.turnAfter}` };
      }
    } catch (err) {
      this.divergence = { moveIndex: k, reason: err instanceof Error ? err.message : String(err) };
    }
    return this.divergence;
  }

  view(): BoardView {
    return view(this.game);
  }
}

export interface Rebuilt {
  board: BoardView;
  divergence: Divergence | null;
}

/** Rebuild a board from a full move log (F9 `state`/`history` → engine). */
export function rebuild(
  gridSize: number,
  players: [Address, Address],
  matchId: MatchId,
  moves: readonly MoveRecordWire[],
): Rebuilt {
  const r = new Replayer(gridSize, players, matchId);
  for (const m of moves) {
    if (r.apply(m)) break;
  }
  return { board: r.view(), divergence: r.diverged };
}

// TODO-engine: the engine has no canonical board encoding / hash yet, so the
// replay cannot recompute `finalBoardHash`. Never invent one here.
export function boardHash(_board: BoardView): Hex | null {
  return null;
}

/**
 * Local hot-seat board (no chain), kept from the original prototype as a
 * "practice" mode. Wraps the engine so the UI never touches it directly.
 */
export class LocalMatch {
  private readonly game: Dots;
  constructor(gridSize: number, players: [string, string]) {
    this.game = new Dots(gridSize, players, "local");
  }
  /** Throws the engine's error (message shown to the user) if illegal. */
  play(from: Coord, to: Coord): void {
    this.game.play(from, to, this.game.turn);
  }
  view(): BoardView {
    return view(this.game);
  }
  isDraw(): boolean {
    return this.game.isDraw();
  }
  winner(): string | null {
    return this.game.getWinner();
  }
}
