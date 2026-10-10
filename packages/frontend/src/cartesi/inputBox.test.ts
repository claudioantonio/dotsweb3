import { decodeAction, encodeAction, type Action } from "@dotsweb3/protocol";
import { encodeAbiParameters, encodeEventTopics, numberToHex, type Log } from "viem";
import { describe, expect, it } from "vitest";
import { inputBoxAbi, inputIndexFromLogs } from "./inputBox";

const APP = "0x00000000000000000000000000000000000000aa";

function inputAddedLog(app: string, index: bigint): Log {
  const topics = encodeEventTopics({ abi: inputBoxAbi, eventName: "InputAdded", args: { appContract: app as `0x${string}`, index } });
  return {
    address: "0x1b51e2992a2755ba4d6f7094032df91991a0cfac",
    topics: topics as Log["topics"],
    data: encodeAbiParameters([{ type: "bytes" }], ["0x1234"]),
    blockHash: null, blockNumber: null, logIndex: null, transactionHash: null, transactionIndex: null, removed: false,
  };
}

describe("InputBox helpers", () => {
  it("payload round-trips through the protocol codec", () => {
    const a: Action = { type: "move", matchId: "3", edge: [[0, 0], [1, 0]] };
    expect(decodeAction(encodeAction(a))).toEqual(a);
  });

  it("extracts our app's input index from receipt logs", () => {
    const logs = [inputAddedLog("0x00000000000000000000000000000000000000bb", 1n), inputAddedLog(APP, 42n)];
    expect(inputIndexFromLogs(logs, APP.toUpperCase().replace("0X", "0x"))).toBe(42);
    expect(numberToHex(42)).toBe("0x2a");
  });

  it("throws if the event is missing", () => {
    expect(() => inputIndexFromLogs([], APP)).toThrow(/InputAdded/);
  });
});
