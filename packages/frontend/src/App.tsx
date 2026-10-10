import { Alert, Box, Container, Dialog, Portal, Text } from "@chakra-ui/react";
import type { MatchStartedNotice } from "@dotsweb3/protocol";
import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, Route, Routes, useNavigate } from "react-router";
import { useHealth } from "./queries";
import { ConnectModalProvider } from "./screens/ConnectModal";
import { Lobby } from "./screens/Lobby";
import { MatchScreen } from "./screens/Match";
import { Practice } from "./screens/Practice";
import { Queue } from "./screens/Queue";
import { Replay } from "./screens/Replay";
import { Result } from "./screens/Result";
import { useNoticeSnapshot, useServices } from "./services";
import { addressText } from "./ui/common";
import { Header } from "./ui/Header";
import { Toaster } from "./ui/toaster";
import { useWallet } from "./wallet/useWallet";

const PAIRED_REDIRECT_MS = 3000;

/** Auto-navigation (ux-plan §2): MatchStarted with my address → interstitial → /match/:id. */
function PairingWatcher() {
  const { address: me } = useWallet();
  const { notices } = useNoticeSnapshot();
  const navigate = useNavigate();
  const seen = useRef(notices.length);
  const [paired, setPaired] = useState<MatchStartedNotice | null>(null);

  useEffect(() => {
    const fresh = notices.slice(seen.current);
    seen.current = notices.length;
    if (!me) return;
    const mine = fresh.find((n): n is MatchStartedNotice => n.type === "MatchStarted" && n.players.some((p) => p.toLowerCase() === me));
    if (mine) setPaired(mine);
  }, [notices, me]);

  useEffect(() => {
    if (!paired) return;
    const t = setTimeout(() => {
      navigate(`/match/${paired.matchId}`);
      setPaired(null);
    }, PAIRED_REDIRECT_MS);
    return () => clearTimeout(t);
  }, [paired, navigate]);

  if (!paired || !me) return null;
  const opponent = paired.players.find((p) => p.toLowerCase() !== me) ?? paired.players[1];
  const first = paired.firstMover.toLowerCase() === me;
  return (
    <Dialog.Root open placement="center" onOpenChange={(e) => !e.open && setPaired(null)}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="surface.raised" p="6">
            <Dialog.Title fontSize="2xl">Paired!</Dialog.Title>
            <Text mt="2">
              vs {addressText(opponent)} — you move {first ? "first" : "second"}. Board opens…
            </Text>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

function Layout() {
  const { config } = useServices();
  const health = useHealth();
  return (
    <ConnectModalProvider>
      <Box minH="100vh">
        <Header />
        {config.statusBanner && (
          <Box bg="surface.overlay" px="6" py="2" fontSize="sm">
            {config.statusBanner}
          </Box>
        )}
        {!health.ok && (
          <Alert.Root status="warning" borderRadius="0">
            <Alert.Indicator />
            <Alert.Title>
              Node unreachable ({health.reason}) — moves may not confirm; countdowns may be stale.
            </Alert.Title>
          </Alert.Root>
        )}
        <Container maxW="6xl" py="8">
          <Outlet />
        </Container>
        <PairingWatcher />
        <Toaster />
      </Box>
    </ConnectModalProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Lobby />} />
        <Route path="queue" element={<Queue />} />
        <Route path="match/:matchId" element={<MatchScreen />} />
        <Route path="match/:matchId/result" element={<Result />} />
        <Route path="watch/:matchId" element={<MatchScreen spectate />} />
        <Route path="replay/:matchId" element={<Replay />} />
        <Route path="practice" element={<Practice />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
