import { defineChain, type Chain } from "viem";
import { foundry, optimismSepolia } from "viem/chains";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import type { Config } from "../config";

/** Exactly one chain per build (the Vite mode's VITE_CHAIN_ID). */
export function chainFor(config: Config): Chain {
  const base = config.chainId === optimismSepolia.id ? optimismSepolia : foundry;
  return defineChain({ ...base, rpcUrls: { default: { http: [config.l1RpcUrl] } } });
}

export function createWagmiConfig(config: Config) {
  const chain = chainFor(config);
  return createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: { [chain.id]: http(config.l1RpcUrl) },
  });
}
