/**
 * @dotsweb3/protocol — the wire contract between packages/machine and
 * packages/frontend. See docs/architecture.md §1.
 *
 * Types + pure codecs ONLY. No game rules (bounds, adjacency, turn order,
 * scoring, forfeit eligibility, hashing) — those live in dots-engine. The
 * validators below check *shape* (is this an integer pair?), never legality
 * (is this edge on the board / free / yours to draw?).
 *
 * Zero runtime dependencies; uses only TextEncoder/TextDecoder, which exist
 * in Node >= 11 and every browser.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** `0x`-prefixed hex string. */
export type Hex = `0x${string}`;
/** Lowercase `0x` + 40-hex EOA address. The machine lowercases at ingress. */
export type Address = string;
/** `[x, y]`, x = column, y = row, 0-based. Same as dots-engine `Coord`. */
export type Coord = [number, number];
/** Decimal string of a positive integer assigned sequentially by the machine ("1", "2", …). */
export type MatchId = string;
/** All wire times are integer UNIX SECONDS (never ms). */
export type UnixSeconds = number;

// ---------------------------------------------------------------------------
// Advance inputs (InputBox.addInput payload = utf8(JSON.stringify(action)) as hex)
// ---------------------------------------------------------------------------

export interface JoinQueue { type: "joinQueue" }
export interface LeaveQueue { type: "leaveQueue" }
export interface Move { type: "move"; matchId: MatchId; edge: [Coord, Coord] }
export interface ClaimForfeit { type: "claimForfeit"; matchId: MatchId }
/**
 * Owner-only (F2). Times in unix seconds. Omitted tunables use DEFAULTS.
 * Machine bounds (else INVALID_SESSION): sessionStart < sessionEnd,
 * sessionEnd > now, session ≥ lastMatchCutoff long, gridSize even in [2, 10],
 * turnTimeout in [10, 3600], and sessionStart/sessionEnd < 1e12 (rejects ms).
 */
export interface ScheduleSession {
    type: "scheduleSession";
    sessionStart: UnixSeconds;
    sessionEnd: UnixSeconds;
    gridSize?: number;
    turnTimeout?: number;
}
export type Action = JoinQueue | LeaveQueue | Move | ClaimForfeit | ScheduleSession;
export type ActionType = Action["type"];

/** PRD §11 defaults. Derived constants are always computed from turnTimeout. */
export const DEFAULTS = {
    gridSize: 6,
    turnTimeout: 60,
    /** LAST_MATCH_CUTOFF, seconds before sessionEnd. Not tunable per session. */
    lastMatchCutoff: 15 * 60,
    firstMoveGraceFactor: 2,
    sweepIdleFactor: 10,
} as const;

// ---------------------------------------------------------------------------
// Notices (accepted state changes). Payload = utf8(JSON) as hex.
// ---------------------------------------------------------------------------

/** F6 move record. Engine MoveRecord + machine-supplied timing. */
export interface MoveRecordWire {
    matchId: MatchId;
    moveIndex: number;
    edge: [Coord, Coord];
    submitter: Address;
    squaresClosed: number;
    turnAfter: Address;
    timestamp: UnixSeconds;
}

export interface MatchStartedNotice {
    type: "MatchStarted";
    matchId: MatchId;
    sessionId: number;
    players: [Address, Address];
    firstMover: Address;
    gridSize: number;
    turnTimeout: number;
    /** Resolved deadline for the first move (startedAt + FIRST_MOVE_GRACE). */
    forfeitDeadline: UnixSeconds;
    timestamp: UnixSeconds;
}

export interface MoveNotice extends MoveRecordWire {
    type: "Move";
    /** Resolved deadline for the player on turn after this move; null if the move ended the match. */
    forfeitDeadline: UnixSeconds | null;
}

