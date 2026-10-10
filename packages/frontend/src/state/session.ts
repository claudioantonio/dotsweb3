import type { SessionConfig, UnixSeconds } from "@dotsweb3/protocol";

export type SessionPhase = "NONE" | "SCHEDULED" | "OPEN" | "CUTOFF" | "ENDED";

export interface SessionPhaseInfo {
  phase: SessionPhase;
  /** Countdown target (machine timestamps only), or null. */
  target: UnixSeconds | null;
}

/** ux-plan §1.1. Boundaries match the machine: start ≤ now < cutoffAt is OPEN. */
export function sessionPhase(session: SessionConfig | null | undefined, now: UnixSeconds): SessionPhaseInfo {
  if (!session) return { phase: "NONE", target: null };
  if (now < session.sessionStart) return { phase: "SCHEDULED", target: session.sessionStart };
  if (now < session.cutoffAt) return { phase: "OPEN", target: session.cutoffAt };
  if (now < session.sessionEnd) return { phase: "CUTOFF", target: session.sessionEnd };
  return { phase: "ENDED", target: null };
}

/**
 * Clock-skew anchor: `machineTime` is the last advance's block timestamp. If
 * it is ahead of our wall clock when fetched, our clock is slow by at least
 * that much; shift by it. (A fast local clock cannot be detected this way.)
 */
export function skewOffset(machineTime: UnixSeconds | null, wallAtFetch: UnixSeconds): number {
  return machineTime !== null && machineTime > wallAtFetch ? machineTime - wallAtFetch : 0;
}

/** `m:ss`, or `h:mm:ss`, or `Nd h:mm:ss`; never negative. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${ss}`;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}
