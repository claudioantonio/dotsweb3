import { Button, CloseButton, Dialog, Portal, Stack, Text } from "@chakra-ui/react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { formatEther } from "viem";
import { useServices } from "../services";
import { useWallet } from "../wallet/useWallet";

/** S2 — Connect wallet modal (connect / wrong chain / unfunded). */
const Ctx = createContext<() => void>(() => {});
export const useConnectModal = () => useContext(Ctx);

export function ConnectModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <ConnectModal open={open} onClose={() => setOpen(false)} />
    </Ctx.Provider>
  );
}

function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { config } = useServices();
  const w = useWallet();
  const chainName = config.chainId === 31337 ? "the local devnet (Anvil)" : "OP Sepolia";
  const ready = w.status === "CONNECTED" && !w.unfunded;

  useEffect(() => {
    if (open && ready) onClose();
  }, [open, ready, onClose]);

  let body: ReactNode;
  if (w.status === "WRONG_CHAIN") {
    body = (
      <Stack gap="3">
        <Text>Your wallet is on another network. Dots runs on {chainName}.</Text>
        <Button colorPalette="cyan" loading={w.switching} onClick={w.switchChain}>
          Switch network
        </Button>
      </Stack>
    );
  } else if (w.status === "CONNECTED" && w.unfunded) {
    body = (
      <Stack gap="3">
        <Text>
          Balance: {w.balance ? Number(formatEther(w.balance.value)).toFixed(5) : "?"} ETH. You need gas for ~30
          transactions per match.
        </Text>
        <Text color="fg.muted" fontSize="sm">
          Testnet ETH only — no real money. Use a faucet, then re-check.
        </Text>
        <Button variant="outline" onClick={() => void w.refetchBalance()}>
          Re-check
        </Button>
      </Stack>
    );
  } else {
    body = (
      <Stack gap="3">
        <Text>
          Every move is a transaction on {chainName}. It's a testnet: no money involved.
        </Text>
        {!w.hasInjected && (
          <Text color="warning" fontSize="sm">
            No browser wallet detected. Install one (e.g. MetaMask) and reload.
          </Text>
        )}
        {w.connectError && (
          <Text color="danger" fontSize="sm">
            {w.connectError.message.split("\n")[0]}
          </Text>
        )}
        <Button colorPalette="cyan" disabled={!w.hasInjected} loading={w.status === "CONNECTING"} onClick={w.connect}>
          Connect wallet
        </Button>
      </Stack>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()} placement="center">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="surface.raised">
            <Dialog.Header>
              <Dialog.Title>
                {w.status === "WRONG_CHAIN" ? "Wrong network" : w.unfunded ? "Fund your wallet" : "Connect wallet"}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body pb="6">{body}</Dialog.Body>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
