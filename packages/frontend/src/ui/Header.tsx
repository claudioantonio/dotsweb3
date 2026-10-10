import { Badge, Box, Button, HStack, Link as ChakraLink, Text } from "@chakra-ui/react";
import { Link } from "react-router";
import { useNow, useSessionView } from "../queries";
import { useConnectModal } from "../screens/ConnectModal";
import { sessionPhase, type SessionPhase } from "../state/session";
import { useWallet } from "../wallet/useWallet";
import { Countdown, shortAddress } from "./common";

const PILL: Record<SessionPhase, { label: string; palette: string }> = {
  NONE: { label: "No session", palette: "gray" },
  SCHEDULED: { label: "Next session in", palette: "blue" },
  OPEN: { label: "Live · pairing closes in", palette: "green" },
  CUTOFF: { label: "Starts closed · ends in", palette: "orange" },
  ENDED: { label: "Session ended", palette: "gray" },
};

export function PhasePill() {
  const session = useSessionView();
  const now = useNow();
  if (!session.data) return <Badge>{session.isError ? "Session unknown" : "…"}</Badge>;
  const { phase, target } = sessionPhase(session.data.session, now);
  const p = PILL[phase];
  return (
    <Badge colorPalette={p.palette} size="lg" variant="surface">
      {p.label}
      {target !== null && <Countdown target={target} now={now} />}
    </Badge>
  );
}

export function Header() {
  const w = useWallet();
  const openConnect = useConnectModal();
  return (
    <HStack as="header" justify="space-between" px="6" py="3" borderBottomWidth="1px" borderColor="surface.overlay">
      <HStack gap="4">
        <ChakraLink asChild fontWeight="bold" fontSize="xl" _hover={{ textDecoration: "none" }}>
          <Link to="/">Dots</Link>
        </ChakraLink>
        <PhasePill />
      </HStack>
      <HStack gap="3">
        <ChakraLink asChild fontSize="sm" color="fg.muted">
          <Link to="/practice">Practice</Link>
        </ChakraLink>
        {w.address ? (
          <HStack gap="2">
            <Box w="2" h="2" borderRadius="full" bg={w.status === "CONNECTED" ? "success" : "warning"} />
            <Text fontFamily="mono" fontSize="sm" title={w.address}>
              {shortAddress(w.address)}
            </Text>
            {(w.status === "WRONG_CHAIN" || w.unfunded) && (
              <Button size="xs" colorPalette="orange" variant="subtle" onClick={openConnect}>
                {w.status === "WRONG_CHAIN" ? "Wrong network" : "Low balance"}
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={w.disconnect}>
              Disconnect
            </Button>
          </HStack>
        ) : (
          <Button size="sm" colorPalette="cyan" loading={w.status === "CONNECTING"} onClick={openConnect}>
            Connect
          </Button>
        )}
      </HStack>
    </HStack>
  );
}
