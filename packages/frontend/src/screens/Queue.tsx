import { Box, Button, HStack, Heading, Spinner, Stack, Text } from "@chakra-ui/react";
import { Link, Navigate } from "react-router";
import { useMyLiveMatchId, useNow, useQueueView, useSessionView } from "../queries";
import { queuePosition } from "../state/player";
import { formatCountdown, sessionPhase } from "../state/session";
import { STAGE_LABEL, useTx } from "../tx";
import { Countdown, Panel } from "../ui/common";
import { LiveMatches } from "../ui/LiveMatches";
import { useWallet } from "../wallet/useWallet";
import { useConnectModal } from "./ConnectModal";
import { useJoinQueue, useLiveList } from "./hooks";

/** S3 — Queue. Pairing → global PairingWatcher redirects to the board. */
export function Queue() {
  const w = useWallet();
  const session = useSessionView();
  const now = useNow();
  const queue = useQueueView({ enabled: !!w.address, poll: true });
  const { matchId: myMatch, loading } = useMyLiveMatchId(w.address);
  const live = useLiveList();
  const tx = useTx();
  const join = useJoinQueue();
  const openConnect = useConnectModal();

  if (!w.address) {
    return (
      <Panel maxW="lg">
        <Stack gap="3">
          <Text>Connect your wallet to join the queue.</Text>
          <Button colorPalette="cyan" onClick={openConnect}>Connect wallet</Button>
        </Stack>
      </Panel>
    );
  }
  if (myMatch) return <Navigate to={`/match/${myMatch}`} replace />;
  if (session.isPending || queue.isPending || loading) return <Spinner />;

  const cfg = session.data?.session ?? null;
  const { phase } = sessionPhase(cfg, now);
  const q = queuePosition(queue.data, w.address);
  if (!q && phase !== "OPEN" && !tx.current) return <Navigate to="/" replace />;

  const leaving = tx.current?.action.type === "leaveQueue";
  const leave = () => void tx.submit({ type: "leaveQueue" }, w.address!);

  return (
    <Stack gap="6">
      <Heading size="2xl">Queue</Heading>
      {q && phase !== "OPEN" ? (
        <Panel borderColor="warning">
          <Stack gap="3">
            <Text fontSize="lg" fontWeight="semibold">
              Pairing has closed for Session #{cfg?.sessionId} — you won't be matched this session.
            </Text>
            <Text color="fg.muted">Your queue entry clears automatically.</Text>
            <HStack>
              <Button asChild variant="outline"><Link to="/">Back to lobby</Link></Button>
              <Button variant="ghost" loading={leaving} disabled={!!tx.current} onClick={leave}>Leave queue now</Button>
            </HStack>
          </Stack>
        </Panel>
      ) : q ? (
        <Panel>
          <Stack gap="3">
            <HStack gap="3">
              <Spinner size="sm" color="accent" />
              <Text fontSize="xl" fontWeight="semibold">
                You're #{q.position} in queue{q.position > 1 ? ` · ${q.position - 1} ahead of you` : ""}
              </Text>
            </HStack>
            <Text color="fg.muted">
              Matches start when two players are queued · waiting {formatCountdown(now - q.joinedAt)}
            </Text>
            {cfg && (
              <Text fontSize="lg">
                Pairing closes in <Countdown target={cfg.cutoffAt} now={now} fontWeight="bold" />
              </Text>
            )}
            <Box>
              <Button variant="outline" loading={leaving} loadingText={tx.current ? STAGE_LABEL[tx.current.stage] : undefined} disabled={!!tx.current} onClick={leave}>
                Leave queue
              </Button>
            </Box>
          </Stack>
        </Panel>
      ) : (
        <Panel>
          <Stack gap="3">
            <Text>{join.pending && tx.current ? STAGE_LABEL[tx.current.stage] : "You're not in the queue."}</Text>
            <Box>
              <Button colorPalette="cyan" loading={join.pending} disabled={join.disabled} onClick={() => void join.join()}>
                Join queue
              </Button>
            </Box>
          </Stack>
        </Panel>
      )}
      <LiveMatches matches={live} me={w.address} now={now} />
    </Stack>
  );
}
