# Feasibility & Implementation-Risk Assessment — PRD-v5 (1v1 Sessions)

**Type:** Technical assessment (companion to [PRD-v5](./PRD-v5.md))
**Author:** Senior developer review (Ethereum dapps / Cartesi) — fresh pass, independent of the [v4 assessment](./PRD-v4-feasibility-assessment.md)
**Date:** 2026-07-05  **Repo baseline:** commit `ac4a433` (clean)

> **Status of findings (updated 2026-07-05):** **H1–H4 and M1–M6 are resolved** — folded into PRD-v5 the same day: `MatchStarted` notice (F1/§5.2), `leaveQueue` + `FIRST_MOVE_GRACE` + zero-move-forfeit stat exclusion (§5.2/§6.5/§8), `SWEEP_IDLE` criterion protecting live matches (§6.5/F2), `TURN_TIMEOUT`-vs-p95-latency validation (§11), tie-break division of labor (F7/§11), F5 nullability + dual `longestChain` maxima, F4 reason codes, queue-at-cutoff handling (§5.3), forfeit-race UX copy (F12), and the "Claim forfeit" button (F10). N3 (sandbagging) added to §13's observation list. **Still open:** B2 (node confirmation depth — week-1 launch prerequisite), M7 (dual ESM+CJS packaging — code work, correctly specced), N2 (code nits in `src/Grid.ts`).

**Bottom line:** feasible, and structurally *simpler* than v4 — 1v1 deletes every team-coordination mechanism and replaces it with a queue + forfeit machine that is smaller, more testable, and deterministic at its core. The v4 assessment's Cartesi findings were folded into v5 §7/§11 almost entirely correctly (verification table below). The new risk mass sits in three places the PRD underspecifies: **pairing/queue lifecycle notices, the abandoned-match sweep trigger, and the first-move clock**. Budget is essentially unchanged: **≈ 8–10 person-weeks** to Session #1.

---

## 1. Verification: were the v4 findings folded in correctly?

| v4 finding | v5 status |
|---|---|
| B1 base chain | ✅ OP Sepolia in §11, cadence numbers redone for 6×6 |
| B2 confirmation depth | ✅ Carried as launch prerequisite (§7 build order + §11). **Note: more acute in v5** — see H3 below |
| H1 rejection reports + input-index correlation | ✅ F3 (reports), F8 (reason codes), F12 (receipt→input-index→report correlation) — fully folded |
| H2 determinism kit | ✅ §11 verbatim-plus: lowercase in-engine (F3), canonical encoding + keccak via viem/noble (F5), `engineVersion` in `MatchEnded` checked by F13 |
| H3 node hosting | ✅ §11 "named workstream," exercised in dry run |
| H4 inspect contention | ✅ §11 concurrency profile (GraphQL deltas, caching proxy). **But v5 reintroduces the problem via a missing notice — H1 below** |
| M1 move log ≠ `playHistory: Edge[]` | ✅ F6: log = notice payload = replay input |
| M2 F2 missing `gridSize` | ✅ F2 now `{sessionStart, sessionEnd, gridSize?, turnTimeout?}` |
| M3 tie-breaks | ⚠️ Partially. F7 defines them, but §11 says "all tie-breaks (F7) deterministic **and in-engine**" while F7 says aggregates are "derived **off-chain**" — stale contradiction. Also F5's per-match `longestChain: {addr: n}` is singular with no per-match tie-break specified (both players can share the max chain); that one genuinely must be in-engine (M2 below) |
| M4 web2 backend | ✅ Promoted to F15, explicitly in launch scope |
| M5 dual ESM+CJS | ✅ In §11. Work still outstanding: `package.json` is CJS-only (`exports` map has only `types`/`default`, no `import` condition) |
| N1 same-block ordering | ✅ F4 states input-index resolution. The companion UX-copy note ("moved in time, timestamped late") was **lost in the fold** — and matters more now, because in v5 that case is a *forfeit loss*, not a harmless reclaim (M5 below) |
| N2 code nits | ➖ Not folded (fair for a PRD) but still live in code: `console.log` in `Grid.createSquares` (`src/Grid.ts:42,49` — noise inside the machine) and the fragile early-`break` in `getAvailableSquaresbyId` (`src/Grid.ts:200`) |
| N3 resolved deadline in inspect | ✅ F9 |
| N4 grid math | ✅ Redone correctly for 6×6: 36 dots, 2·6·5 = 60 edges, 25 squares, odd ⇒ no ties given the all-squares-claimed win condition; §4's ≥600-input target = 10 × 60 accepted moves, internally consistent |

