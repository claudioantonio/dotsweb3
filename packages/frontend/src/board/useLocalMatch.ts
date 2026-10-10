import type { Coord } from "@dotsweb3/protocol";
import { useCallback, useState } from "react";
import { LocalMatch, type BoardView } from "../engine-adapter";
import { useEdgeSelection } from "./useEdgeSelection";

export const LOCAL_PLAYERS: [string, string] = ["player-a", "player-b"];
export const GRID_SIZE = 3;

/** Hot-seat practice board (no chain): the original prototype, now through the adapter. */
export function useLocalMatch() {
  const [match, setMatch] = useState(() => new LocalMatch(GRID_SIZE, LOCAL_PLAYERS));
  const [board, setBoard] = useState<BoardView>(() => match.view());
  const [error, setError] = useState<string | null>(null);

  const play = useCallback(
    ([from, to]: [Coord, Coord]) => {
      try {
        match.play(from, to);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid move");
      }
      setBoard(match.view());
    },
    [match],
  );
  const selection = useEdgeSelection(play, !board.over);

  const reset = useCallback(() => {
    const m = new LocalMatch(GRID_SIZE, LOCAL_PLAYERS);
    setMatch(m);
    setBoard(m.view());
    setError(null);
    selection.clear();
  }, [selection]);

  return { match, board, error, selected: selection.selected, onDotClick: selection.onDotClick, reset };
}
