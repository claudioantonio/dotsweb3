# TODO — implementation roadmap (Session #1)

Scope: this repo (`packages/machine` + `packages/frontend`). Product spec:
[PRD-v5](./PRD-v5.md) (F-numbers). Architecture: [context](./context.md).

Game **rules** (turns, scoring, hashes, forfeit *eligibility*) live in
[`dots-engine`](https://github.com/claudioantonio/dots-engine) — implement
them there, then bump the pin here. Do not copy or reimplement engine source.

```
wallet tx  →  InputBox.addInput (OP Sepolia)
           →  Cartesi node
           →  machine advance_state  (dots-engine + session/queue/forfeit)
           →  notices / reports

frontend reads  →  inspect (F9) + node GraphQL/JSON notices
replay (F13)    →  same locked dots-engine version as the machine
```

Stack: Cartesi Rollups SDK v2, React, Chakra UI. Phases are ordered; later
ones assume earlier ones.

## Already here

- [x] Monorepo workspaces (`@dotsweb3/machine`, `@dotsweb3/frontend`)
- [x] Machine `/finish` advance/inspect loop (Rollups 2.0 shapes:
      `block_timestamp` in ms, inspect has no metadata)
- [x] Determinism lint on the machine package

## Engine gate (dots-engine, not this repo)

Machine routing and browser replay need a pin that already has: move log
(F6), turn machine + extra-move-on-close, forfeit/session APIs the wrapper
will call, `MatchEnded` + `finalBoardHash` + `replay()`, dual ESM+CJS.
Track that work in the engine repo. Until it ships, phases 2–3 can stub
against the current pin; phases 5–6 cannot ship.

Keep `machine` and `frontend` on the **identical** engine version.

---

## Phase 0 — Walking skeleton (SDK v2)

Prove InputBox → node → machine → notice on OP Sepolia before building
game state. Launch prerequisite: node confirmation depth near-`latest`
(a `finalized` setting would add minutes per move). Measure p95
input→notice latency; `TURN_TIMEOUT` (~60s) is validated against that
number (tunable later via F2).

| # | Status | Task | F | Complexity |
|---|---|---|---|---|
| 1 | [x] | Cartesi CLI / SDK v2 app wiring so `packages/machine` builds and runs inside the machine (`cartesi build` / `cartesi run`) | — | Medium |
| 2 | [ ] | Deploy the skeleton application on OP Sepolia; record InputBox + app contract addresses | — | Medium |
| 3 | [~] | Echo path: signed `addInput` → `advance_state` → notice/report visible from the node API | — | Medium |
| 4 | [ ] | Measure input→notice latency and confirmation depth; write the numbers down for timeout tuning | — | Low |

## Phase 1 — Machine wrapper (F8)

Route payloads, tag sender, map engine throws to Cartesi reject + report.
All timing from `metadata.block_timestamp` (convert ms as needed).
Addresses lowercased at ingress. Same-block order = `input_index`.

| # | Status | Task | F | Complexity |
|---|---|---|---|---|
| 5 | [x] | Decode hex payload; dispatch `joinQueue` / `leaveQueue` / move / `claimForfeit` / `scheduleSession` | F8 | Medium |
| 6 | [x] | `msg_sender` + `block_timestamp` + `input_index` plumbed into every handler | F8 | Low |
| 7 | [x] | Declined inputs (incl. engine throws) → machine-readable `Rejected` **report** (reason codes F3/F4) with `/finish` status per [architecture §1.4](./architecture.md) (accept, no state change; `reject` only for `ENGINE_ERROR`) | F3, F8 | Medium |
| 8 | [x] | Notices for accepted state changes (`MatchStarted`, per-move F6, `MatchEnded`) | F1, F5, F6 | Medium |
| 9 | [x] | Rejected inputs do not mutate session/queue/match state (no deadline stall via spam) | F4 | Low |

## Phase 2 — Session, queue, matches (F1–F2, F5–F6)

Orchestration in the machine; board/turn/hash via `dots-engine`.

| # | Status | Task | F | Complexity |
|---|---|---|---|---|
| 10 | [x] | `scheduleSession {sessionStart, sessionEnd, gridSize?, turnTimeout?}` from owner; per-session constants, not globals | F2 | Medium |
| 11 | [x] | FIFO `joinQueue` / `leaveQueue`; reject double-join and join-while-in-live-match | F1 | High |
| 12 | [x] | Pair on second join; first joiner moves first; emit `MatchStarted {matchId, players, firstMover, timestamp}` | F1 | Medium |
| 13 | [x] | Cutoff: no new matches after `sessionEnd − LAST_MATCH_CUTOFF`; live matches always finish | F1, §5.3 | Medium |
| 14 | [x] | `matchId → match` map; concurrent boards | F1 | High |
| 15 | [x] | Apply moves through the engine; emit F6 notice = move log record | F3, F6 | Medium |
| 16 | [x] | `claimForfeit` against metadata time; `FIRST_MOVE_GRACE` / `TURN_TIMEOUT`; F4 reason codes | F4 | Medium |
| 17 | [x] | On `scheduleSession`, sweep only matches idle > `SWEEP_IDLE` as abandoned; clear stale queue; never touch an active match | F2 | High |
| 18 | [~] | Emit `MatchEnded` with explicit nullability, both chain maxima, `finalBoardHash`, `engineVersion` | F5 | Medium |

## Phase 3 — Inspect (F9)

Read-only; inspect has **no** metadata. Prefer GraphQL/JSON notices for
deltas; inspect for current board/queue/session.

| # | Status | Task | F | Complexity |
|---|---|---|---|---|
| 19 | [x] | `state(matchId?)` — board, turn, **resolved** forfeit deadline (not the raw constant) | F9 | Medium |
| 20 | [x] | `queue()` — positions | F9 | Low |
| 21 | [x] | `session()` — window, cutoff, live match list | F9 | Medium |
| 22 | [x] | `history(matchId)` — F6 records for replay | F9 | Medium |

## Phase 4 — Frontend shell (React + Chakra)

No game screens yet; wallet can send the same payloads the machine already
accepts.

| # | Status | Task | F | Complexity |
|---|---|---|---|---|
| 23 | [x] | Vite + React + Chakra UI app in `packages/frontend` (replace the placeholder) | — | Medium |
| 24 | [ ] | Wallet connect (wagmi/viem) on OP Sepolia; `InputBox.addInput` helper | F8 | Medium |
| 25 | [ ] | Node clients: inspect HTTP + notice polling (cursor-based, ~2–3s; GraphQL has no subscriptions) | §11 | Medium |
| 26 | [x] | Pin `dots-engine` to the **same** version as `packages/machine` | F13 | Low |

## Phase 5 — Playable match (F10–F12)

Launch blockers for actually playing.

| # | Status | Task | F | Complexity |
|---|---|---|---|---|
| 27 | [ ] | Queue: join / leave / position; auto-redirect on `MatchStarted` | F11 | Medium |
| 28 | [ ] | Board: edges, owned squares, score, turn, opponent address/ENS | F10 | High |
| 29 | [ ] | Forfeit countdown from inspect’s resolved deadline; prominent **Claim forfeit** when it elapses | F10 | Medium |
| 30 | [ ] | Submit move: optimistic pending badge by `moveIndex`; disable while own tx pending (nonce) | F12 | Medium |
| 31 | [ ] | Rejection UX: receipt input index → rejection report; forfeit-race copy (“move arrived after the claim”) | F12 | High |
| 32 | [ ] | Post-match result screen + re-queue | F11 | Low |

## Phase 6 — Lobby, pre-commit, replay (F13–F15)

| # | Status | Task | F | Complexity |
|---|---|---|---|---|
| 33 | [ ] | Lobby: countdown, live-status banner, last session stat sheet + replay links | F14 | Medium |
| 34 | [ ] | During session: live match list (spectate via notice stream) | F14 | Medium |
| 35 | [ ] | Pre-commit sign-up, tally, slot poll (Supabase-class; F15) | F15 | Medium |
| 36 | [ ] | Wallet-readiness: faucet link + “send one test input” ✓ | F15, §12 | Medium |
| 37 | [ ] | Thin replay: load `history` → engine `replay()` → auto-play → **hash matches on-chain ✓** (no scrubber) | F13 | Medium |
| 38 | [ ] | Off-chain session stat script from F5/F6 notices (F7 tie-breaks: fastest win earliest; king of the chain earliest then lowest address) | F7 | Medium |

## Phase 7 — Dry run, then Session #1

| # | Status | Task | F | Complexity |
|---|---|---|---|---|
| 39 | [ ] | Node hosting workstream named and running for a session window | §11 | Medium |
| 40 | [ ] | Dry-run with ~5 wallets: hosting, inspect contention, GraphQL lag | §7 | High |
| 41 | [ ] | Retune `TURN_TIMEOUT` / grid via F2 if p95 latency disagrees with ~60s | §11 | Low |
| 42 | [ ] | Go/no-go: ≥16 pre-commits 24h out; Session #1 | §5.6 | — |

F13 must exist before Session #1 — it is how the primary metric (zero
hash divergence) is measured.

---

## Out of this roadmap (PRD non-goals / V6+)

No money, AA/gasless, Discord, brackets, rematch/challenge links, replay
scrubber, mainnet, mobile-first, NFT. See PRD §9 and §15.
