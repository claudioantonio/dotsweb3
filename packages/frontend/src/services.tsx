import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { Config as WagmiConfig } from "wagmi";
import type { Config } from "./config";
import type { Inspect } from "./cartesi/inspect";
import type { NoticeStore, NoticeStoreSnapshot } from "./cartesi/notices";
import type { NodeRpc } from "./cartesi/rpc";

/** App-wide singletons, built once in main.tsx. */
export interface Services {
  config: Config;
  rpc: NodeRpc;
  inspect: Inspect;
  notices: NoticeStore;
  wagmi: WagmiConfig;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ value, children }: { value: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error("useServices outside ServicesProvider");
  return s;
}

export function useNoticeSnapshot(): NoticeStoreSnapshot {
  const { notices } = useServices();
  return useSyncExternalStore(notices.subscribe, notices.getSnapshot);
}
