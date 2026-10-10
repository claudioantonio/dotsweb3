import type { Address, MatchId } from "@dotsweb3/protocol";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { findLateMove } from "./cartesi/inputStatus";
import { myLiveMatchId } from "./state/player";
import { skewOffset } from "./state/session";
import { useNoticeSnapshot, useServices } from "./services";

/**
 * Inspect is hit on navigation/recovery (react-query refetch on mount/focus);
 * the only loops are /queue (10 s) and a slow session refresh so a lobby left
 * open notices a newly scheduled session. Live data comes from notices.
 */
export const qk = {
  session: ["inspect", "session"] as const,
  queue: ["inspect", "queue"] as const,
  match: (id: MatchId) => ["inspect", "state", "match", id] as const,
  player: (a: Address) => ["inspect", "state", "player", a] as const,
  history: (id: MatchId) => ["inspect", "history", id] as const,
};

export function useSessionView() {
  const { inspect } = useServices();
  return useQuery({ queryKey: qk.session, queryFn: () => inspect({ route: "session" }), refetchInterval: 60_000 });
}

export function useQueueView(opts: { enabled?: boolean; poll?: boolean } = {}) {
  const { inspect } = useServices();
  return useQuery({
    queryKey: qk.queue,
    queryFn: () => inspect({ route: "queue" }),
    enabled: opts.enabled ?? true,
    refetchInterval: opts.poll ? 10_000 : false,
  });
}

export function useMatchState(matchId: MatchId | undefined) {
  const { inspect } = useServices();
  return useQuery({
    queryKey: qk.match(matchId ?? ""),
    queryFn: () => inspect({ route: "state", matchId: matchId! }),
    enabled: !!matchId,
  });
}

export function useHistory(matchId: MatchId | undefined) {
  const { inspect } = useServices();
  return useQuery({
    queryKey: qk.history(matchId ?? ""),
    queryFn: () => inspect({ route: "history", matchId: matchId! }),
    enabled: !!matchId,
    staleTime: Infinity,
  });
}

/** Recovery rule (ux-plan §1.3): my live match from inspect, kept current by notices. */
export function useMyLiveMatchId(me: Address | null): { matchId: MatchId | null; loading: boolean } {
  const { inspect } = useServices();
  const seed = useQuery({
    queryKey: qk.player(me ?? ""),
    queryFn: () => inspect({ route: "state", player: me! }),
    enabled: !!me,
  });
  const { notices } = useNoticeSnapshot();
  // The store holds every notice since boot, in order, and the fold is
  // idempotent, so replaying all of them over the seed is safe.
  const matchId = useMemo(() => {
    if (!me) return null;
    const base = seed.data && seed.data.status === "live" ? seed.data.matchId : null;
    return myLiveMatchId(base, notices, me);
  }, [me, seed.data, notices]);
  return { matchId: me ? matchId : null, loading: !!me && seed.isPending };
}

/** Wall clock (unix seconds), ticking every second, shifted by the machine-time skew anchor. */
export function useNow(): number {
  const session = useSessionView();
  const offset =
    session.data !== undefined ? skewOffset(session.data.machineTime, Math.floor(session.dataUpdatedAt / 1000)) : 0;
  const [wall, setWall] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setWall(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return wall + offset;
}

const STALL_MS = 15_000;

/** ux-plan §1.4 health banner inputs. */
export function useHealth(): { ok: boolean; reason: string | null } {
  const { rpc } = useServices();
  const app = useQuery({ queryKey: ["node", "application"], queryFn: () => rpc.getApplication(), refetchInterval: 30_000 });
  const snap = useNoticeSnapshot();
  const [wallMs, setWallMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setWallMs(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  if (app.data && (!app.data.enabled || app.data.status !== "OK")) {
    return { ok: false, reason: `Application ${app.data.status}${app.data.reason ? `: ${app.data.reason}` : ""}` };
  }
  if (app.isError && app.failureCount > 1) return { ok: false, reason: "Node unreachable" };
  if (snap.lastError && (snap.lastOkAt === null || wallMs - snap.lastOkAt > STALL_MS)) {
    return { ok: false, reason: "Notice stream stalled" };
  }
  return { ok: true, reason: null };
}

/**
 * F12 forfeit race, from any tab: my declined MATCH_ENDED `move` for this
 * match (RejectedReport.matchId + input sender). Only asked when the match
 * ended by forfeit with me as the loser.
 */
export function useLateMove(matchId: MatchId | undefined, me: Address | null, enabled: boolean) {
  const { rpc } = useServices();
  return useQuery({
    queryKey: ["node", "lateMove", matchId ?? "", me ?? ""],
    queryFn: () => findLateMove(rpc, matchId!, me!),
    enabled: enabled && !!matchId && !!me,
    staleTime: Infinity,
  });
}
