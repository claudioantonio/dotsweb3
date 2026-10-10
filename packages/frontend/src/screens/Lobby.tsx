import { Box, Button, Grid, Heading, List, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useMyLiveMatchId, useNow, useQueueView, useSessionView } from "../queries";
import { queuePosition } from "../state/player";
import { sessionPhase } from "../state/session";
import { STAGE_LABEL, useTx } from "../tx";
import { Countdown, Panel } from "../ui/common";
import { LiveMatches } from "../ui/LiveMatches";
import { useWallet } from "../wallet/useWallet";
import { useConnectModal } from "./ConnectModal";
import { useJoinQueue, useLiveList } from "./hooks";

/** S1 — Lobby / welcome, every session phase. */
export function Lobby() {
  const session = useSessionView();
  const now = useNow();
  const w = useWallet();
  const live = useLiveList();
  const { matchId: myMatch } = useMyLiveMatchId(w.address);
  const queue = useQueueView({ enabled: !!w.address });
  const queued = w.address ? queuePosition(queue.data, w.address) : null;
  const join = useJoinQueue();
  const tx = useTx();
  const openConnect = useConnectModal();
  const navigate = useNavigate();

  const cfg = session.data?.session ?? null;
  const { phase, target } = sessionPhase(cfg, now);
  const n = cfg?.sessionId;

  let headline: ReactNode;
  let cta: ReactNode = null;
  switch (phase) {
    case "NONE":
      headline = "No session scheduled yet — watch this page for the next one.";
      cta = (
        <Button asChild variant="outline">
          <Link to="/practice">Practice on a local board</Link>
        </Button>
      );
      break;
    case "SCHEDULED":
      headline = (
        <>
          Next session in <Countdown target={target!} now={now} />
        </>
      );
      if (!w.address) cta = <Button variant="outline" onClick={openConnect}>Get your wallet ready</Button>;
      break;
    case "OPEN":
      headline = (
        <>
          Session #{n} is live — <Countdown target={target!} now={now} /> left to start a match · {live.length} live
        </>
      );
      if (myMatch) cta = <Button colorPalette="cyan" onClick={() => navigate(`/match/${myMatch}`)}>Back to your match</Button>;
      else if (queued) cta = <Button colorPalette="cyan" onClick={() => navigate("/queue")}>You're queued (#{queued.position}) — open queue</Button>;
      else if (w.status === "DISCONNECTED" || w.status === "CONNECTING") cta = <Button colorPalette="cyan" onClick={openConnect}>Connect wallet</Button>;
      else if (w.status === "WRONG_CHAIN") cta = <Button colorPalette="orange" onClick={openConnect}>Switch network</Button>;
      else if (w.unfunded) cta = <Button colorPalette="orange" onClick={openConnect}>Fund wallet first</Button>;
      else
        cta = (
          <Button colorPalette="cyan" size="lg" loading={join.pending} loadingText={tx.current ? STAGE_LABEL[tx.current.stage] : undefined} disabled={join.disabled} onClick={() => void join.join()}>
            Join queue
          </Button>
        );
      break;
    case "CUTOFF":
      headline = `Match starts have closed — ${live.length} match${live.length === 1 ? "" : "es"} still live`;
      cta = live[0] ? <Button asChild colorPalette="cyan"><Link to={`/watch/${live[0].matchId}`}>Watch a live match</Link></Button> : null;
      if (myMatch) cta = <Button colorPalette="cyan" onClick={() => navigate(`/match/${myMatch}`)}>Back to your match</Button>;
      break;
    case "ENDED":
      headline = `Session #${n} ended — stat sheet within 24h`;
      if (myMatch) cta = <Button colorPalette="cyan" onClick={() => navigate(`/match/${myMatch}`)}>Back to your match</Button>;
      break;
  }

  return (
    <Stack gap="8">
      <Stack gap="3">
        <Heading size="4xl">Dots</Heading>
        <Text color="fg.muted" fontSize="lg">
          1v1 dots-and-boxes, every move on-chain, every match replayable.
        </Text>
        <Panel>
          {session.isPending ? (
            <Text color="fg.muted">Loading session…</Text>
          ) : session.isError ? (
            <Text color="danger">Couldn't reach the machine to read the session. Retrying…</Text>
          ) : (
            <Stack gap="4">
              <Text fontSize="xl" fontWeight="semibold">
                {headline}
              </Text>
              {cta && <Box>{cta}</Box>}
            </Stack>
          )}
        </Panel>
      </Stack>

      <Grid templateColumns={{ base: "1fr", lg: "2fr 1fr" }} gap="6">
        <Box>
          {phase === "OPEN" || phase === "CUTOFF" || phase === "ENDED" ? (
            <LiveMatches matches={live} me={w.address} now={now} queueLength={session.data?.queueLength} />
          ) : (
            <Panel>
              <Text fontWeight="bold" mb="2">Last session</Text>
              <Text color="fg.muted" fontSize="sm">The session stat sheet will be linked here once published.</Text>
            </Panel>
          )}
        </Box>
        <Panel>
          <Text fontWeight="bold" mb="2">How to play</Text>
          <List.Root gap="1" fontSize="sm" color="fg.muted" ps="4">
            <List.Item>
              {cfg ? `${cfg.gridSize}×${cfg.gridSize}` : "6×6"} dots; draw one line per turn between neighbouring dots.
            </List.Item>
            <List.Item>Close a square and you move again.</List.Item>
            <List.Item>
              {cfg?.turnTimeout ?? 60} s per turn, or your opponent can claim a forfeit.
            </List.Item>
            <List.Item>The first player to join the queue moves first.</List.Item>
          </List.Root>
        </Panel>
      </Grid>
    </Stack>
  );
}
