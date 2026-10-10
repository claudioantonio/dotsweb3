import { Button, HStack, Spinner, Stack, Text } from "@chakra-ui/react";
import type { Coord } from "@dotsweb3/protocol";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import type { InputOutcome } from "../cartesi/inputStatus";
import { rebuild } from "../engine-adapter";
import { useHealth, useMatchState, useNow, useSessionView } from "../queries";
import { useNoticeSnapshot } from "../services";
import { applyNotices, fromMatchView, type LiveMatch } from "../state/match";
import { reconcilePending, type PendingMove } from "../state/pending";
import { sessionPhase } from "../state/session";
import { STAGE_LABEL, useTx } from "../tx";
import { Panel } from "../ui/common";
import { useWallet } from "../wallet/useWallet";
import { MatchPanel } from "./MatchPanel";

/** inspect `state(matchId)` seed + this match's notices. */
export function useLiveMatch(matchId: string | undefined): {
  match: LiveMatch | null;
  loading: boolean;
  missing: boolean;
  error: boolean;
} {
  const state = useMatchState(matchId);
  const { notices } = useNoticeSnapshot();
  const match = useMemo(
    () => (state.data ? applyNotices(fromMatchView(state.data), notices.filter((n) => n.matchId === matchId)) : null),
    [state.data, notices, matchId],
  );
  // Missed a notice (gap) → re-inspect once.
  const refetch = state.refetch;
  const stale = match?.stale ?? false;
  useEffect(() => {
    if (stale) void refetch();
  }, [stale, refetch]);
  return { match, loading: state.isPending && !state.isError, missing: state.isSuccess && state.data === null, error: state.isError };
}

/** S4 (players) / S6 (everyone else). `/match/:id` renders as Spectate for non-players. */
export function MatchScreen({ spectate = false }: { spectate?: boolean }) {
  const { matchId } = useParams();
  const w = useWallet();
  const me = w.address;
  const now = useNow();
  const session = useSessionView();
  const health = useHealth();
  const tx = useTx();
  const { match, loading, missing, error } = useLiveMatch(matchId);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [outcome, setOutcome] = useState<InputOutcome | null>(null);

  const rebuilt = useMemo(
    () => (match ? rebuild(match.gridSize, match.players, match.matchId, match.moves) : null),
    [match],
  );
  const resolution = reconcilePending(pending, match?.moves ?? [], outcome).resolution;
  useEffect(() => {
    if (pending && resolution !== "waiting") {
      setPending(null);
      setOutcome(null);
    }
  }, [pending, resolution]);

  if (loading) return <Spinner />;
  if (error && !match) return <Text color="danger">Couldn't reach the machine to load match #{matchId}.</Text>;
  if (missing || !match || !rebuilt) {
    return (
      <Panel>
        <Text>Match #{matchId} doesn't exist (yet).</Text>
        <Button asChild mt="3" variant="outline"><Link to="/">Back to lobby</Link></Button>
      </Panel>
    );
  }

  const isPlayer = !!me && match.players.includes(me);
  if (spectate && isPlayer) return <Navigate to={`/match/${match.matchId}`} replace />;
  if (isPlayer && match.ended) return <Navigate to={`/match/${match.matchId}/result`} replace />;

  const phase = sessionPhase(session.data?.session ?? null, now).phase;
  const readOnly = !isPlayer || w.status !== "CONNECTED";
  const myTx = tx.current;

  const onEdge = async (edge: [Coord, Coord]) => {
    if (!me) return;
    setPending({ matchId: match.matchId, moveIndex: match.moves.length, edge, submitter: me });
    setOutcome(null);
    const o = await tx.submit({ type: "move", matchId: match.matchId, edge }, me);
    // null = never reached the machine (cancelled / tx failed): drop the badge.
    setOutcome(o ?? { status: "FAILED", nodeStatus: "NONE" });
  };
  const onClaim = () => {
    if (me) void tx.submit({ type: "claimForfeit", matchId: match.matchId }, me);
  };

  let txLabel: string | null = null;
  if (myTx?.action.type === "move") txLabel = `Move #${match.moves.length + 1} · ${STAGE_LABEL[myTx.stage]}`;
  else if (myTx?.action.type === "claimForfeit") txLabel = `Forfeit claim · ${STAGE_LABEL[myTx.stage]}`;
  else if (pending) txLabel = `Move #${pending.moveIndex + 1} accepted · waiting for the notice`;

  return (
    <Stack gap="4">
      {!isPlayer && (
        <HStack justify="space-between">
          <Text fontSize="sm" color="fg.muted">Watching (read-only)</Text>
          {match.ended && (
            <Button asChild size="sm" colorPalette="cyan"><Link to={`/replay/${match.matchId}`}>Replay</Link></Button>
          )}
        </HStack>
      )}
      {!isPlayer && match.ended && <SpectatorResult match={match} />}
      <MatchPanel
        match={match}
        board={rebuilt.board}
        divergence={rebuilt.divergence}
        me={me}
        now={now}
        phase={phase}
        pending={pending}
        txLabel={txLabel}
        busy={!!myTx}
        claimPending={myTx?.action.type === "claimForfeit"}
        stale={!health.ok}
        onEdge={readOnly ? undefined : (e) => void onEdge(e)}
        onClaim={readOnly ? undefined : onClaim}
      />
    </Stack>
  );
}

function SpectatorResult({ match }: { match: LiveMatch }) {
  const e = match.ended!;
  return (
    <Panel borderColor="accent">
      <Text fontWeight="semibold">
        {e.abandoned
          ? "Abandoned — no winner"
          : `Won by ${e.winner?.slice(0, 6)}…${e.winner?.slice(-4)}${e.forfeit ? " (forfeit)" : ""}`}
      </Text>
    </Panel>
  );
}
