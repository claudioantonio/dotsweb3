import type { HistoryView, Hex } from "@dotsweb3/protocol";
import { ENGINE_VERSION, Replayer, boardHash, type BoardView, type Divergence } from "../engine-adapter";

export interface ReplayFrames {
  /** frames[k] = board after k moves (frames[0] is empty). Stops at a divergence. */
  frames: BoardView[];
  divergence: Divergence | null;
  /** Hash recomputed from the final frame (null until the engine provides one). */
  replayHash: Hex | null;
}

/** F13 replay driver: feed the machine's history through the same engine version. */
export function buildFrames(h: HistoryView): ReplayFrames {
  const r = new Replayer(h.gridSize, h.players, h.matchId);
  const frames: BoardView[] = [r.view()];
  for (const m of h.moves) {
    if (r.apply(m)) break;
    frames.push(r.view());
  }
  return { frames, divergence: r.diverged, replayHash: boardHash(frames[frames.length - 1]) };
}

export type Verdict =
  | { status: "match"; message: string }
  | { status: "mismatch"; message: string }
  | { status: "unavailable"; message: string };

/** Verification card logic (ux-plan S7). */
export function verify(input: {
  divergence: Divergence | null;
  moveCount: number;
  replayHash: Hex | null;
  onChainHash: Hex | null;
  onChainEngineVersion: string | null;
}): Verdict {
  const { divergence, moveCount, replayHash, onChainHash, onChainEngineVersion } = input;
  if (onChainEngineVersion && onChainEngineVersion !== ENGINE_VERSION) {
    return {
      status: "mismatch",
      message: `Engine version skew: replay v${ENGINE_VERSION} vs on-chain v${onChainEngineVersion}`,
    };
  }
  if (divergence) {
    return { status: "mismatch", message: `Divergence at move ${divergence.moveIndex}: ${divergence.reason}` };
  }
  if (replayHash === null || onChainHash === null) {
    return {
      status: "unavailable",
      message: `All ${moveCount} moves replay identically through dots-engine v${ENGINE_VERSION}. Hash check unavailable (engine pending).`,
    };
  }
  return replayHash.toLowerCase() === onChainHash.toLowerCase()
    ? { status: "match", message: `Replay hash ${replayHash.slice(0, 10)}… matches on-chain hash` }
    : { status: "mismatch", message: `Replay hash ${replayHash.slice(0, 10)}… ≠ on-chain ${onChainHash.slice(0, 10)}…` };
}