## 2. Gap analysis: current engine vs. v5 requirements

Current engine (`src/Dots.ts`, ~550 LOC total): one turn-less free-for-all board, per-address scores, throw-on-invalid, `playHistory: Edge[]`. No turns (removed per `TODO.md`), no time, no matches/queue/sessions, no forfeit, no hashing, no Cartesi code. Substrate is right: time-free, RNG-free, integer-only, tuple moves. `GameConstants.GRID_SIZE` is already 6.

| v5 area | Reuse | Effort | Notes |
|---|---|---|---|
| Grid geometry, edge dedup, square-close (`Grid.ts`) | ~90% | Low | Keep as-is; N2 cleanups. 60 edges → O(n²) scans irrelevant |
| Move validation (`buildEdge`, `isEdgeDrawn`, already-drawn throw) | ~90% | Low | Already-drawn now throws (`ac4a433`); missing: turn check, match-membership, live-match check. `TODO.md` item 2 is done but not checked off — stale |
| Turn machine + extra-move-on-close + per-turn chain tracking (§6.3–6.4) | 0% | Medium-low | `TODO.md` item 1 confirms extra-move was never built. Chain counter: sum `squaresClosed` over consecutive same-player moves; **update the per-player max on every increment, not on turn change** (final move of a match never flips the turn) |
| Forfeit claims (F4/§6.5) | 0% | Low code, **Medium test burden** | Pseudocode is sound (see §3). Needs `timestamp` plumbed into every entry point |
| **Queue + multi-match orchestration (F1, §5)** | 0% | **Medium-high — biggest structural piece** | Net-new `MatchManager`: FIFO queue, pair-on-second-join, `matchId → Match(Dots)` map, `address → liveMatchId` lock, session window + cutoff gate, abandoned sweep. Nothing in the repo orchestrates more than one `Dots` |
| Move log + F5/F6 notices | ~10% | Medium-low | Replace `playHistory: Edge[]` with the full move record (F6 fields); it doubles as the replay input |
| `finalBoardHash` + canonical encoding | 0% | Low but delicate | Adds first runtime dep (`@noble/hashes`/viem). Never hash the live object graph (Squares share Edge instances) |
| Winner logic | rewrite, trivial | Low | 1v1 makes it `scores[A] vs scores[B]` or forfeit — simpler than v4's per-team rewrite. Current `getWinner()`'s tie quirks die with it |
| Cartesi wrapper (F8–F9), frontend (F10–F14), F15 backend | 0% | as v4 | Unchanged shape |

**Net: still ~30% reuse / ~70% new in the engine layer** — the team code v5 deletes was never written, so nothing is saved there; what changed is that the new code is a queue/orchestrator instead of a team system, at roughly equal cost.

## 3. Forfeit state machine: correctness analysis (§6, F4)

**The core race is resolved correctly and deterministically.** Late-but-valid move from A vs. `claimForfeit` from B, same or adjacent blocks, input-index order:

- **Move lands first:** `lastMoveTime` updates. If turn flipped to B, B's claim fails `P == other(turn)` (B *is* turn). If A closed a square and kept the turn, B's claim fails the elapsed check (`now − lastMoveTime ≈ 0`). Rejected cleanly in both branches. ✓
- **Claim lands first:** match ends, winner B; A's move rejects as "no such live match" (F3). ✓
- On-turn player can never claim against the waiting opponent (`P == other(turn)`); third parties excluded. ✓
- Rejected moves roll back and do **not** reset `lastMoveTime` — no stalling by spamming invalid moves. ✓
- Same-block: shared timestamp, index order decides — F4 states this; the state machine is purely order-driven. ✓ Timestamps on OP Sepolia are monotonic non-decreasing; strict `>` is fine.

**No exploit found in the machine itself.** The exploitable surface is around it — see H2/H4, M4, and the sandbagging note (N3).

## 4. Prioritized findings

### Blockers

None new. **B2 (node input confirmation depth) carries over unresolved** — correctly staged as a week-1 launch prerequisite in §7/§11, but do not let it slip: see H3.

### High

