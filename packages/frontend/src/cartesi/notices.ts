import { decodeNotice, type Notice } from "@dotsweb3/protocol";
import type { NodeRpc } from "./rpc";

export const POLL_INTERVAL_MS = 2500;
export const PAGE_LIMIT = 50;

export interface PollResult {
  notices: Notice[];
  /** Next offset into the app's global output list. */
  cursor: number;
}

/**
 * Pure step of the notice poller: read every output from `cursor` to the end
 * (paginating), decode dotsweb3 notices, skip anything else (vouchers,
 * foreign payloads). The cursor advances past skipped outputs too, so a bad
 * output never wedges the stream.
 */
export async function pollOnce(rpc: Pick<NodeRpc, "listOutputs">, cursor: number, limit = PAGE_LIMIT): Promise<PollResult> {
  const notices: Notice[] = [];
  let offset = cursor;
  for (;;) {
    const page = await rpc.listOutputs({ offset, limit });
    for (const out of page.data) {
      const payload = out.decoded_data?.payload;
      if (!payload) continue;
      try {
        notices.push(decodeNotice(payload));
      } catch {
        // not a dotsweb3 notice
      }
    }
    offset += page.data.length;
    if (page.data.length === 0 || offset >= page.pagination.total_count) break;
  }
  return { notices, cursor: offset };
}

/** Where the live stream starts: the current end of the output list (history comes from inspect). */
export async function tailCursor(rpc: Pick<NodeRpc, "listOutputs">): Promise<number> {
  const page = await rpc.listOutputs({ offset: 0, limit: 1 });
  return page.pagination.total_count;
}

export interface NoticeStoreSnapshot {
  /** Every notice seen since the app started, in node order. */
  notices: readonly Notice[];
  /** Wall-clock ms of the last successful poll; null before the first. */
  lastOkAt: number | null;
  lastError: string | null;
}

/**
 * The ONE app-wide notice stream (architecture §3). A tiny external store
 * consumed with useSyncExternalStore — no state library.
 */
export class NoticeStore {
  private snapshot: NoticeStoreSnapshot = { notices: [], lastOkAt: null, lastError: null };
  private readonly listeners = new Set<() => void>();
  private cursor: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private readonly rpc: Pick<NodeRpc, "listOutputs">;
  private readonly now: () => number;

  constructor(rpc: Pick<NodeRpc, "listOutputs">, now: () => number = Date.now) {
    this.rpc = rpc;
    this.now = now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): NoticeStoreSnapshot => this.snapshot;

  /** One poll; exposed for tests. */
  async tick(): Promise<void> {
    try {
      if (this.cursor === null) this.cursor = await tailCursor(this.rpc);
      const { notices, cursor } = await pollOnce(this.rpc, this.cursor);
      this.cursor = cursor;
      this.set({
        notices: notices.length ? [...this.snapshot.notices, ...notices] : this.snapshot.notices,
        lastOkAt: this.now(),
        lastError: null,
      });
    } catch (err) {
      this.set({ ...this.snapshot, lastError: err instanceof Error ? err.message : String(err) });
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      await this.tick();
      if (this.running) this.timer = setTimeout(loop, POLL_INTERVAL_MS);
    };
    void loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private set(next: NoticeStoreSnapshot) {
    this.snapshot = next;
    for (const l of this.listeners) l();
  }
}
