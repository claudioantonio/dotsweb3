import type { Action } from "@dotsweb3/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { BaseError, UserRejectedRequestError, type Hash } from "viem";
import { sendAction } from "./cartesi/inputBox";
import { AwaitTimeout, awaitInput, type InputOutcome } from "./cartesi/inputStatus";
import { ENGINE_ERROR_COPY, rejectionCopy } from "./copy/rejections";
import { qk } from "./queries";
import { useServices } from "./services";
import { toaster } from "./ui/toaster";

export type TxStage = "wallet" | "mining" | "processing";

export interface TxState {
  action: Action;
  stage: TxStage;
  txHash?: Hash;
  inputIndex?: number;
}

interface TxApi {
  /** The one in-flight input (submit is locked while set — one nonce at a time). */
  current: TxState | null;
  /** Send an advance input and wait for the machine's verdict. null = never reached the machine. */
  submit(action: Action, me: string): Promise<InputOutcome | null>;
}

const TxContext = createContext<TxApi | null>(null);

function isUserRejection(err: unknown): boolean {
  return err instanceof BaseError && err.walk((e) => e instanceof UserRejectedRequestError) !== null;
}

const ACCEPTED_TOAST: Partial<Record<Action["type"], string>> = {
  joinQueue: "You're in the queue",
  leaveQueue: "You left the queue",
  claimForfeit: "Forfeit claimed",
};

export function TxProvider({ children }: { children: ReactNode }) {
  const { config, rpc, wagmi, inspect } = useServices();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [current, setCurrent] = useState<TxState | null>(null);
  const busy = useRef(false);

  const submit = useCallback(
    async (action: Action, me: string): Promise<InputOutcome | null> => {
      if (busy.current) return null;
      busy.current = true;
      setCurrent({ action, stage: "wallet" });
      try {
        const { inputIndex, txHash } = await sendAction(
          wagmi,
          { inputBox: config.inputBoxAddress as `0x${string}`, app: config.appAddress as `0x${string}` },
          action,
          { onSubmitted: (hash) => setCurrent({ action, stage: "mining", txHash: hash }) },
        );
        setCurrent({ action, stage: "processing", txHash, inputIndex });
        const outcome = await awaitInput(rpc, inputIndex);

        if (outcome.status === "APPLIED") {
          const msg = ACCEPTED_TOAST[action.type];
          if (msg) toaster.create({ type: "success", title: msg });
        } else if (outcome.status === "DECLINED") {
          const copy = rejectionCopy(outcome.report);
          const goToLiveMatch = async () => {
            const view = await inspect({ route: "state", player: me });
            if (view) navigate(`/match/${view.matchId}`);
          };
          toaster.create({
            type: "error",
            title: copy.title,
            description: copy.description,
            action:
              copy.link === "liveMatch"
                ? { label: "Go to match", onClick: () => void goToLiveMatch() }
                : copy.link === "lobby"
                  ? { label: "Lobby", onClick: () => navigate("/") }
                  : undefined,
          });
        } else if (outcome.status === "ENGINE_ERROR") {
          toaster.create({ type: "error", title: ENGINE_ERROR_COPY.title, description: ENGINE_ERROR_COPY.description });
        } else {
          toaster.create({
            type: "error",
            title: "The machine could not process this input",
            description: `Node status ${outcome.nodeStatus}. Nothing changed — try again.`,
          });
        }
        // Inputs change queue/session/player state; refresh the inspect snapshots.
        void queryClient.invalidateQueries({ queryKey: qk.queue });
        void queryClient.invalidateQueries({ queryKey: qk.session });
        void queryClient.invalidateQueries({ queryKey: qk.player(me.toLowerCase()) });
        return outcome;
      } catch (err) {
        if (isUserRejection(err)) {
          toaster.create({ type: "info", title: "Transaction cancelled" });
        } else if (err instanceof AwaitTimeout) {
          toaster.create({
            type: "warning",
            title: "Still processing",
            description: "Your input is on-chain but the node hasn't processed it yet. The board will update when it does.",
          });
        } else {
          const message = err instanceof BaseError ? err.shortMessage : err instanceof Error ? err.message : String(err);
          toaster.create({ type: "error", title: "Transaction failed", description: message });
        }
        return null;
      } finally {
        busy.current = false;
        setCurrent(null);
      }
    },
    [config, inspect, navigate, queryClient, rpc, wagmi],
  );

  const value = useMemo(() => ({ current, submit }), [current, submit]);
  return <TxContext.Provider value={value}>{children}</TxContext.Provider>;
}

export function useTx(): TxApi {
  const t = useContext(TxContext);
  if (!t) throw new Error("useTx outside TxProvider");
  return t;
}

export const STAGE_LABEL: Record<TxStage, string> = {
  wallet: "Confirm in your wallet…",
  mining: "Waiting for the transaction…",
  processing: "Waiting for the machine…",
};
