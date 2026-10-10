import type { Address } from "@dotsweb3/protocol";

/** Typed, validated view of `import.meta.env` (see .env.example). */
export interface Config {
  chainId: number;
  l1RpcUrl: string;
  appAddress: Address;
  inputBoxAddress: Address;
  nodeRpcUrl: string;
  inspectUrl: string;
  /** Optional owner-authored one-liner shown under the header (ux-plan "status banner"). */
  statusBanner: string | null;
}

export const SUPPORTED_CHAIN_IDS = [31337, 11155420] as const;

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid frontend config: ${problems.join("; ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// Absolute http(s) URL, or a path served by the dev proxy.
const URL_RE = /^(https?:\/\/[^\s]+|\/[^\s]*)$/;

/** Pure: parse an env record. Throws ConfigError listing every problem at once. */
export function parseConfig(env: Record<string, string | boolean | undefined>): Config {
  const problems: string[] = [];
  const str = (key: string): string => {
    const v = env[key];
    if (typeof v !== "string" || v.trim() === "") {
      problems.push(`${key} is missing`);
      return "";
    }
    return v.trim();
  };
  const url = (key: string): string => {
    const v = str(key);
    if (v && !URL_RE.test(v)) problems.push(`${key} must be an http(s) URL or an absolute path`);
    return v;
  };
  const address = (key: string): Address => {
    const v = str(key);
    if (v && !ADDRESS_RE.test(v)) problems.push(`${key} must be a 0x-prefixed 20-byte address`);
    return v.toLowerCase();
  };

  const chainRaw = str("VITE_CHAIN_ID");
  const chainId = Number(chainRaw);
  if (chainRaw && !(SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId)) {
    problems.push(`VITE_CHAIN_ID must be one of ${SUPPORTED_CHAIN_IDS.join(", ")}`);
  }

  const config: Config = {
    chainId,
    l1RpcUrl: url("VITE_L1_RPC_URL"),
    appAddress: address("VITE_APP_ADDRESS"),
    inputBoxAddress: address("VITE_INPUT_BOX_ADDRESS"),
    nodeRpcUrl: url("VITE_NODE_RPC_URL"),
    inspectUrl: url("VITE_INSPECT_URL"),
    statusBanner: typeof env.VITE_STATUS_BANNER === "string" && env.VITE_STATUS_BANNER.trim() ? env.VITE_STATUS_BANNER.trim() : null,
  };
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}

let cached: Config | undefined;

/** The app config. Throws ConfigError if the Vite mode's env file is missing/incomplete. */
export function getConfig(): Config {
  cached ??= parseConfig(import.meta.env);
  return cached;
}
