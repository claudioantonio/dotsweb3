import { useBalance, useConnect, useConnection, useConnectors, useDisconnect, useGasPrice, useSwitchChain } from "wagmi";
import { useServices } from "../services";

export type WalletStatus = "DISCONNECTED" | "CONNECTING" | "WRONG_CHAIN" | "CONNECTED";

/** ux-plan §1.2: gas for ~30 txs per match; addInput is ~ 60–120k gas. */
const GAS_PER_TX = 150_000n;
const TXS_PER_MATCH = 30n;

export function useWallet() {
  const { config } = useServices();
  const connection = useConnection();
  const connectors = useConnectors();
  const { mutate: connect, isPending: connecting, error: connectError } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const { mutate: switchChain, isPending: switching } = useSwitchChain();
  const address = connection.address?.toLowerCase() ?? null;
  const onChain = connection.chainId === config.chainId;
  const balance = useBalance({ address: connection.address, chainId: config.chainId, query: { enabled: !!address && onChain } });
  const gasPrice = useGasPrice({ chainId: config.chainId, query: { enabled: !!address && onChain } });

  let status: WalletStatus = "DISCONNECTED";
  if (connection.status === "connecting" || connection.status === "reconnecting" || connecting) status = "CONNECTING";
  else if (connection.status === "connected") status = onChain ? "CONNECTED" : "WRONG_CHAIN";

  const needed = gasPrice.data !== undefined ? gasPrice.data * GAS_PER_TX * TXS_PER_MATCH : null;
  const unfunded = status === "CONNECTED" && balance.data !== undefined && needed !== null && balance.data.value < needed;

  return {
    address,
    status,
    unfunded,
    balance: balance.data,
    refetchBalance: balance.refetch,
    hasInjected: connectors.length > 0,
    connectError,
    connect: () => {
      const c = connectors[0];
      if (c) connect({ connector: c, chainId: config.chainId });
    },
    disconnect: () => disconnect(),
    switching,
    switchChain: () => switchChain({ chainId: config.chainId }),
  };
}
