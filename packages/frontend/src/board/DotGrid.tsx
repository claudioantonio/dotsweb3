import type { Dots, Coord } from "dots-engine";

const CELL = 64;
const PAD = 32;
const DOT_RADIUS = 7;
const SELECTED_RADIUS = 10;

const PLAYER_COLORS: Record<string, string> = {
  "player-a": "#2C7A7B",
  "player-b": "#C05621",
};

function isSameDot(a: Coord | null, b: Coord): boolean {
  return a !== null && a[0] === b[0] && a[1] === b[1];
}

interface DotGridProps {
  match: Dots;
  selected: Coord | null;
  onDotClick: (dot: Coord) => void;
}

export function DotGrid({ match, selected, onDotClick }: DotGridProps) {
  const size = match.grid.size;
  const svgSize = PAD * 2 + (size - 1) * CELL;

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
    for (let y = 0; y < size; y++) {
      dots.push([x, y]);
    }
  }

  return (
    <svg width={svgSize} height={svgSize} role="img" aria-label="Dots board">
      <rect x={0} y={0} width={svgSize} height={svgSize} fill="#F7FAFC" />

      {match.grid.getSquares().map((square) => {
        if (!square.hasOwner()) return null;
        const [row, col] = match.grid.getSquarePosition(square.id);
        return (
          <rect
            key={square.id}
            x={PAD + col * CELL}
            y={PAD + row * CELL}
            width={CELL}
            height={CELL}
            fill={PLAYER_COLORS[square.owner] ?? "#A0AEC0"}
            opacity={0.35}
          />
        );
      })}

      {match.moveLog.map((move) => {
        const [[x1, y1], [x2, y2]] = move.edge;
        return (
          <line
            key={move.moveIndex}
            x1={PAD + x1 * CELL}
            y1={PAD + y1 * CELL}
            x2={PAD + x2 * CELL}
            y2={PAD + y2 * CELL}
            stroke={PLAYER_COLORS[move.submitter] ?? "#2D3748"}
            strokeWidth={4}
            strokeLinecap="round"
          />
        );
      })}

      {dots.map((dot) => {
        const isSelected = isSameDot(selected, dot);
        const isNeighbor = neighbors.some(([x, y]) => x === dot[0] && y === dot[1]);
        return (
          <circle
            key={`${dot[0]},${dot[1]}`}
            cx={PAD + dot[0] * CELL}
            cy={PAD + dot[1] * CELL}
            r={isSelected ? SELECTED_RADIUS : DOT_RADIUS}
            fill={isSelected ? "#3182CE" : isNeighbor ? "#90CDF4" : "#2D3748"}
            style={{ cursor: "pointer" }}
            onClick={() => onDotClick(dot)}
          />
        );
      })}
    </svg>
  );
}