- **H1. No `MatchStarted` / pairing notice is specified — F5/F6 only cover moves and match end.** F11's auto-redirect ("when paired") and F14's live match list have no notice to key off, so every queued player and every lobby spectator falls back to polling inspect (`queue()`, `session()`) every few seconds — precisely the H4 contention pattern §11 claims is "planned for rather than discovered." Fix is one line of spec: emit `MatchStarted {matchId, players, firstMover, timestamp}` (and it also gives replays their start anchor). Queue-position changes could ride the same stream.
- **H2. The abandoned-match sweep (F2/§6.5) conflicts with "no match is ever killed mid-board" (§5.3).** "Next `scheduleSession` sweeps abandoned matches" has no criterion for *abandoned*. If the owner schedules next week's session while overtime matches are legitimately playing past `sessionEnd` (explicitly allowed), the sweep kills live boards. Specify the criterion in-engine — e.g., sweep only matches with `now − lastMoveTime > k × TURN_TIMEOUT` — rather than relying on an unstated operational rule about when the owner may schedule. Also specify what the sweep emits (F5 with `abandoned: true` and null `winner/loser`) and that it clears the stale queue (M4).
- **H3. `TURN_TIMEOUT ≈ 60s` sits close to the infra latency floor — B2 is more dangerous in v5 than in v4.** In v4 the timer was a coordination allowance; a slow node meant awkward pacing. In v5 it is a *forfeit* timer: wallet sign + L1 inclusion + node ingestion + poll ≈ 10–15s per confirmed move on the happy path, so a mis-set confirmation depth or a laggy node converts directly into unjust forfeit losses and a blown ≤25% forfeit metric. The week-1 skeleton must measure p95 input→notice latency and the 60s constant validated against it (tunable via F2 — good).
- **H4. First-mover clock starts at the pairing input's timestamp with no grace, and there is no `leaveQueue`.** The pairing input is the *second* joiner's transaction: the first joiner — who may have queued minutes earlier and looked away — is instantly on a 60s clock they discover via polling. Combined with no way to leave the queue, ghost queue entries systematically produce forfeit-bait matches, attacking the ≤25% forfeit floor (§4) and enabling the cheapest farm: pair two alts, wait 61s, claim, repeat (~1 "match" per 70s, zero moves — §10 accepts sybil, but this inflates the headline match count with no replay content). Recommend: (a) add `leaveQueue`; (b) first-move grace (e.g., 2× `TURN_TIMEOUT` for move 1); (c) exclude zero-move forfeits from the match count (treat like abandoned in §8 stats).

### Medium

