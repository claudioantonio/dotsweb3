import { Box, Button, HStack, Heading, Stack, Text } from "@chakra-ui/react";
import { DotGrid } from "../board/DotGrid";
import { LOCAL_PLAYERS, useLocalMatch } from "../board/useLocalMatch";

const LABEL: Record<string, string> = { "player-a": "Player A", "player-b": "Player B" };

/** The original local hot-seat board, kept as an off-chain practice mode. */
export function Practice() {
  const { match, board, selected, error, onDotClick, reset } = useLocalMatch();
  let status: string;
  if (board.over) status = match.isDraw() ? "Draw!" : `${LABEL[match.winner() ?? ""] ?? "?"} wins!`;
  else if (error) status = error;
  else if (selected) status = "Pick an adjacent dot to draw a line";
  else status = `${LABEL[board.turn]}'s turn — select a dot to start`;

  return (
    <Stack gap="5" align="center">
      <Heading size="xl">Practice (local, off-chain)</Heading>
      <HStack gap="8">
        {LOCAL_PLAYERS.map((p) => (
          <Text key={p} fontWeight={!board.over && board.turn === p ? "bold" : "normal"}>
            {LABEL[p]}: {board.scores[p] ?? 0}
          </Text>
        ))}
      </HStack>
      <Text minH="1.5em" color={board.over ? "success" : error ? "danger" : "fg.muted"}>
        {status}
      </Text>
      <Box>
        <DotGrid board={board} players={LOCAL_PLAYERS} selected={selected} onDotClick={onDotClick} />
      </Box>
      <Button onClick={reset} variant="outline">
        Reset
      </Button>
    </Stack>
  );
}
