import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "./config";

const good = {
  VITE_CHAIN_ID: "31337",
  VITE_L1_RPC_URL: "http://localhost:8545",
  VITE_APP_ADDRESS: "0xAB00000000000000000000000000000000000001",
  VITE_INPUT_BOX_ADDRESS: "0x1b51e2992A2755Ba4D6F7094032DF91991a0Cfac",
  VITE_NODE_RPC_URL: "/rpc",
  VITE_INSPECT_URL: "http://localhost:6751/inspect/dotsweb3",
};

describe("parseConfig", () => {
  it("parses and lowercases addresses", () => {
    const c = parseConfig(good);
    expect(c.chainId).toBe(31337);
    expect(c.appAddress).toBe("0xab00000000000000000000000000000000000001");
    expect(c.nodeRpcUrl).toBe("/rpc");
  });

  it("reports every problem at once", () => {
    try {
      parseConfig({ ...good, VITE_CHAIN_ID: "1", VITE_APP_ADDRESS: "0x12", VITE_INSPECT_URL: undefined });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).problems).toHaveLength(3);
    }
  });
});
