import { Alert, Badge, Box, Button, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import type { Address, Coord } from "@dotsweb3/protocol";
import type { ReactNode } from "react";
import { DotGrid } from "../board/DotGrid";
import { useEdgeSelection } from "../board/useEdgeSelection";
import type { BoardView, Divergence } from "../engine-adapter";
import { turnStatus, type LiveMatch } from "../state/match";
import type { PendingMove } from "../state/pending";
import type { SessionPhase } from "../state/session";
import { AddressLabel, Countdown, Panel, addressText } from "../ui/common";

export interface MatchPanelProps {
  match: LiveMatch;
  board: BoardView;
  divergence: Divergence | null;
  me: Address | null;
  /** Machine-adjusted unix seconds. */
  now: number;
  phase: SessionPhase;
  pending: PendingMove | null;
  /** Human status of my in-flight input, if any. */
  txLabel: string | null;
  /** Any own input in flight (one nonce at a time). */
  busy: boolean;
  claimPending: boolean;
  /** Countdowns may be stale (health banner up). */
  stale?: boolean;
  onEdge?: (edge: [Coord, Coord]) => void;
  onClaim?: () => void;
}

const fmtEdge = ([[x1, y1], [x2, y2]]: [Coord, Coord]) => `(${x1},${y1})→(${x2},${y2})`;

/** S4 board + side panel (presentational; S6 Spectate reuses it read-only). */
export function MatchPanel(props: MatchPanelProps) {
  const { match, board, divergence, me, now, phase, pending, txLabel, busy, claimPending, stale, onEdge, onClaim } = props;
  const status = turnStatus(match, me, now);
  const canMove = (status === "MY_TURN" || status === "I_TIMED_OUT") && !busy && !pending && !!onEdge;
  const selection = useEdgeSelection((e) => onEdge?.(e), canMove);
  const deadline = match.forfeitDeadline;
  const last = match.moves[match.moves.length - 1];
  const extraMove = !!me && !!last && last.submitter === me && last.squaresClosed > 0 && match.turn === me && !match.ended;
  const firstMove = match.moves.length === 0;

  const playerCard = (seat: 0 | 1) => {
    const p = match.players[seat];
    const onTurn = !match.ended && match.turn === p;
    return (
      <Panel flex="1" borderColor={onTurn ? (seat === 0 ? "playerA" : "playerB") : undefined} p="4">
        <HStack justify="space-between">
          <Stack gap="0">
            <AddressLabel address={p} self={me} color={seat === 0 ? "playerA" : "playerB"} fontWeight="semibold" />
            {onTurn && deadline !== null && (
              <Text fontSize="sm" color="fg.muted">
                on turn · <Countdown target={deadline} now={now} />
              </Text>
            )}
          </Stack>
          <Text fontSize="3xl" fontWeight="bold">
            {board.scores[p] ?? 0}
          </Text>
        </HStack>
      </Panel>
    );
  };

  let turnLine: ReactNode = null;
  if (status === "MY_TURN" && deadline !== null) {
    turnLine = firstMove ? (
      <Text fontSize="lg" fontWeight="semibold">
        You have <Countdown target={deadline} now={now} /> for your first move
      </Text>
    ) : (
      <Text fontSize="lg" fontWeight="semibold">
        Your move · <Countdown target={deadline} now={now} /> left
      </Text>
    );
  } else if (status === "THEIR_TURN" && deadline !== null) {
    turnLine = (
      <Text fontSize="lg">
        Waiting for {addressText(match.turn, me)} · <Countdown target={deadline} now={now} />
      </Text>
    );
  } else if (status === "SPECTATING") {
    turnLine = (
      <Text fontSize="lg">
        <Badge colorPalette="red" mr="2">Live</Badge>
        {addressText(match.turn, me)} to move{deadline !== null && <> · <Countdown target={deadline} now={now} /></>}
      </Text>
    );
  }

  return (
    <Stack gap="4">
      {(phase === "CUTOFF" || phase === "ENDED") && !match.ended && (
        <Alert.Root status="info" variant="subtle">
          <Alert.Indicator />
          <Alert.Title>Session #{match.sessionId} match starts are closed — this match plays to the end.</Alert.Title>
        </Alert.Root>
      )}
      <HStack gap="4" align="stretch">
        {playerCard(0)}
        <Flex align="center" color="fg.muted">vs</Flex>
        {playerCard(1)}
      </HStack>
      <Text color="fg.muted" fontSize="sm">
        Match #{match.matchId} · Move {match.moves.length}/{2 * board.size * (board.size - 1)}
        {stale && " · countdowns may be stale"}
      </Text>

      <Flex gap="6" wrap="wrap" align="flex-start">
        <Box>
          <DotGrid
            board={board}
            players={match.players}
            selected={selection.selected}
            onDotClick={canMove ? selection.onDotClick : undefined}
            pending={pending?.edge ?? null}
            highlightMoveIndex={last?.moveIndex ?? null}
          />
        </Box>

        <Stack gap="4" flex="1" minW="280px">
          {turnLine}
          {extraMove && <Text color="success">You closed a square — go again!</Text>}

          {status === "OPPONENT_TIMED_OUT" && (
            <Panel borderColor="danger">
              <Stack gap="3">
                <Text fontWeight="semibold" color="danger">
                  Opponent hasn't moved in time
                </Text>
                <Text fontSize="sm" color="fg.muted">
                  Their deadline has passed. Claim the forfeit to win — if they move first, the match continues.
                </Text>
                <Button colorPalette="red" onClick={onClaim} loading={claimPending} loadingText="Claim pending…" disabled={busy || !onClaim}>
                  Claim forfeit
                </Button>
              </Stack>
            </Panel>
          )}
          {status === "I_TIMED_OUT" && (
            <Alert.Root status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Your turn has expired</Alert.Title>
                <Alert.Description>
                  Your opponent can claim a forfeit. Moving now still counts until they do.
                </Alert.Description>
              </Alert.Content>
            </Alert.Root>
          )}

          {divergence && (
            <Alert.Root status="error">
              <Alert.Indicator />
              <Alert.Title>
                Board rebuild diverged at move {divergence.moveIndex}: {divergence.reason}
              </Alert.Title>
            </Alert.Root>
          )}

          {txLabel && (
            <HStack>
              <Badge colorPalette="yellow">pending</Badge>
              <Text fontSize="sm">{txLabel}</Text>
            </HStack>
          )}

          <Panel p="3">
            <Text fontWeight="semibold" mb="2" fontSize="sm">
              Moves
            </Text>
            <Stack gap="0" maxH="260px" overflowY="auto" fontFamily="mono" fontSize="xs">
              {match.moves.length === 0 && <Text color="fg.muted">No moves yet.</Text>}
              {[...match.moves].reverse().map((m) => (
                <Text key={m.moveIndex}>
                  #{m.moveIndex + 1} {addressText(m.submitter, me)} {fmtEdge(m.edge)}
                  {m.squaresClosed > 0 ? ` +${m.squaresClosed}` : ""}
                </Text>
              ))}
            </Stack>
          </Panel>

          <Text fontSize="sm" color="fg.muted">
            Longest chain this match: {match.players.map((p) => `${addressText(p, me)} ${board.longestChain[p] ?? 0}`).join(" · ")}
          </Text>
          {status !== "SPECTATING" && status !== "ENDED" && (
            <Text fontSize="xs" color="fg.subtle">
              Leaving the page doesn't pause your clock — leaving = forfeit.
            </Text>
          )}
        </Stack>
      </Flex>
    </Stack>
  );
}
