import type { MatchSummary } from "@dotsweb3/protocol";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useSessionView } from "../queries";
import { useNoticeSnapshot } from "../services";
import { liveListFrom } from "../state/liveList";
import { useTx } from "../tx";
import { useWallet } from "../wallet/useWallet";

/** session().liveMatches kept live by the notice stream. */
export function useLiveList(): MatchSummary[] {
  const session = useSessionView();
  const { notices } = useNoticeSnapshot();
  return useMemo(() => liveListFrom(session.data?.liveMatches ?? [], notices), [session.data, notices]);
}

/** joinQueue → /queue on acceptance. */
export function useJoinQueue() {
  const tx = useTx();
  const w = useWallet();
  const navigate = useNavigate();
  return {
    pending: tx.current?.action.type === "joinQueue",
    disabled: !!tx.current || !w.address || w.status !== "CONNECTED",
    join: async () => {
      if (!w.address) return;
      const outcome = await tx.submit({ type: "joinQueue" }, w.address);
      if (outcome?.status === "APPLIED") navigate("/queue");
    },
  };
}
