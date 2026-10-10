import { Badge, Box, Button, Code, Flex, HStack, Heading, Spinner, Stack, Text } from "@chakra-ui/react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { DotGrid } from "../board/DotGrid";
import { isForfeitRace, resultHeadline, resultVariant } from "../copy/rejections";
import { ENGINE_VERSION, rebuild } from "../engine-adapter";
import { useLateMove, useNow, useSessionView } from "../queries";
import { opponentOf } from "../state/match";
import { formatCountdown, sessionPhase } from "../state/session";
import { STAGE_LABEL, useTx } from "../tx";
import { Panel, addressText } from "../ui/common";
import { toaster } from "../ui/toaster";
import { useWallet } from "../wallet/useWallet";
import { useJoinQueue } from "./hooks";
import { useLiveMatch } from "./Match";

/** S5 — post-match result + re-queue. */
export function Result() {
  const { matchId } = useParams();
  const w = useWallet();
  const me = w.address;
  const now = useNow();
  const session = useSessionView();
  const tx = useTx();
  const join = useJoinQueue();
  const { match, loading, error } = useLiveMatch(matchId);
  const lostByForfeit = !!me && !!match?.ended?.forfeit && match.ended.loser?.toLowerCase() === me;
  const lateMove = useLateMove(match?.matchId, me, lostByForfeit);
  const board = useMemo(() => (match ? rebuild(match.gridSize, match.players, match.matchId, match.moves).board : null), [match]);

  if (loading) return <Spinner />;
  if (error && !match) return <Text color="danger">Couldn't reach the machine to load match #{matchId}.</Text>;
  if (!match || !board) return <Text>Match #{matchId} not found.</Text>;
  const ended = match.ended;
  if (!ended) {
    return (
      <Panel>
        <Text>Match #{matchId} is still live.</Text>
        <Button asChild mt="3" colorPalette="cyan"><Link to={`/match/${matchId}`}>Back to the board</Link></Button>
      </Panel>
    );
  }

  const race = !!me && isForfeitRace(lateMove.data ?? null, ended, me);
  const variant = resultVariant(ended, me, race);
  const mineAddr = me && match.players.includes(me) ? me : match.players[0];
  const theirAddr = opponentOf(match, mineAddr);
  const { title, detail } = resultHeadline(variant, ended.squares[mineAddr] ?? 0, ended.squares[theirAddr] ?? 0);
  const phase = sessionPhase(session.data?.session ?? null, now).phase;
  const replayUrl = `${window.location.origin}/replay/${ended.matchId}`;

  const share = async () => {
    try {
      await navigator.clipboard.writeText(replayUrl);
      toaster.create({ type: "success", title: "Replay link copied" });
    } catch {
      toaster.create({ type: "info", title: "Replay link", description: replayUrl });
    }
  };

  return (
    <Stack gap="6">
      <Stack gap="1">
        <Heading size="3xl" color={variant.startsWith("WON") ? "success" : variant === "ABANDONED" || variant === "SPECTATOR" ? undefined : "danger"}>
          {title}
        </Heading>
        {detail && <Text color="fg.muted">{detail}</Text>}
        {ended.zeroMoveForfeit && (
          <Text color="warning">Zero-move forfeit — recorded, but excluded from session stats.</Text>
        )}
      </Stack>

      <Flex gap="6" wrap="wrap" align="flex-start">
        <Box>
          <DotGrid board={board} players={match.players} scale={0.7} />
        </Box>
        <Panel flex="1" minW="300px">
          <Stack gap="2" fontSize="sm">
            <Text>
              Score: {match.players.map((p) => `${addressText(p, me)} ${ended.squares[p] ?? 0}`).join(" – ")}
            </Text>
            <Text>Duration: {formatCountdown(ended.durationSeconds)}</Text>
            <Text>
              Longest chain: {match.players.map((p) => `${addressText(p, me)} ${ended.longestChain[p] ?? 0}`).join(" · ")}
            </Text>
            <Text>
              Final board hash:{" "}
              {ended.finalBoardHash ? (
                <Code title={ended.finalBoardHash}>{ended.finalBoardHash.slice(0, 18)}…</Code>
              ) : (
                <Text as="span" color="fg.muted">not yet produced (engine pending)</Text>
              )}
            </Text>
            <Text>
              Engine: v{ended.engineVersion}
              {ended.engineVersion !== ENGINE_VERSION && <Badge ml="2" colorPalette="red">this app runs v{ENGINE_VERSION}</Badge>}
            </Text>
            <HStack pt="2">
              <Button asChild size="sm" variant="outline"><Link to={`/replay/${ended.matchId}`}>Replay</Link></Button>
              <Button size="sm" variant="ghost" onClick={() => void share()}>Share</Button>
            </HStack>
          </Stack>
        </Panel>
      </Flex>

      <Panel>
        {phase === "OPEN" && variant !== "SPECTATOR" ? (
          <Button colorPalette="cyan" size="lg" loading={join.pending} loadingText={tx.current ? STAGE_LABEL[tx.current.stage] : undefined} disabled={join.disabled} onClick={() => void join.join()}>
            Join queue again
          </Button>
        ) : (
          <Stack gap="3">
            {phase !== "OPEN" && <Text>Match starts are closed for this session.</Text>}
            <Box>
              <Button asChild variant="outline"><Link to="/">Back to lobby</Link></Button>
            </Box>
          </Stack>
        )}
      </Panel>
    </Stack>
  );
}
