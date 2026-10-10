# Architecture — build round 1 (machine + frontend in parallel)

Companion to [PRD-v5](./PRD-v5.md) (F-numbers), [TODO](./TODO.md) (task #s),
[ux-plan](./ux-plan.md) (screens S1–S9). Goal: the smallest design that
satisfies the PRD, stable under replay. If this doc and the code disagree,
`packages/protocol/src/index.ts` wins for the wire contract; fix the doc.

```
wallet ─ InputBox.addInput(app, encodeAction(a)) ─▶ node ─▶ machine.advance ─▶ notices | Rejected report (status accept)
frontend ◀─ JSON-RPC cartesi_listOutputs / listReports / getInput (polled) ◀─┘
frontend ─ POST /inspect/<app> body=JSON query ─▶ machine.inspect ─▶ 1 report = InspectResponse
```

Note: Rollups v2 nodes expose **JSON-RPC** (`cartesi_*`), not GraphQL. Where
TODO/PRD say "GraphQL notices", read "JSON-RPC `cartesi_listOutputs`".

## 1. Wire contract

**Home: `packages/protocol` (`@dotsweb3/protocol`)** — one file of types +
pure JSON↔hex codecs, zero runtime deps, dual CJS (machine) / ESM
(frontend) build. Chosen over duplicated types because the contract has ~15
shapes and two implementers working blind; duplication guarantees drift
that only shows up on devnet. It holds **no rules**: validators check shape
(integer pair, decimal matchId), never legality (bounds, adjacency, turn) —
that is dots-engine's job. Workspace order in the root `package.json` builds
protocol first. Owner of changes: backend dev; any change updates §1 here.

### 1.1 Encoding

- **Advance payload** = `utf8(JSON.stringify(action))` as `0x` hex
  (`encodeAction` / `decodeAction`). No version field; protocol and both
  apps ship from one commit. Payloads over **1 KiB** (decoded,
  `MAX_ACTION_BYTES`) are declined `MALFORMED_PAYLOAD` before any JSON
  parse (griefing guard; checked in `decodeAction` only — `decodeJson` stays
  uncapped for large inspect responses).
- **Notices and reports** = `utf8(JSON)` as hex (`encodeNotice`,
  `encodeRejected`, `encodeInspectResponse`). The machine builds every
  output object with a fixed literal key order → deterministic bytes.
- **Time on the wire is always integer unix seconds.** The machine converts
  `metadata.block_timestamp` in exactly one function (`timeOf(meta)`). The
  machine README says Rollups 2.0 delivers ms; JSON-RPC `EvmAdvance` shows
  seconds. **Settled on local devnet (cartesi CLI 2.0.0-alpha.35, node
  0.12.0-alpha.41): seconds** (raw `block_timestamp=1791623120`). `timeOf`
  still divides values ≥ 1e12 by 1000 as a guard — nothing else in the
  codebase may touch the raw field.
- **Addresses** lowercased at ingress (machine: `msg_sender`, owner
  constant, inspect `player`). Frontend lowercases before comparing.
- **Inspect**: `POST <inspectUrl>` with body `JSON.stringify(query)`
  (`encodeInspectQuery`). The machine receives it hex-encoded as the inspect
  payload; `decodeInspectQuery` also unwraps a `{"payload":"0x…"}` wrapper
  in case a CLI/node version wraps the body. The node returns
  `{ reports: [{ payload: Hex }], … }`; the machine always emits **exactly
  one** report → `decodeInspectResponse(reports[0].payload)`.

### 1.2 Actions (advance inputs)

```ts
type Action =
  | { type: "joinQueue" }                                       // F1
  | { type: "leaveQueue" }                                      // F1
  | { type: "move"; matchId: MatchId; edge: [Coord, Coord] }    // F3
  | { type: "claimForfeit"; matchId: MatchId }                  // F4
  | { type: "scheduleSession"; sessionStart: UnixSeconds;       // F2, owner only
      sessionEnd: UnixSeconds; gridSize?: number; turnTimeout?: number };
type MatchId = string;   // "1","2",… sequential, assigned by the machine
type Coord = [number, number]; // [x=col, y=row], same as dots-engine
```

Defaults (`DEFAULTS`): gridSize 6, turnTimeout 60 s, lastMatchCutoff 900 s,
FIRST_MOVE_GRACE = 2 × turnTimeout, SWEEP_IDLE = 10 × turnTimeout.
`scheduleSession` bounds (else `INVALID_SESSION`): turnTimeout ∈ [10, 3600],
gridSize even ∈ [2, 10], `sessionStart`/`sessionEnd` < 1e12 (ms passed by
mistake), plus the ordering rules in §2.

### 1.3 Notices (accepted inputs only)

```ts
interface MoveRecordWire {            // F6 = engine MoveRecord + timestamp
  matchId; moveIndex: number; edge: [Coord, Coord]; submitter: Address;
  squaresClosed: number; turnAfter: Address; timestamp: UnixSeconds }
type Notice =
  | { type: "MatchStarted"; matchId; sessionId: number; players: [Address, Address];
      firstMover: Address; gridSize: number; turnTimeout: number;
      forfeitDeadline: UnixSeconds; timestamp: UnixSeconds }
  | (MoveRecordWire & { type: "Move"; forfeitDeadline: UnixSeconds | null }) // null if move ended match
  | { type: "MatchEnded"; matchId; sessionId: number; players: [Address, Address];
      winner: Address | null; loser: Address | null;        // null iff abandoned
      squares: Record<Address, number>; forfeit: boolean; zeroMoveForfeit: boolean;
      abandoned: boolean; durationSeconds: number;
      longestChain: Record<Address, number>;                // both players' maxima
      closingMove: MoveRecordWire | null;                   // null on forfeit/abandoned
      finalBoardHash: Hex | null;                           // null until TODO-engine
      engineVersion: string; timestamp: UnixSeconds };
```

One input can emit several notices, in this order: `MatchStarted` (pairing);
`Move` then `MatchEnded` (final move); `MatchEnded` ×N (sweep, ascending
matchId). Deadlines in notices are **resolved** values, so the frontend never
recomputes a timeout rule.

### 1.4 Rejections (F3/F4/F8)

**Declined inputs finish `/finish {status:"accept"}`**, emit exactly one
`Rejected` report and **nothing else** (no notices), and change **no state**
(`machineTime` included). Why: on Rollups v2 (verified on node
0.12.0-alpha.41) the node does not persist reports of REJECTED inputs —
`cartesi_listReports` never returns them — so status "reject" would hide the
reason from every client. Accepting is safe because handlers validate before
mutating: every `Reject`/`ProtocolError` is thrown before any write.

The one exception is **`ENGINE_ERROR`** (an unexpected throw, or an engine
error the adapter cannot classify): we cannot prove nothing was mutated, so it
finishes `reject` and the node rolls the machine back to its pre-input state.
Its report is lost (by the finding above); clients see input status
`REJECTED` with no report and show a generic error.

Client rule: input `ACCEPTED` + a `Rejected` report for that `input_index` ⇒
declined (show `code`); `ACCEPTED` without one ⇒ applied; `REJECTED` ⇒
engine error.

```ts
interface RejectedReport { type: "Rejected"; action: ActionType | null;
  matchId?: MatchId;   // present iff the decoded action names a match (move, claimForfeit)
  code: ReasonCode; message: string }
type ReasonCode =
  | "MALFORMED_PAYLOAD" | "UNKNOWN_ACTION"                                   // envelope
  | "NOT_OWNER" | "INVALID_SESSION"                                        // scheduleSession
  | "NO_OPEN_SESSION" | "PAST_CUTOFF" | "ALREADY_QUEUED" | "IN_LIVE_MATCH" | "NOT_QUEUED" // queue
  | "NO_SUCH_MATCH" | "MATCH_ENDED" | "NOT_A_PLAYER"                       // move + claim
  | "NOT_YOUR_TURN" | "OUT_OF_BOUNDS" | "NOT_ADJACENT" | "EDGE_TAKEN"     // move (engine)
  | "NOT_THE_WAITING_PLAYER" | "DEADLINE_NOT_ELAPSED"                      // claimForfeit
  | "ENGINE_ERROR";                                                        // unclassified throw → status reject
```

`matchId` lets any client (not only the sender's tab) attribute a declined
move/claim to its match by listing reports.

`MATCH_ENDED` (vs `NO_SUCH_MATCH`) is what lets the frontend render the
forfeit race (F12): my `move` rejected `MATCH_ENDED` + that match's
`MatchEnded{forfeit, loser: me}` → "your move arrived after the forfeit claim".

### 1.5 Inspect routes (F9) — read-only

| Query | `data` |
|---|---|
| `{route:"state", matchId}` / `{route:"state", player}` | `MatchView \| null` (player → their live match, else null) |
| `{route:"queue"}` | `QueueView { entries: {address, joinedAt}[] }` FIFO |
| `{route:"session"}` | `SessionView { session: SessionConfig \| null, liveMatches: MatchSummary[], queueLength, machineTime, engineVersion }` |
| `{route:"history", matchId}` | `HistoryView { matchId, gridSize, players, moves: MoveRecordWire[], ended } \| null` |

`MatchView` = ids, gridSize, turnTimeout, players, `status: "live"|"ended"`,
turn, scores, longestChain, startedAt, **resolved** `forfeitDeadline`
(null when ended), full `moves`, `ended`. `SessionConfig` carries
`cutoffAt`, `firstMoveGrace`, `sweepIdle` precomputed. `machineTime` = last
advance timestamp, the frontend's anchor for clock skew. Response envelope:
`{ok:true, route, data} | {ok:false, code:"MALFORMED_PAYLOAD"|"UNKNOWN_ROUTE", message}`.
Board rendering: the frontend rebuilds a `Dots` from `moves` via the engine
(§4) — the machine never serializes engine internals.

## 2. Machine (`packages/machine`)

```
src/index.ts          finish loop only: POST /finish, dispatch, POST outputs it is handed. No logic.
src/rollup.ts         tiny fetch client: finish(status), notice(hex), report(hex)
src/app.ts            createApp(cfg) → { advance(meta, payloadHex): Result, inspect(payloadHex): Hex }
                      Result = { status: "accept"|"reject"; notices: Hex[]; reports: Hex[]; applied: boolean }
src/router.ts         decodeAction → handler; Reject → Rejected report + status accept, no state change; other throw → ENGINE_ERROR + status reject
src/state.ts          State type + initialState(); the only mutable thing
src/session.ts        scheduleSession (owner check, validation, sweep, queue clear)
src/queue.ts          joinQueue / leaveQueue / pairing → creates Match
src/match.ts          move, claimForfeit, endMatch() → MatchEnded builder
src/inspect.ts        decodeInspectQuery → read-only views (takes Readonly<State>)
src/engine-adapter.ts the ONLY importer of dots-engine (§4)
src/reject.ts         class Reject { code: ReasonCode }
```

`app.ts` returns outputs instead of POSTing them: handlers are pure
`(state, ctx, action) → outputs`, which is what makes them testable without a
rollup server. Config: `{ owner: Address }`, read once in `index.ts` from
`DOTS_OWNER` (baked into the machine image's Dockerfile `ENV`, lowercased).

**State model** (in memory, no persistence — the machine snapshot is the store):

```ts
interface State {
  session: SessionConfig | null;      // current/last scheduled session
  nextSessionId: number; nextMatchId: number;
  queue: { address: Address; joinedAt: number }[];   // FIFO array; ≤1 entry in practice
  matches: Map<MatchId, Match>;       // insertion = matchId order; ended matches kept for history
  liveByPlayer: Map<Address, MatchId>;
  machineTime: number | null;
}
interface Match { id; sessionId; players: [Address, Address]; gridSize; turnTimeout;
  startedAt; lastMoveAt: number | null; game: EngineMatch /* adapter handle */;
  moves: MoveRecordWire[]; ended: MatchEndedNotice | null }
```

Matches snapshot `gridSize`/`turnTimeout` at pairing (per-session, never
global). Rules of orchestration (all from PRD §5–6):

- `ctx = { sender: msg_sender.toLowerCase(), now: timeOf(meta), inputIndex }` built once per input; `machineTime = now` set only when the action is applied (not on a declined input, even though it finishes accept).
- join: needs session with `sessionStart ≤ now < cutoffAt`; not queued; not in `liveByPlayer`. Queue reaching 2 → pair `[queue[0], queue[1]]`, first joiner moves first.
- deadline = `lastMoveAt === null ? startedAt + 2·T : lastMoveAt + T` (helper in adapter, §4). Moves after the deadline are still accepted until someone claims.
- claim: match live; sender ∈ players; sender ≠ turn (`NOT_THE_WAITING_PLAYER`); `now > deadline` (strict). zeroMoveForfeit = loser has no move in `moves`.
- scheduleSession: owner only; `sessionStart < sessionEnd`, `sessionEnd > now`, `cutoffAt ≥ sessionStart`, gridSize even ∈ [2, 10] (odd square count ⇒ no ties; `MatchEnded` has no draw shape), 10 ≤ turnTimeout ≤ 3600, sessionStart/sessionEnd < 1e12 → else `INVALID_SESSION`. Then sweep live matches with `now − (lastMoveAt ?? startedAt) > 10·T` as abandoned (ascending matchId); clear the queue if there was no previous session or `now ≥` its `cutoffAt`; replace `session`.
- Queued players stranded at cutoff stay queued (harmless, can `leaveQueue`) until the next sweep.

**Validate-then-mutate.** Each handler computes everything (including the
engine call) before writing state; a `Reject` thrown at any point leaves
state untouched (F4/task 9). The engine move is the one exception that
mutates the engine object on success — it is called last, and if it throws
it has not mutated (engine contract; covered by a test).

**Determinism rules (concrete)**
1. Time only from `timeOf(meta)`; never `Date`, `performance`, timers. Lint enforces `Date.now`.
2. No `Math.random`, `crypto.randomUUID`, `prev_randao`. IDs are counters.
3. Iterate arrays or `Map`s only (insertion order = input order). No `for…in` (lint), no `Object.keys` on records keyed by addresses; build those records from `players` order.
4. No `localeCompare`/`Intl`; sort with `<` on numbers (`Number(matchId)`).
5. Integer math only; `durationSeconds = endedAt − startedAt`.
6. Output objects are literals with fixed key order; never stringify the engine object or a `Map`.
7. Inspect takes `Readonly<State>` and never writes, not even `machineTime`.
8. Never crash the loop: the router catches everything; an uncaught throw halts the app.

## 3. Frontend (`packages/frontend`)

Stack: Vite + React 19 + Chakra v3 (existing), **wagmi + viem +
@tanstack/react-query**, **react-router** (deep links `/match/:id` are a
requirement). No `@cartesi/wagmi` for now — one ABI function, one event, and
three JSON-RPC methods don't justify an alpha dependency.

```
src/config.ts            parse/validate import.meta.env once → typed Config (throws on missing)
src/wallet/              wagmi config (injected connector; chain from config), useWallet()
src/cartesi/inputBox.ts  sendAction(a) → addInput(app, encodeAction(a)) → receipt → InputAdded.index
src/cartesi/rpc.ts       jsonRpc(): listOutputs({offset,limit}), listReports({input_index}), getInput(i), getApplication()
src/cartesi/inspect.ts   inspect<R>(query) → InspectData[R]
src/cartesi/notices.ts   ONE app-wide poller: cursor=offset, every 2.5 s, decodeNotice, push to store
src/cartesi/inputStatus.ts awaitInput(index) → applied | declined(report) | engine error  (classification per §1.4)
src/state/               pure reducers: notices → per-match view; player phase (IDLE/QUEUED/IN_MATCH/…);
                         session phase (NONE/SCHEDULED/OPEN/CUTOFF/ENDED) from SessionView + now
src/copy/rejections.ts   ReasonCode → user copy (ux-plan §4); forfeit-race detection
src/engine-adapter.ts    the ONLY importer of dots-engine (§4)
src/board/               DotGrid (existing; takes a Dots) + pending-edge overlay
src/screens/             Lobby(S1) ConnectModal(S2) Queue(S3) Match(S4) Result(S5) Spectate(S6) Replay(S7)
src/App.tsx              router + global chrome (header, phase pill, health banner, toasts)
```

Data flow per ux-plan §6: inspect on navigation/recovery (and every 10 s on
`/queue` only); everything live comes from the notice store. Pending move =
`{matchId, moveIndex: moves.length, edge}` cleared when a `Move` notice with
that `moveIndex` arrives or `awaitInput` returns declined / engine error. Submit disabled
while own tx/input pending. Claim-forfeit button shows when
`machineTime-adjusted now > forfeitDeadline + 2 s`.

**Environments** (Vite modes, `.env.<mode>`; only `.env.example` is committed):

| var | `devnet` (`cartesi run`) | `opsepolia` (later) |
|---|---|---|
| `VITE_CHAIN_ID` | 31337 | 11155420 |
| `VITE_L1_RPC_URL` | http://localhost:8545 | provider URL |
| `VITE_APP_ADDRESS` / `VITE_INPUT_BOX_ADDRESS` | from `cartesi address-book` | from deploy (task 2) |
| `VITE_NODE_RPC_URL` | `http://localhost:<port>/rpc` | node URL |
| `VITE_INSPECT_URL` | `http://localhost:<port>/inspect/<app>` | node URL |

`npm run dev -w @dotsweb3/frontend -- --mode devnet`. If the node lacks CORS,
add a Vite `server.proxy` for `/rpc` and `/inspect` in devnet mode only.
Devnet wallets: Anvil default accounts imported into two browser profiles.

## 4. Engine gap list (dots-engine 0.1.0-alpha.0)

Exports today: `Dots` (turn machine, extra-move-on-close, `scores`,
`longestChain`, `moveLog: MoveRecord[]`, `play()`, `isOVer()`, `getWinner()`),
`GameConstants`, types. Each package has **one** `src/engine-adapter.ts`, the
only file importing `dots-engine`; every stub is marked `// TODO-engine:`.
When the engine ships the feature, the adapter body shrinks — callers don't change.

| Gap | Needed by | Seam until engine ships it |
|---|---|---|
| Typed error codes (engine throws plain `Error` strings) | F3 reason codes | adapter `classify(err)`: message-prefix map → `NOT_YOUR_TURN` ("Not this player's turn"), `OUT_OF_BOUNDS` ("Invalid … out of bounds"), `NOT_ADJACENT` ("Dots must be adjacent"), `EDGE_TAKEN` ("Edge already drawn"), `MATCH_ENDED` ("Game is over"), else `ENGINE_ERROR`. A test pins every mapping so an engine bump that changes text fails loudly. |
| `finalBoardHash` / canonical encoding | F5, F13 | `boardHash(): null`. **Not** invented here. MatchEnded carries `null`; replay screen shows "hash check unavailable (engine pending)". |
| `ENGINE_VERSION` export | F5, F13 skew check | adapter constant `"0.1.0-alpha.0"`; a test reads `node_modules/dots-engine/package.json` and asserts equality. |
| `replay(log)` | F13, board rebuild | frontend `rebuild(gridSize, players, matchId, moves)`: `new Dots(...)` then `play()` per record, asserting each result's `squaresClosed`/`turnAfter` equals the record (divergence → "divergence at move k"). This calls the engine, it does not reimplement it. |
| Forfeit deadline / eligibility helpers (engine is time-free) | F4 | machine adapter `forfeitDeadline(m)` and `checkClaim(m, sender, now)` — 10 lines total, flagged as an engine candidate. Frontend never computes deadlines (uses resolved values). |
| Dual ESM+CJS packaging | frontend import | none needed now: Vite pre-bundles the CJS package (already works). |
| `normalizePlayerId` not exported | ingress | machine lowercases itself; engine normalizes internally anyway. |
| Abandon/forfeit-ended state on `Dots` | F5 | the machine owns `ended`; the engine object is simply no longer called. |

Never patch or copy engine source; never write hashing here. Engine bumps
change both packages' pin in one commit.

## 5. Scope split for this round

**Backend (packages/machine + packages/protocol):** 1, 3 (echo on local
`cartesi run` only, incl. the timestamp-unit check), 5, 6, 7, 8, 9, 10, 11,
12, 13, 14, 15, 16, 17, 18 (with `finalBoardHash: null`), 19, 20, 21, 22.

**Frontend (packages/frontend):** 24 (wagmi on devnet; OP Sepolia chain
config present but untested), 25, 27, 28, 29, 30, 31, 32, 33 (countdown,
banners, live list only — no stat sheet), 34, 37 (rebuild + auto-play; hash
check stubbed until engine). Until the machine lands, develop against
fixtures built from protocol types (`src/state/__fixtures__`).

**Out of scope:** 2, 4 (OP Sepolia deploy and latency), 35, 36 (F15 /
Supabase / faucet readiness), 38 (stat script), 39–42 (Phase 7), any real
wallet keys or mainnet, any dots-engine change, S8/S9 screens.

### Testing strategy

Machine — **jest** (existing). Map `@dotsweb3/protocol` to its `src` in
`jest.config.js` (`moduleNameMapper`) so tests need no prior build.
- Handler tests through `createApp` only: helper `adv(app, sender, t, action)` returns `Result`; assert status, decoded notices, decoded report code. Use `gridSize: 2` (4 edges, 1 square) for full play-throughs.
- Required scenarios: every `ReasonCode` reachable path; rejected input ⇒ `inspect(session/state/queue)` byte-identical before/after; pairing + first mover; extra move on close; forfeit race both orders (move-then-claim, claim-then-move → `MATCH_ENDED`); grace on move 0; `now == deadline` rejects, `+1` accepts; zero-move forfeit; cutoff boundary; sweep spares a match idle exactly `10·T`; overtime match past `sessionEnd` keeps playing; same-timestamp inputs resolve in call order.
- Determinism: replay the same 50-input script into two fresh apps → identical output hex arrays.
- Adapter: error-message mapping pinned; `ENGINE_VERSION` equals installed version.
- One smoke test of `index.ts` against a ~30-line fake rollup server (`node:http`) serving scripted requests and recording `/finish` statuses and outputs.

Frontend — **vitest** (add; `environment: "jsdom"` only for the few component tests).
- Pure modules first: state reducers from notice sequences, session-phase calculator at each boundary, rejection-copy + forfeit-race detection, notice poller cursor/pagination (mocked `fetch`), `awaitInput`, config validation, `rebuild()` divergence detection.
- Components: Match screen renders my-turn / their-turn / opponent-timed-out / pending badge from fixtures.
- Manual devnet checklist (owner `scheduleSession` via `cast send`, two Anvil accounts play a 2×2 match end-to-end, a forfeit, a rejected move) — the tester's acceptance run.

## 6. Do not build

- A generic event bus, plugin router, DI container, or "repository" layer over a `Map`.
- Persistence/DB in the machine, or snapshots/migrations of `State`.
- Payload versioning, protobuf/ABI encoding, schema libraries (zod etc.) — hand validators in protocol suffice.
- A frontend global-state library (Redux/Zustand) — React context + react-query + one notice store.
- WebSocket/SSE layers, a caching proxy for inspect, or GraphQL clients (polling is the model; proxy only if the dry run proves it).
- Hashing, canonical encoding, replay, or any rule check in this repo (engine's job — use the adapter stubs).
- Retry/backoff frameworks; a fixed 2.5 s poll with "stale" banner is the spec.
- Multi-chain/env abstraction beyond the env table; account abstraction; ENS beyond truncation (resolve later if cheap).
- Session/queue features the PRD rejects: rematch, private matches, ratings, cross-session stats on-chain.
