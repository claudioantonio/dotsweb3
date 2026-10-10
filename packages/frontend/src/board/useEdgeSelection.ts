import type { Coord } from "@dotsweb3/protocol";
import { useCallback, useState } from "react";

/**
 * Two-click edge picking (UI only — legality is the engine's/machine's call).
 * First click selects a dot, second click on another dot emits the edge.
 */
export function useEdgeSelection(onEdge: (edge: [Coord, Coord]) => void, enabled = true) {
  const [selected, setSelected] = useState<Coord | null>(null);
  const onDotClick = useCallback(
    (dot: Coord) => {
      if (!enabled) return;
      if (!selected) return setSelected(dot);
      setSelected(null);
      if (selected[0] === dot[0] && selected[1] === dot[1]) return;
      onEdge([selected, dot]);
    },
    [enabled, onEdge, selected],
  );
  return { selected: enabled ? selected : null, onDotClick, clear: () => setSelected(null) };
}