/** F5. `winner`/`loser` null iff abandoned; `closingMove` null on forfeit/abandoned. */
export interface MatchEndedNotice {
    type: "MatchEnded";
    matchId: MatchId;
    sessionId: number;
    players: [Address, Address];
    winner: Address | null;
    loser: Address | null;
    squares: Record<Address, number>;
    forfeit: boolean;
    zeroMoveForfeit: boolean;
    abandoned: boolean;
    durationSeconds: number;
    longestChain: Record<Address, number>;
    closingMove: MoveRecordWire | null;
    /** keccak256 of the engine's canonical board encoding. null until dots-engine ships it (TODO-engine). */
    finalBoardHash: Hex | null;
    engineVersion: string;
    timestamp: UnixSeconds;
}

export type Notice = MatchStartedNotice | MoveNotice | MatchEndedNotice;

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const REASON_CODES = [
    // envelope (F8)
    "MALFORMED_PAYLOAD",
    "UNKNOWN_ACTION",
    // session (F2)
    "NOT_OWNER",
    "INVALID_SESSION",
    // queue (F1)
    "NO_OPEN_SESSION",
    "PAST_CUTOFF",
    "ALREADY_QUEUED",
    "IN_LIVE_MATCH",
    "NOT_QUEUED",
    // move (F3) + forfeit (F4)
    "NO_SUCH_MATCH",
    "MATCH_ENDED",
    "NOT_A_PLAYER",
    "NOT_YOUR_TURN",
    "OUT_OF_BOUNDS",
    "NOT_ADJACENT",
    "EDGE_TAKEN",
    "NOT_THE_WAITING_PLAYER",
    "DEADLINE_NOT_ELAPSED",
    // engine threw something the adapter could not classify
    "ENGINE_ERROR",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * Exactly one is emitted for every advance the machine declines. Such inputs
 * finish with status **"accept"** (so the node persists this report — it drops
 * reports of REJECTED inputs) but change no state and emit no notices.
 * Exception: `ENGINE_ERROR` (unexpected throw) finishes "reject" so the node
 * rolls the machine back; its report is therefore not persisted.
 * Clients: an ACCEPTED input with a Rejected report = declined.
 */
export interface RejectedReport {
    type: "Rejected";
    /** Parsed action type, or null when the payload could not be decoded. */
    action: ActionType | null;
    /** Present when the decoded action names a match (move, claimForfeit). */
    matchId?: MatchId;
    code: ReasonCode;
    message: string;
}

// ---------------------------------------------------------------------------
// Inspect. Request body = utf8(JSON.stringify(query)); machine answers with
// exactly one report whose payload is an InspectResponse.
// ---------------------------------------------------------------------------

export type InspectQuery =
    | { route: "state"; matchId: MatchId }
    | { route: "state"; player: Address }
    | { route: "queue" }
    | { route: "session" }
    | { route: "history"; matchId: MatchId };
export type InspectRoute = InspectQuery["route"];

export interface MatchView {
    matchId: MatchId;
    sessionId: number;
    gridSize: number;
    turnTimeout: number;
    players: [Address, Address];
    status: "live" | "ended";
    /** Player on turn (meaningless once ended). */
    turn: Address;
    scores: Record<Address, number>;
    longestChain: Record<Address, number>;
    startedAt: UnixSeconds;
    /** Resolved deadline (F9) — null once ended. */
    forfeitDeadline: UnixSeconds | null;
    /** Full F6 log; rebuild the board by feeding it to the engine. */
    moves: MoveRecordWire[];
    ended: MatchEndedNotice | null;
}

export interface MatchSummary {
    matchId: MatchId;
    players: [Address, Address];
    scores: Record<Address, number>;
    moveCount: number;
    turn: Address;
    forfeitDeadline: UnixSeconds;
    startedAt: UnixSeconds;
}

export interface QueueView {
    /** FIFO order; position = index + 1. */
    entries: { address: Address; joinedAt: UnixSeconds }[];
}

export interface SessionConfig {
    sessionId: number;
    sessionStart: UnixSeconds;
    sessionEnd: UnixSeconds;
    /** sessionEnd − LAST_MATCH_CUTOFF: no joins/pairing at or after this. */
    cutoffAt: UnixSeconds;
    gridSize: number;
    turnTimeout: number;
    firstMoveGrace: number;
    sweepIdle: number;
}

export interface SessionView {
    session: SessionConfig | null;
    /** Live matches, ascending numeric matchId. */
    liveMatches: MatchSummary[];
    queueLength: number;
    /** block timestamp of the last processed advance (the machine's "now"); null before any input. */
    machineTime: UnixSeconds | null;
    engineVersion: string;
}

export interface HistoryView {
    matchId: MatchId;
    gridSize: number;
    players: [Address, Address];
    moves: MoveRecordWire[];
    ended: MatchEndedNotice | null;
}

export interface InspectData {
    state: MatchView | null;
    queue: QueueView;
    session: SessionView;
    history: HistoryView | null;
}

export type InspectResponse<R extends InspectRoute = InspectRoute> =
    | { ok: true; route: R; data: InspectData[R] }
    | { ok: false; code: "MALFORMED_PAYLOAD" | "UNKNOWN_ROUTE"; message: string };

// ---------------------------------------------------------------------------
// Codecs
// ---------------------------------------------------------------------------

export class ProtocolError extends Error {
    constructor(public readonly code: "MALFORMED_PAYLOAD" | "UNKNOWN_ACTION" | "UNKNOWN_ROUTE", message: string) {
        super(message);
        this.name = "ProtocolError";
    }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function utf8ToHex(text: string): Hex {
    let hex = "";
    for (const b of encoder.encode(text)) hex += b.toString(16).padStart(2, "0");
    return `0x${hex}`;
}

export function hexToUtf8(hex: string): string {
    const body = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
    if (body.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(body)) {
        throw new ProtocolError("MALFORMED_PAYLOAD", "payload is not valid hex");
    }
    const bytes = new Uint8Array(body.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
    try {
        return decoder.decode(bytes);
    } catch {
        throw new ProtocolError("MALFORMED_PAYLOAD", "payload is not valid utf-8");
    }
}

/** JSON → hex. Callers build objects with a fixed key order, so output bytes are deterministic. */
export function encodeJson(value: unknown): Hex {
    return utf8ToHex(JSON.stringify(value));
}

export function decodeJson(hex: string): unknown {
    const text = hexToUtf8(hex);
    try {
        return JSON.parse(text);
    } catch {
        throw new ProtocolError("MALFORMED_PAYLOAD", "payload is not valid JSON");
    }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const isCoord = (v: unknown): v is Coord => Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]);
const isMatchId = (v: unknown): v is MatchId => typeof v === "string" && /^[1-9][0-9]{0,15}$/.test(v);
const isAddress = (v: unknown): v is Address => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);

function malformed(message: string): never {
    throw new ProtocolError("MALFORMED_PAYLOAD", message);
}

export function encodeAction(action: Action): Hex {
    return encodeJson(action);
}

/**
 * Max decoded size of an advance payload. Larger payloads are declined as
 * MALFORMED_PAYLOAD before any hex/JSON decoding (cheap-griefing guard; the
 * largest real action is < 200 bytes). Applies to advance inputs only — NOT to
 * decodeJson, which also decodes large inspect responses.
 */
export const MAX_ACTION_BYTES = 1024;

/**
 * Hex payload → validated Action (shape only). Throws ProtocolError.
 * Payloads over MAX_ACTION_BYTES are MALFORMED_PAYLOAD (checked first).
 * Returns a fresh object containing only known fields (unknown fields dropped).
 */
export function decodeAction(hex: string): Action {
    const hexDigits = hex.startsWith("0x") || hex.startsWith("0X") ? hex.length - 2 : hex.length;
    if (hexDigits > 2 * MAX_ACTION_BYTES) malformed(`payload exceeds ${MAX_ACTION_BYTES} bytes`);
    const raw = decodeJson(hex);
    if (!isObj(raw) || typeof raw.type !== "string") malformed("expected an object with a string `type`");
    switch (raw.type) {
        case "joinQueue":
        case "leaveQueue":
            return { type: raw.type };
        case "move": {
            if (!isMatchId(raw.matchId)) malformed("move.matchId must be a decimal string");
            const e = raw.edge;
            if (!Array.isArray(e) || e.length !== 2 || !isCoord(e[0]) || !isCoord(e[1])) {
                malformed("move.edge must be [[x,y],[x,y]] with integers");
            }
            return { type: "move", matchId: raw.matchId, edge: [[e[0][0], e[0][1]], [e[1][0], e[1][1]]] };
        }
        case "claimForfeit":
            if (!isMatchId(raw.matchId)) malformed("claimForfeit.matchId must be a decimal string");
            return { type: "claimForfeit", matchId: raw.matchId };
        case "scheduleSession": {
            const { sessionStart, sessionEnd, gridSize, turnTimeout } = raw;
            if (!isInt(sessionStart) || !isInt(sessionEnd)) malformed("sessionStart/sessionEnd must be integer unix seconds");
            if (gridSize !== undefined && !isInt(gridSize)) malformed("gridSize must be an integer");
            if (turnTimeout !== undefined && !isInt(turnTimeout)) malformed("turnTimeout must be an integer (seconds)");
            const out: ScheduleSession = { type: "scheduleSession", sessionStart, sessionEnd };
            if (gridSize !== undefined) out.gridSize = gridSize;
            if (turnTimeout !== undefined) out.turnTimeout = turnTimeout;
            return out;
        }
        default:
            throw new ProtocolError("UNKNOWN_ACTION", `unknown action type: ${String(raw.type).slice(0, 32)}`);
    }
}

export function encodeNotice(notice: Notice): Hex {
    return encodeJson(notice);
}

/** Frontend side. Trusts the machine for field shapes; checks only the discriminant. */
export function decodeNotice(hex: string): Notice {
    const raw = decodeJson(hex);
    if (!isObj(raw) || (raw.type !== "MatchStarted" && raw.type !== "Move" && raw.type !== "MatchEnded")) {
        malformed("not a dotsweb3 notice");
    }
    return raw as unknown as Notice;
}

export function encodeRejected(report: RejectedReport): Hex {
    return encodeJson(report);
}

export function decodeRejected(hex: string): RejectedReport {
    const raw = decodeJson(hex);
    if (!isObj(raw) || raw.type !== "Rejected") malformed("not a Rejected report");
    return raw as unknown as RejectedReport;
}

/** Frontend: body of POST <inspect-url>. */
export function encodeInspectQuery(query: InspectQuery): string {
    return JSON.stringify(query);
}

/**
 * Machine: inspect request payload (hex) → validated query. Throws ProtocolError.
 * If the node delivered a JSON wrapper `{"payload":"0x…"}` instead of the raw
 * body (behaviour differs across node/CLI versions), it is unwrapped once.
 */
export function decodeInspectQuery(hex: string): InspectQuery {
    let raw = decodeJson(hex);
    if (isObj(raw) && typeof raw.payload === "string" && raw.route === undefined) raw = decodeJson(raw.payload);
    if (!isObj(raw) || typeof raw.route !== "string") malformed("expected an object with a string `route`");
    switch (raw.route) {
        case "queue":
        case "session":
            return { route: raw.route };
        case "history":
            if (!isMatchId(raw.matchId)) malformed("history.matchId must be a decimal string");
            return { route: "history", matchId: raw.matchId };
        case "state":
            if (isMatchId(raw.matchId)) return { route: "state", matchId: raw.matchId };
            if (isAddress(raw.player)) return { route: "state", player: raw.player.toLowerCase() };
            return malformed("state needs matchId or player");
        default:
            throw new ProtocolError("UNKNOWN_ROUTE", `unknown inspect route: ${String(raw.route).slice(0, 32)}`);
    }
}

export function encodeInspectResponse(response: InspectResponse): Hex {
    return encodeJson(response);
}

export function decodeInspectResponse<R extends InspectRoute>(hex: string): InspectResponse<R> {
    const raw = decodeJson(hex);
    if (!isObj(raw) || typeof raw.ok !== "boolean") malformed("not an inspect response");
    return raw as unknown as InspectResponse<R>;
}
