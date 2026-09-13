import { Box, Button, Container, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { DotGrid } from "./board/DotGrid";
import { useLocalMatch } from "./board/useLocalMatch";

const PLAYER_LABELS: Record<string, string> = {
  "player-a": "Player A",
  "player-b": "Player B",
};

function playerLabel(player: string): string {
  return PLAYER_LABELS[player] ?? player;
}

function App() {
  const { match, selected, error, onDotClick, reset } = useLocalMatch();
  const isOver = match.isOVer();
  const winner = isOver ? match.getWinner() : null;

  let statusMessage: string;
  if (isOver) {
    statusMessage = match.isDraw() ? "Draw!" : `${playerLabel(winner ?? "")} wins!`;
  } else if (error) {
    statusMessage = error;
  } else if (selected) {
    statusMessage = "Pick an adjacent dot to draw a line";
  } else {
    statusMessage = `${playerLabel(match.turn)}'s turn — select a dot to start`;
  }

  return (
    <Container centerContent py={10}>
      <VStack gap={6}>
        <Heading size="lg">Dots</Heading>

        <HStack gap={8}>
          {match.players.map((player) => (
            <Text key={player} fontWeight={!isOver && match.turn === player ? "bold" : "normal"}>
              {playerLabel(player)}: {match.getScore()[player] ?? 0}
            </Text>
          ))}
        </HStack>

        <Text minH="1.5em" color={isOver ? "green.600" : error ? "red.600" : "gray.600"}>
          {statusMessage}
        </Text>

        <Box borderWidth={1} borderColor="gray.200" borderRadius="md" p={4} bg="white">
          <DotGrid match={match} selected={selected} onDotClick={onDotClick} />
        </Box>

        <Button onClick={reset} colorPalette="blue">
          Reset
        </Button>
      </VStack>
    </Container>
  );
}

export default App;