- **M1. §11 vs F7 tie-break contradiction (mis-folded v4-M3).** §11: "all tie-breaks (F7) deterministic **and in-engine**"; F7: session aggregates "derived **off-chain**." Resolve: session-level tie-breaks (fastest win, king of the chain) live in the off-chain stat script — fine, but say so; per-*match* determinism stays in-engine.
- **M2. F5 schema underspecified for non-normal endings:** `winner`/`loser` on `abandoned: true`, `closingMove` on forfeit (there is no closing move) — need explicit nullability. And per-match `longestChain: {addr: n}` needs an in-engine tie-break when both players share the max (earliest achieved — the F7 rule, applied per match).
- **M3. F4 reject reasons are not enumerated** the way F3's are (no such match / not a player / not the waiting player / timeout not elapsed). The F12 rejection-surfacing UX needs these reason codes; enumerate them now.
- **M4. Queue lifecycle at session boundaries unspecified.** F1 gates *joins* past `LAST_MATCH_CUTOFF` and §5.3 halts pairing, but players already queued at cutoff are stranded silently; queue should be flushed at cutoff (or at sweep) and the frontend told.
- **M5. The forfeit-race loss needs explicit UX (v4-N1's lost sentence, upgraded).** A player whose valid move lands one input after the opponent's claim sees a *successful transaction* and a lost match. F12's report-correlation machinery covers the mechanics; the PRD should name this case ("your move arrived after the forfeit claim") so it's built and copy-written, not discovered in Session #1 as a "the game cheated me" tweet.
- **M6. Claim-forfeit button is in no frontend requirement.** F10 mentions the countdown; nothing says who renders "Claim forfeit now." Forfeits are lazy — if the opponent never clicks, the match hangs until the weekly sweep and *locks both addresses out of re-queueing* (F1's one-live-match rule) for the rest of the session. The button, and prominent "opponent timed out" surfacing, belong in F10/F12.
- **M7. Packaging work outstanding (v4-M5, correctly specced, not done):** `package.json` is CJS-only with no `import` condition; dual ESM+CJS before F13.

### Notes

- **N1.** Forfeit machine core verified deterministic and exploit-free (§3) — §6's pseudocode is implementable as written once H2/H4 periphery is specified.
- **N2.** Code nits still live: `src/Grid.ts:42,49` `console.log` (runs inside the machine per input), `src/Grid.ts:200` order-dependent `break`. `TODO.md` item 2 is resolved by `ac4a433` but unchecked; item 1 (extra move on close) confirms §6.4 is greenfield.
- **N3.** Stat-gaming vector: a losing player can refuse to move, converting the opponent's decisive win into a forfeit win — which §8 *excludes* from fastest-win. Sandbag-to-deny-the-record. Accept (consistent with §10) but note it in §13's observation list.
- **N4.** Scaling deltas are benign: ~600–1,200 notices/session (~0.1–0.2/s average) across 10 boards is trivial for the GraphQL indexer; 30 clients cursor-polling at 2–3s ≈ 12 rps. v4's mitigations still suffice — *provided H1's pairing notice exists*; per-board filtering by `matchId` is client-side and cheap.
- **N5.** Fairness of first-joiner-moves-first: mild first-move edge, earned by queue position; over repeated re-queues a fast re-queuer accumulates first moves. Not worth fixing for Session #1; symmetric with the first-move *timeout risk* anyway (H4).
- **N6.** Replay verification is actually *easier* than v4: 60-move logs per match instead of 180, and 10 independent small proofs per session — the divergence bisect (v4 blower #2) shrinks.

## 5. Timeline (one experienced dev, launch scope F1–F12 + F14 + F15 + thin F13)

| Workstream | v4 est. | v5 est. |
|---|---|---|
| Engine: turn machine, forfeit, chain tracking, queue + multi-match orchestrator, move log/notices, hash + determinism tests | 1.5–2 wks | 1.5–2.25 wks |
| Cartesi wrapper (advance/inspect/reports, F9 endpoints incl. `queue()`/`session()`), local dev, machine build | 1 wk | 1 wk |
| Testnet deploy, node hosting, latency validation (B2/H3) | 0.5–1 wk | 0.5–1 wk |
| Frontend F10–F12: board, queue flow + auto-redirect, forfeit countdown + claim UX, optimistic + rejection correlation | 2–2.5 wks | 2–2.5 wks |
| Lobby F14 (+ live match list/spectate) + F15 backend + readiness check | 1 wk | 1–1.5 wks |
| Thin F13 + dual packaging | 1 wk | 0.75–1 wk |
| Dry-run session (~5 wallets) + fix buffer | 1 wk | 1 wk |
| **Total** | **8–9.5 wks** | **≈ 8–10 wks** |

Teams-out ≈ queue/orchestrator-in; the 1v1 board and replay are slightly cheaper, the lobby (live list/spectate) and the forfeit/queue test matrix slightly dearer. Net wash.

**Top 3 estimate-blowers (v5):**

1. **The latency ↔ forfeit-timer loop (H3).** If measured input→notice latency diverges from the 10–15s estimate, `TURN_TIMEOUT`, grid size, the countdown UX, and the forfeit metric all re-tune together — and unlike v4, getting it wrong doesn't just feel slow, it decides matches. Week-1 skeleton on OP Sepolia is the de-risk; non-negotiable.
2. **Queue/forfeit/sweep periphery churn (H1/H2/H4, M4).** The state machine core is solid; the underspecified edges (pairing grace, leaveQueue, sweep criterion, stranded queue, hung-match locks) are exactly what a dry run flushes out — budget the design iteration, not just the code.
3. **Multi-surface frontend reconciliation.** Lobby list + queue position + N live boards + optimistic pending + rejection/forfeit-loss correlation, all reconstructed from one polled notice stream — the fiddliest code in the project, and it grows a whole extra failure branch (forfeit-race loss) versus v4. The missing `MatchStarted` notice, if not added, makes this strictly worse.

---

**Bottom line:** PRD-v5 is a better-shaped product than v4 for the same budget — it correctly absorbed nearly every prior Cartesi/determinism finding (only the tie-break in-engine/off-chain contradiction and the timestamped-late UX note were fumbled), and its one genuinely new machine (forfeit) is specified deterministically and exploit-free at the core. **Fix the four High items on paper before writing the orchestrator** — all four are one-paragraph spec changes today and dry-run incidents in eight weeks.
