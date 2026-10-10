import type { Address, MatchEndedNotice, MatchId, MoveRecordWire, SessionConfig } from "@dotsweb3/protocol";
import type { EngineMatch } from "./engine-adapter";

export interface QueueEntry {
    address: Address;
    joinedAt: number;
}

export interface Match {
    id: MatchId;
    sessionId: number;
    players: [Address, Address];
    /** Snapshotted from the session at pairing; never read from a global. */
    gridSize: number;
    turnTimeout: number;
    startedAt: number;
    lastMoveAt: number | null;
    game: EngineMatch;
    moves: MoveRecordWire[];
    ended: MatchEndedNotice | null;
}

/** The whole machine state. In memory only; the machine snapshot is the store. */
export interface State {
    session: SessionConfig | null;
    nextSessionId: number;
    nextMatchId: number;
    /** FIFO. */
    queue: QueueEntry[];
    /** Insertion order = ascending matchId. Ended matches are kept for history. */
    matches: Map<MatchId, Match>;
    liveByPlayer: Map<Address, MatchId>;
    /** Time of the last *accepted* advance. */
    machineTime: number | null;
}

/** Per-input context, built once from metadata in app.ts. */
export interface Ctx {
    /** msg_sender, lowercased. */
    sender: Address;
    /** timeOf(meta): integer unix seconds. */
    now: number;
    inputIndex: number;
}

export function initialState(): State {
    return {
        session: null,
        nextSessionId: 1,
        nextMatchId: 1,
        queue: [],
        matches: new Map(),
        liveByPlayer: new Map(),
        machineTime: null,
    };
}
