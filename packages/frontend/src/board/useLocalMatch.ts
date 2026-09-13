import { useCallback, useState } from "react";
import { Dots, type Coord } from "dots-engine";

export const LOCAL_PLAYERS: [string, string] = ["player-a", "player-b"];
export const GRID_SIZE = 3;

function createMatch(): Dots {
  return new Dots(GRID_SIZE, LOCAL_PLAYERS, "local");
}

function isSameDot(a: Coord | null, b: Coord): boolean {
  return a !== null && a[0] === b[0] && a[1] === b[1];
}

export function useLocalMatch() {
  const [match, setMatch] = useState(createMatch);
  const [, forceRender] = useState(0);
  const [selected, setSelected] = useState<Coord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDotClick = useCallback(
    (dot: Coord) => {
      if (match.isOVer()) return;

      if (!selected) {
        setSelected(dot);
        setError(null);
        return;
      }

      if (isSameDot(selected, dot)) {
        setSelected(null);
        return;
      }

      try {
        match.play(selected, dot, match.turn);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid move");
      } finally {
        setSelected(null);
        forceRender((n) => n + 1);
      }
    },
    [match, selected],
  );

  const reset = useCallback(() => {
    setMatch(createMatch());
    setSelected(null);
    setError(null);
  }, []);

  return { match, selected, error, onDotClick, reset };
}
