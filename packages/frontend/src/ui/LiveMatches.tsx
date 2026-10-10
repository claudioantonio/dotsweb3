import { HStack, Link as ChakraLink, Stack, Text } from "@chakra-ui/react";
import type { Address, MatchSummary } from "@dotsweb3/protocol";
import { Link } from "react-router";
import { formatCountdown } from "../state/session";
import { AddressLabel, Panel } from "./common";

export function LiveMatches({
  matches,
  me,
  now,
  queueLength,
}: {
  matches: readonly MatchSummary[];
  me: Address | null;
  now: number;
  queueLength?: number;
}) {
  return (
    <Panel>
      <HStack justify="space-between" mb="3">
        <Text fontWeight="bold">Live matches</Text>
        {queueLength !== undefined && (
          <Text fontSize="sm" color="fg.muted">
            waiting in queue: {queueLength}
          </Text>
        )}
      </HStack>
      {matches.length === 0 ? (
        <Text color="fg.muted" fontSize="sm">
          No live matches right now.
        </Text>
      ) : (
        <Stack gap="2">
          {matches.map((m) => {
            const [a, b] = m.players;
            const mine = !!me && m.players.includes(me);
            return (
              <HStack key={m.matchId} justify="space-between" fontSize="sm">
                <Text>
                  #{m.matchId} <AddressLabel address={a} self={me} color="playerA" /> {m.scores[a] ?? 0} –{" "}
                  {m.scores[b] ?? 0} <AddressLabel address={b} self={me} color="playerB" />
                </Text>
                <Text color="fg.muted">
                  {m.moveCount} moves · {formatCountdown(now - m.startedAt)}
                </Text>
                <ChakraLink asChild color="accent">
                  <Link to={mine ? `/match/${m.matchId}` : `/watch/${m.matchId}`}>{mine ? "Play" : "Watch"}</Link>
                </ChakraLink>
              </HStack>
            );
          })}
        </Stack>
      )}
    </Panel>
  );
}
