import { encodeAction, type Action } from "@dotsweb3/protocol";
import { parseEventLogs, type Hash } from "viem";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { Config as WagmiConfig } from "wagmi";

/** The one function and one event of Cartesi's InputBox we need. */
export const inputBoxAbi = [
  {
    type: "function",
    name: "addInput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "appContract", type: "address" },
      { name: "payload", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "event",
    name: "InputAdded",
    inputs: [
      { name: "appContract", type: "address", indexed: true },
      { name: "index", type: "uint256", indexed: true },
      { name: "input", type: "bytes", indexed: false },
    ],
  },
] as const;

export interface SentInput {
  txHash: Hash;
  inputIndex: number;
}

export interface SendHooks {
  /** Called once the wallet signed and the tx is broadcast. */
  onSubmitted?: (txHash: Hash) => void;
}

/** addInput(app, encodeAction(a)) → receipt → InputAdded.index (F8). */
export async function sendAction(
  wagmi: WagmiConfig,
  addrs: { inputBox: `0x${string}`; app: `0x${string}` },
  action: Action,
  hooks: SendHooks = {},
): Promise<SentInput> {
  const txHash = await writeContract(wagmi, {
    address: addrs.inputBox,
    abi: inputBoxAbi,
    functionName: "addInput",
    args: [addrs.app, encodeAction(action)],
  });
  hooks.onSubmitted?.(txHash);
  const receipt = await waitForTransactionReceipt(wagmi, { hash: txHash });
  if (receipt.status !== "success") throw new Error("addInput transaction reverted");
  return { txHash, inputIndex: inputIndexFromLogs(receipt.logs, addrs.app) };
}

/** Pure: find our app's InputAdded event in a receipt's logs. */
export function inputIndexFromLogs(logs: Parameters<typeof parseEventLogs>[0]["logs"], app: string): number {
  const events = parseEventLogs({ abi: inputBoxAbi, eventName: "InputAdded", logs });
  const ours = events.find((e) => e.args.appContract.toLowerCase() === app.toLowerCase());
  if (!ours) throw new Error("InputAdded event not found in receipt");
  return Number(ours.args.index);
}
