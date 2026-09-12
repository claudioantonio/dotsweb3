# TODO — engine tasks for v1 (Session #1)

Scope: this package only — the game engine consumed by both the Cartesi Machine
entrypoint and the browser replay. Source of truth: [PRD-v5](docs/PRD-v5.md)
(F-numbers) and its [feasibility assessment](docs/PRD-v5-feasibility-assessment.md).
Tables are ordered by priority; items build on the ones before them.

## 1. Groundwork

|Status| Task | Complexity |
|---|---|---|
|[x]| Establish determinism ground rules as lint/test guards before new code lands: no `Date.now` / `Math.random`, integer-only math, stable iteration order in anything feeding a hash or winner, all timing taken from a `timestamp` parameter (input metadata), same-block ties resolved by input order. | Low |
|[x]| Normalize all addresses to lowercase at every engine ingress (Cartesi supplies lowercase `msg_sender`; wallets supply EIP-55 — mixed casing forks replays). | Low |

## 2. Move log (replaces `playHistory`)

|Status| Task | Complexity |
|---|---|---|
|[x]| Replace `playHistory: Edge[]` with a full move record `{matchId, moveIndex, edge, submitter, squaresClosed, turnAfter, timestamp}` (F6). Design it once: it is simultaneously the per-move notice payload and the replay input. | Medium |

## 3. Turn machine (§6.3–6.4)

|Status| Task | Complexity |
|---|---|---|
| [x] | Strict 1v1 alternation with turn check in move validation (reject out-of-turn with a distinct error). | Low |
| [x] | **Extra move on close**: closing 1–2 squares keeps the turn (resolves the old TODO item — PRD-v5 §6.4 made the decision: adopt it). | Medium |
|[x]| Per-turn chain counter with per-player match maxima for king-of-the-chain (§6). Update the max on every increment, not on turn change — the final move of a match never flips the turn. | Medium |

## 4. Forfeit machine (F4, §6.5)

| Task | Complexity |
|---|---|
| `claimForfeit` resolved lazily against input-metadata timestamps: valid iff `now > forfeitDeadline` and claimant is the waiting player. | Medium |
| `forfeitDeadline` = last move + `TURN_TIMEOUT`; first move of a match gets `FIRST_MOVE_GRACE` (= 2 × `TURN_TIMEOUT`) from the pairing timestamp. | Medium |
| Enumerated rejection reasons: `NO_SUCH_MATCH`, `NOT_A_PLAYER`, `NOT_THE_WAITING_PLAYER`, `DEADLINE_NOT_ELAPSED`. | Low |
| Flag zero-move forfeits (loser never played) in the match result — stat layer excludes them. | Low |
| Rejected inputs must not touch `forfeitDeadline` (no stalling by spamming invalid moves). | Low |

## 5. Match orchestrator (F1–F2, §5) — biggest new piece

| Task | Complexity |
|---|---|
| FIFO matchmaking queue: `joinQueue` / `leaveQueue`, reject double-join and join-while-in-live-match (one live match per address). | High |
| Pair on second join: create match, first joiner moves first, emit `MatchStarted {matchId, players, firstMover, timestamp}`. | Medium |
| Session window state from `scheduleSession {sessionStart, sessionEnd, gridSize?, turnTimeout?}`: joins only inside the window and before `sessionEnd − LAST_MATCH_CUTOFF`; pairing halts at cutoff; live matches always play to completion. | Medium |
| Abandoned sweep on `scheduleSession`: close only matches idle > `SWEEP_IDLE` (= 10 × `TURN_TIMEOUT`) as `abandoned` (winner null), clear stale queue entries — never touch an active match. | High |
| Multiple concurrent match instances: `matchId → match` map; all constants (`gridSize`, `turnTimeout`) per session, not global. | High |

## 6. Match result (F5)

| Task | Complexity |
|---|---|
| `MatchEnded` payload: `{matchId, sessionId, players, winner, loser, squares, forfeit, zeroMoveForfeit, abandoned, durationSeconds, longestChain: {both players' maxima}, closingMove, finalBoardHash, engineVersion}`. | Medium |
| Explicit nullability: `winner`/`loser` null iff `abandoned`; `closingMove` null on forfeit and abandoned endings. | Low |
| In-engine tie-break for per-match `longestChain` when both players share the max (earliest achieved, per the F7 rule applied per match). | Low |
| Win condition: all 25 squares claimed → higher count wins (odd square count ⇒ no ties), or win by forfeit. | Low |

## 7. Board hash + replay verification (§11, F13's engine half)

| Task | Complexity |
|---|---|
| Canonical board encoding: fixed edge ordering derived from coordinates, square owners by id — never `JSON.stringify` of the live object graph (Squares share Edge instances). | Medium |
| `finalBoardHash` = keccak256 over the canonical encoding, via `@noble/hashes` or viem — pure JS, byte-identical in machine and browser; no `node:crypto`, nothing WASM-optional. | Low |
| Stamp `engineVersion` (package version) into `MatchEnded`. | Low |
| Export a headless verify API: `replay(moveLog) → finalBoardHash` so any consumer can check a match from its history alone. | Medium |

## 8. Test suite

| Task | Complexity |
|---|---|
| Turn/extra-move/chain paths, exhaustively (this is where replay bugs live). | Medium |
| Forfeit races: late move vs. claim in same block (input-order resolution) and adjacent blocks; claim by wrong party; claim before deadline; first-move grace. | High |
| Queue edge cases: leave then re-join, pair ordering, cutoff behavior, sweep criterion (idle vs. active overtime match), one-live-match lock. | High |
| Determinism proof: run a full generated match log through `replay()` twice (fresh instances) → identical `finalBoardHash`; property-style tests over random valid logs. | Medium |
| Table-driven winner/forfeit/abandoned result tests (the old `getWinner()` tie quirks must not survive the rewrite). | Low |

## 9. Packaging

| Task | Complexity |
|---|---|
| Dual ESM+CJS build (`exports` map with `import`/`require` conditions; currently CJS-only) — required before the browser replay consumes the package. | Medium |
| No Node-only imports, no DOM imports anywhere in the engine. | Low |
| Publish; the Cartesi Machine entrypoint and the frontend must consume the identical locked version — never a copied source tree. | Low |

## Done

- [x] Remove `console.log` from `Grid.createSquares` ([src/Grid.ts](src/Grid.ts):42,49) — the engine runs inside the Cartesi Machine, per input.
- [x] Fix the order-dependent early `break` in `getAvailableSquaresbyId` ([src/Grid.ts](src/Grid.ts):200) — it silently depends on `relatedSquareId` being ascending.
- [x] **Signal when a move targets an already-drawn edge** — `play` now throws (commit `ac4a433`).
- [x] ~~Decide whether to adopt extra-turn-on-close~~ — decided by PRD-v5 §6.4: adopted; implementation tracked above.

