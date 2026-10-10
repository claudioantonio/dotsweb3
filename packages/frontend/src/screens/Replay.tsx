import { Alert, Box, Button, Flex, HStack, Heading, Spinner, Stack, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { DotGrid } from "../board/DotGrid";
import { ENGINE_VERSION } from "../engine-adapter";
import { useHistory } from "../queries";
import { buildFrames, verify } from "../state/replay";
import { Panel, shortAddress } from "../ui/common";

const STEP_MS = 200;

/** S7 — thin replay: history → engine → auto-play, verification card (hash check stubbed). */
export function Replay() {
  const { matchId } = useParams();
  const history = useHistory(matchId);
  const built = useMemo(() => (history.data ? buildFrames(history.data) : null), [history.data]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const last = built ? built.frames.length - 1 : 0;

  useEffect(() => {
    if (!playing || !built || step >= last) return;
    const t = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, built, step, last]);

  if (history.isPending) return <Spinner />;
  if (history.isError) return <Text color="danger">Couldn't load the match history from the machine.</Text>;
  const h = history.data;
  if (!h || !built) return <Text>Match #{matchId} not found.</Text>;

  const verdict = verify({
    divergence: built.divergence,
    moveCount: h.moves.length,
    replayHash: built.replayHash,
    onChainHash: h.ended?.finalBoardHash ?? null,
    onChainEngineVersion: h.ended?.engineVersion ?? null,
  });
  const status = verdict.status === "match" ? "success" : verdict.status === "mismatch" ? "error" : "info";

  return (
    <Stack gap="6">
      <Heading size="2xl">
        Replay · match #{h.matchId}
      </Heading>
      <Alert.Root status={status} variant="surface">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{verdict.status === "match" ? "Verified ✓" : verdict.status === "mismatch" ? "Verification failed ✗" : "Replay consistent"}</Alert.Title>
          <Alert.Description>{verdict.message}</Alert.Description>
        </Alert.Content>
      </Alert.Root>

      <Flex gap="6" wrap="wrap" align="flex-start">
        <Box>
          <DotGrid board={built.frames[step]} players={h.players} highlightMoveIndex={step - 1} />
        </Box>
        <Panel flex="1" minW="280px">
          <Stack gap="3">
            <Text fontSize="lg">
              Move {step}/{h.moves.length}
            </Text>
            <HStack>
              <Button
                size="sm"
                colorPalette="cyan"
                onClick={() => {
                  if (step >= last) setStep(0);
                  setPlaying((p) => (step >= last ? true : !p));
                }}
              >
                {playing && step < last ? "Pause" : step >= last ? "Restart" : "Play"}
              </Button>
              <Button size="sm" variant="outline" disabled title="Scrubber coming later">
                Scrub
              </Button>
            </HStack>
            <Text fontSize="sm" color="fg.muted">
              {shortAddress(h.players[0])} vs {shortAddress(h.players[1])} · {h.gridSize}×{h.gridSize}
            </Text>
            <Text fontSize="sm" color="fg.muted">
              Replay engine: dots-engine v{ENGINE_VERSION}
              {h.ended ? ` · on-chain: v${h.ended.engineVersion}` : " · match still live"}
            </Text>
          </Stack>
        </Panel>
      </Flex>
    </Stack>
  );
}
