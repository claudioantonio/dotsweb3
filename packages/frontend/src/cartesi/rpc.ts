/**
 * Minimal Cartesi Rollups v2 JSON-RPC client (`cartesi_*` methods). Only the
 * fields this app reads are typed. All integers on the wire are 0x-hex strings.
 */

export interface Pagination {
  total_count: number;
  limit: number;
  offset: number;
}
export interface Page<T> {
  data: T[];
  pagination: Pagination;
}

export interface RpcOutput {
  index: string;
  input_index: string;
  raw_data: string;
  /** Notice → `{type, payload}`; vouchers carry more fields. null if the node could not decode. */
  decoded_data: { type: string; payload: string } | null;
}

export interface RpcReport {
  index: string;
  input_index: string;
  raw_data: string;
}

export type InputStatus =
  | "NONE"
  | "ACCEPTED"
  | "REJECTED"
  | "EXCEPTION"
  | "MACHINE_HALTED"
  | "OUTPUTS_LIMIT_EXCEEDED"
  | "CYCLE_LIMIT_EXCEEDED"
  | "TIME_LIMIT_EXCEEDED"
  | "PAYLOAD_LENGTH_LIMIT_EXCEEDED";

export interface RpcInput {
  index: string;
  status: InputStatus;
  /** EvmAdvance; only `sender` is read (lowercased by callers). */
  decoded_data?: { sender: string } | null;
}

export interface RpcApplication {
  name: string;
  enabled: boolean;
  status: string;
  reason?: string;
}

export class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

export const toHexIndex = (n: number): string => `0x${n.toString(16)}`;
export const fromHexIndex = (h: string): number => Number.parseInt(h, 16);

export interface NodeRpc {
  listOutputs(p: { offset: number; limit: number }): Promise<Page<RpcOutput>>;
  /** All of the app's reports, or only one input's when `inputIndex` is given. */
  listReports(p: { inputIndex?: number; offset?: number; limit?: number }): Promise<Page<RpcReport>>;
  /** null if the node does not know the input yet. */
  getInput(inputIndex: number): Promise<RpcInput | null>;
  getApplication(): Promise<RpcApplication>;
}

/** JSON-RPC "resource not found"-style errors the node returns for unknown inputs. */
const NOT_FOUND_CODES = new Set([-32001, -32602]);

export function createNodeRpc(rpcUrl: string, application: string, fetchFn: typeof fetch = fetch): NodeRpc {
  let id = 0;
  async function call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetchFn(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: { application, ...params } }),
    });
    if (!res.ok) throw new RpcError(res.status, `${method}: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (body.error) throw new RpcError(body.error.code, `${method}: ${body.error.message}`);
    return body.result as T;
  }
  /** Single-object getters answer `{result: {data: {...}}}` (node 0.12, verified on devnet); lists don't. */
  async function get<T>(method: string, params: Record<string, unknown>): Promise<T> {
    return (await call<{ data: T }>(method, params)).data;
  }
  return {
    listOutputs: ({ offset, limit }) => call("cartesi_listOutputs", { offset, limit }),
    listReports: ({ inputIndex, offset = 0, limit = 50 }) =>
      call("cartesi_listReports", {
        ...(inputIndex === undefined ? {} : { input_index: toHexIndex(inputIndex) }),
        offset,
        limit,
      }),
    async getInput(inputIndex) {
      try {
        return await get<RpcInput | null>("cartesi_getInput", { input_index: toHexIndex(inputIndex) });
      } catch (err) {
        if (err instanceof RpcError && NOT_FOUND_CODES.has(err.code)) return null;
        throw err;
      }
    },
    getApplication: () => get("cartesi_getApplication", {}),
  };
}
