import type { Coord } from "@dotsweb3/protocol";
import type { BoardView } from "../engine-adapter";
import { SEAT_COLORS } from "../theme";

const CELL = 64;
const PAD = 32;
const DOT_RADIUS = 7;
const SELECTED_RADIUS = 10;

function isSameDot(a: Coord | null | undefined, b: Coord): boolean {
  return !!a && a[0] === b[0] && a[1] === b[1];
}

export interface DotGridProps {
  board: BoardView;
  /** Seat order: players[0] is teal, players[1] orange. */
  players: readonly [string, string];
  selected?: Coord | null;
  /** Omit for a read-only board (spectate, replay, result thumbnail). */
  onDotClick?: (dot: Coord) => void;
  /** Optimistic edge, drawn dashed with a "pending" badge (F12). */
  pending?: [Coord, Coord] | null;
  /** Edge to pulse briefly (last confirmed move). */
  highlightMoveIndex?: number | null;
  /** Scale factor for thumbnails. */
  scale?: number;
}

export function DotGrid({ board, players, selected, onDotClick, pending, highlightMoveIndex, scale = 1 }: DotGridProps) {
  const size = board.size;
  const svgSize = PAD * 2 + (size - 1) * CELL;
  const interactive = !!onDotClick;
  const colorOf = (who: string) => {
    const seat = players.findIndex((p) => p.toLowerCase() === who.toLowerCase());
    return seat >= 0 ? SEAT_COLORS[seat] : "#A0AEC0";
  };
  const at = (v: number) => PAD + v * CELL;

  const neighbors: Coord[] = selected
    ? (
        [
          [selected[0] + 1, selected[1]],
          [selected[0] - 1, selected[1]],
          [selected[0], selected[1] + 1],
          [selected[0], selected[1] - 1],
        ] as Coord[]
      ).filter(([x, y]) => x >= 0 && x < size && y >= 0 && y < size)
    : [];

  const dots: Coord[] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) dots.push([x, y]);
  }

  return (
    <svg
      width={svgSize * scale}
      height={svgSize * scale}
      viewBox={`0 0 ${svgSize} ${svgSize}`}
      role="img"
      aria-label="Dots board"
    >
      <style>{`@keyframes dots-pulse { from { opacity: .35 } to { opacity: 1 } } .dots-pulse { animation: dots-pulse .5s ease-in-out 3 alternate }`}</style>
      <rect x={0} y={0} width={svgSize} height={svgSize} fill="#1a1b1e" rx={8} />

      {board.squares.map((sq) => (
        <rect
          key={`${sq.row},${sq.col}`}
          x={at(sq.col)}
          y={at(sq.row)}
          width={CELL}
          height={CELL}
          fill={colorOf(sq.owner)}
          opacity={0.35}
        />
      ))}

      {board.edges.map((e) => {
        const [[x1, y1], [x2, y2]] = e.edge;
        return (
          <line
            key={e.moveIndex}
            className={e.moveIndex === highlightMoveIndex ? "dots-pulse" : undefined}
            x1={at(x1)}
            y1={at(y1)}
            x2={at(x2)}
            y2={at(y2)}
            stroke={colorOf(e.owner)}
            strokeWidth={4}
            strokeLinecap="round"
          />
        );
      })}

      {pending && (
        <g data-testid="pending-edge">
          <line
            x1={at(pending[0][0])}
            y1={at(pending[0][1])}
            x2={at(pending[1][0])}
            y2={at(pending[1][1])}
            stroke="#fab005"
            strokeWidth={4}
            strokeDasharray="6 6"
            strokeLinecap="round"
          />
          <text
            x={(at(pending[0][0]) + at(pending[1][0])) / 2}
            y={(at(pending[0][1]) + at(pending[1][1])) / 2 - 10}
            textAnchor="middle"
            fontSize={11}
            fill="#fab005"
          >
            pending
          </text>
        </g>
      )}

      {dots.map((dot) => {
        const isSelected = isSameDot(selected, dot);
        const isNeighbor = neighbors.some(([x, y]) => x === dot[0] && y === dot[1]);
        return (
          <circle
            key={`${dot[0]},${dot[1]}`}
            cx={at(dot[0])}
            cy={at(dot[1])}
            r={isSelected ? SELECTED_RADIUS : DOT_RADIUS}
            fill={isSelected ? "#15aabf" : isNeighbor ? "#66d9e8" : "#c1c2c5"}
            style={interactive ? { cursor: "pointer" } : undefined}
            onClick={interactive ? () => onDotClick(dot) : undefined}
          />
        );
      })}
    </svg>
  );
}
