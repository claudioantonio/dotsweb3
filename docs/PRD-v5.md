# PRD: Dots — On-Chain 1v1 Sessions (V5)

**Status:** Draft  **Date:** 2026-07-05  **Stack:** Cartesi rollup on **OP Sepolia (Optimism testnet)**, TypeScript engine, web frontend, testnet only
**Note:** This document is self-contained. It consolidates and supersedes all previous PRDs (v1–v4); no prior version needs to be read.
**Companions:** [V5 feasibility assessment](./PRD-v5-feasibility-assessment.md) (fresh developer pass on this document, 2026-07-05 — four High findings pending resolution); [V4 assessment](./PRD-v4-feasibility-assessment.md) (prior pass whose Cartesi/determinism/infra findings are folded into §7/§11 below; its team-mechanics items are obsolete).

## 1. Summary

Classic **1v1 Dots-and-Boxes**, played on a Cartesi rollup in **scheduled, time-boxed sessions**. Players arrive at the announced hour, join a queue, and are paired into their own match board — so a 20-player session runs ~10 matches concurrently. Matches are short (~12–15 minutes on a 6×6 grid), players re-queue when they finish, and every completed match emits a verifiable result and a browser replay that re-runs the full input log through the same engine. A session's outcome is a stat sheet — **matches played, fastest win, king of the chain** — posted as a result thread on the game's Twitter/X account.

**The primary product is the SDK battle-test; the game is the load generator.** Sessions concentrate a small audience into real concurrency: many independent boards advancing simultaneously is both the fix for the empty-board engagement risk and a richer stress profile than one shared board.

## 2. Product thesis

Two ideas, in priority order:

1. **Battle-test Cartesi's rollups SDK under real concurrent load.** A trickle of one transaction per hour exercises nothing. A 2-hour window with 20–30 wallets playing ~10 simultaneous matches produces burst input load across many independent game states, a live per-move notice stream consumed by every connected frontend, inspect queries under load, and — at the end of every match — a public determinism proof: the browser replay re-runs the match's input log through the same engine package, and any divergence from machine state is an SDK-integration bug surfaced within hours, with a small log to bisect. Nothing synthetic; every input comes from a human with a reason to send it. Finding and filing SDK issues **is** the product.

2. **Validate that verifiable personal records create returning behavior.** The retention bet is individual: your match record, your fastest win, your longest chain — all on-chain, all replayable, all contestable next session ("defend your title Thursday"). 1v1 Dots-and-Boxes carries its strategic depth natively — chain control and the double-cross are two-player maneuvers — so the game is fun without any coordination layer.

Two prior designs were considered and rejected, and the reasons are constraints on V5:

- **A persistent always-on board** fails at small scale: a lone visitor stares at an empty board, and every mitigation (adaptive timeouts, idle detection) patches the weakness instead of removing it. Sessions remove it: the board is only live when a critical mass has committed to show up. Failure feedback compresses accordingly — a bad session is known within 2 hours and fixed by the next one.
- **A two-team shared board** depends on intra-team coordination (who plays the chain next?), which in practice means a live chat channel. This project deliberately has **no Discord or community server** — a dead Discord is the empty-board problem in chat form. 1v1 needs no coordination: strict alternation plus extra-move-on-close is the whole social protocol.

## 3. Target user

Crypto-curious to crypto-native users with a testnet wallet, recruited from the Cartesi ecosystem (one-off announcement posts in Cartesi's existing channels) and the game's Twitter/X account. They enjoy competitive quick matches and verifiable "I was there" records. Explicitly **not** targeting traders, DeFi power users, or mobile-only casual gamers.

The session model adds two requirements: they can show up at an announced time, and they arrive with a **working, funded testnet wallet**. The pre-commit page (§12) verifies the first; the wallet-readiness check (§12) verifies the second.

## 4. Goals & success metrics

Primary: the SDK processes a full session of real concurrent load with verifiable correctness. Secondary: people come back for the next session.

**SDK battle-test (primary):**

| Metric | Target |
|---|---|
| Inputs processed in Session #1 | ≥ 600 (≈ ten full 6×6 matches); stretch 1,200 |
| Completed matches in Session #1 | ≥ 10 |
| Replay state vs. machine state, every completed match | Zero divergence (hash-equal final board) |
| Rejected inputs handled without state corruption | 100% (out-of-turn, already-drawn edge, forfeit races) |
| Inspect `state` availability during session | No sustained outage > 60s |
| Issues filed against SDK/integration from Session #1 | Tracked — finding them **is** the product |

**Engagement floor (secondary — must clear, not maximize):**

| Metric | Target |
|---|---|
| Unique addresses in Session #1 | ≥ 16 |
| Median matches per participating address | ≥ 2 |
| Matches ending by forfeit/abandonment | ≤ 25% |
| Session #1 → Session #2 attendance | ≥ 30% of addresses |
| Distinct replays of Session #1's matches within a week | ≥ 50 |

Session attendance is a clean retention signal: showing up at an announced hour is deliberate. The forfeit-rate metric is new and load-bearing — it is the direct measure of whether 1v1 matches hold attention to completion.

## 5. Session model

1. **Scheduled window.** Each session has an on-chain `sessionStart` / `sessionEnd` (~2 hours apart), set per session by the owner address (F2). All timing reads the Cartesi input metadata timestamp — never wall-clock.
2. **Matchmaking queue.** From `sessionStart`, a `joinQueue` input enters the sender into a FIFO queue; a `leaveQueue` input removes them (no ghost entries baiting forfeits). Whenever the queue holds two addresses, the engine opens a match between them (first joiner moves first), removes both from the queue, and emits a **`MatchStarted` notice** — the signal the frontend keys off for pairing (F1/F11), not inspect polling. Players may re-queue immediately after their match ends. An unpaired player waits for the next joiner; the frontend shows queue position.
3. **Match starts throttle, endings don't.** No new match is created after `sessionEnd − LAST_MATCH_CUTOFF`: joins are rejected and pairing halts, so anyone still queued at the cutoff will not be paired this session — the frontend must say so explicitly (via F9), and stale queue entries are cleared by the next sweep (§6.5). A live match always plays to completion (or forfeit), even past `sessionEnd` — **no match is ever killed mid-board** (the sweep only touches matches idle past `SWEEP_IDLE`, never active ones). The session boundary throttles match *starts*, never match *endings*.
4. **Between sessions: the lobby.** The site shows a countdown to the next session, the pre-commit sign-up (§12), the wallet-readiness check (§12), the previous session's stat sheet and replays, and a one-line live-status banner (the support surface during sessions — there is no chat server). The lobby **is** the product 166 hours a week; replays and standing records make it worth visiting.
5. **Cadence.** Weekly to start. The slot is chosen by polling pre-committed players via the pre-commit page; revisit if one timezone dominates.
6. **Go/no-go per session:** ≥ 16 pre-commits by 24h before, else postpone. Never open a session that can't fill a queue.

## 6. Match mechanics

1. **Two players per board.** Paired FIFO from the queue (§5.2). First joiner of the pair moves first. An address plays at most one live match at a time (queue join rejected while in a live match).
2. **Grid: 6×6 dots** (36 dots, 60 edges, 25 squares). 25 is odd, so **ties are impossible** — every completed match has a winner.
3. **Alternating turns.** Players draw one edge per turn.
4. **Extra move on close.** A move that closes one or two squares grants the same player another move. This preserves chain-running and the double-cross — the strategic core of the game.
5. **Turn timeout → forfeit.** If the player on turn submits no valid move before the forfeit deadline, the opponent may submit a `claimForfeit` input and win by forfeit. The deadline is `TURN_TIMEOUT` (~60s) after the last applied move — except for the **first move of a match**, which gets `FIRST_MOVE_GRACE` (= 2 × `TURN_TIMEOUT`): the pairing is triggered by the *second* joiner's transaction, and the first joiner may have queued minutes earlier and needs time to notice they've been paired. Forfeits are resolved lazily (Cartesi machines have no clocks between inputs): the claim is valid iff the input's metadata timestamp exceeds the deadline. A **zero-move forfeit** (loser never played a move) is recorded but treated as abandoned in all stats (§8) — this closes the cheapest match-count farm (pair two alts, wait, claim). A match where *both* players vanish is swept as **abandoned** — no winner, excluded from all stats — by the next `scheduleSession` input, which closes only matches idle longer than `SWEEP_IDLE` (= 10 × `TURN_TIMEOUT`), so a legitimately live overtime match is never touched.
6. **Win condition.** All 25 squares claimed → the player owning more squares wins. Or win by forfeit (§6.5).

### Turn state machine (engine)

```
match: { players: [A, B], turn ∈ {A, B}, forfeitDeadline }

pairing (second joinQueue):
  emit MatchStarted {matchId, players, firstMover, timestamp}
  turn = A (first joiner)
  forfeitDeadline = pairingTime + FIRST_MOVE_GRACE     // 2 × TURN_TIMEOUT
move from P:
  reject unless P == turn
  apply move:
    squaresClosed > 0 ? turn stays P : turn = other(P)
  forfeitDeadline = now + TURN_TIMEOUT                 // input metadata timestamp
claimForfeit from P:
  reject unless P == other(turn) and now > forfeitDeadline
  match ends: winner = P, forfeit = true
              (loser played 0 moves → zeroMoveForfeit = true; see §8)
sweep (on scheduleSession input):
  every live match idle > SWEEP_IDLE (10 × TURN_TIMEOUT):
    match ends: abandoned = true, winner = null
  clear stale queue entries
```

### Per-turn chain tracking

The engine tracks `squaresClosed` per uninterrupted turn (a counter reset when the turn changes) and each player's per-match maximum. This is what makes **king of the chain** (§8) computable; it is deliberately in launch scope because the stat is a headline outcome, not a later achievement.

## 7. Functional requirements

**Engine (Cartesi Machine):**
- **F1.** Accept `joinQueue` from any address while a session is open and match starts are allowed (§5.3). Reject: no open session; past `LAST_MATCH_CUTOFF`; sender already queued or in a live match. Accept `leaveQueue` (reject: sender not queued). Pair FIFO per §5.2; pairing emits **`MatchStarted {matchId, players, firstMover, timestamp}`** — the event F11's auto-redirect and F14's live match list key off (avoiding inspect polling), and the replay's start anchor.
- **F2.** Accept an admin input `scheduleSession{sessionStart, sessionEnd, gridSize?, turnTimeout?}` from a designated owner address (minimal governance; fine for testnet). Scheduling a session sweeps matches idle past `SWEEP_IDLE` as abandoned and clears stale queue entries (§6.5) — it never touches an active match. Grid size and timeout are per-session tunables — the retuning levers for §13.
- **F3.** Accept `{matchId, edge: [Coord, Coord]}` moves. Reject (no state change, with a machine-readable rejection **report**): no such live match; sender not a player in it; out of turn; out of bounds; non-adjacent; edge already drawn. Addresses are **normalized to lowercase inside the engine** at every ingress.
- **F4.** Accept `claimForfeit{matchId}` per §6.5, validated against input metadata timestamps. Enumerated rejection reasons (each a machine-readable report, consumed by F12): `NO_SUCH_MATCH`, `NOT_A_PLAYER`, `NOT_THE_WAITING_PLAYER`, `DEADLINE_NOT_ELAPSED`. All timing deterministic from input metadata; same-block inputs resolve in input-index order.
- **F5.** On match end: emit `MatchEnded {matchId, sessionId, players, winner, loser, squares: {addr: n}, forfeit: bool, zeroMoveForfeit: bool, abandoned: bool, durationSeconds, longestChain: {addrA: n, addrB: n}, closingMove, finalBoardHash, engineVersion}`. Nullability is explicit: `winner`/`loser` are null iff `abandoned`; `closingMove` is null on forfeit and abandoned endings. `longestChain` reports **both players' per-match maxima** (so no per-match tie-break is needed; the session-level king-of-the-chain tie-break is applied off-chain per F7). `finalBoardHash` is a keccak256 over a **canonical board encoding** (fixed edge ordering derived from coordinates, square owners by id — never `JSON.stringify` of live objects) and is the replay-verification anchor. `engineVersion` lets the replay check version skew before comparing hashes.
- **F6.** Emit per-move notice `{matchId, moveIndex, edge, submitter, squaresClosed, turnAfter, timestamp}`. The engine's internal move log is this same record — it is simultaneously the notice payload and the replay input.
- **F7.** Maintain per-match state; session-level aggregates (#matches, fastest non-forfeit win, king of the chain) are derived **off-chain from F5/F6 notices** — no cross-session stats in the engine. The engine's emissions (F5/F6) are fully deterministic, so the off-chain stat script is reproducible by anyone from the notice stream; its tie-breaks are fixed here so every reproduction agrees: fastest win → earliest achieved; king of the chain → earliest achieved, then lowest address. (Division of labor: per-*match* facts and their determinism live in-engine; session-*level* ranking and tie-breaks live in the stat script.)

**dApp wrapper:**
- **F8.** Route inputs, tag `msg.sender` (lowercase), map engine throws → Cartesi `reject` + rejection report with reason code.
- **F9.** Inspect: `state(matchId?)` (board, turn, resolved forfeit deadline — not the raw constant, so frontend countdowns never disagree with the machine), `queue()` (positions), `session()` (window, cutoff, live match list), `history(matchId)`.

**Frontend:**
- **F10.** Match board: edges, owned squares, score, turn indicator + forfeit countdown, opponent address/ENS. When the opponent's deadline passes, show a prominent **"Claim forfeit"** button — forfeits are lazy, and without the claim the match hangs and (per F1's one-live-match rule) locks *both* players out of re-queueing for the rest of the session.
- **F11.** Queue flow: join button → queue position → auto-redirect into the match board when paired. Post-match: result screen with re-queue button.
- **F12.** Submit-move UI: optimistic pending render (a simple badge; reconciled against the F6 notice stream by `moveIndex`), submit disabled while the player's own transaction is pending (also avoids MetaMask nonce queuing), and **rejection surfacing**: correlate the tx receipt's input index with the rejection report to tell the player *why* a move bounced. This must cover the forfeit race explicitly: a valid move landing one input after the opponent's `claimForfeit` is a *successful transaction and a lost match* — the UI says "your move arrived after the forfeit claim," so the player learns what happened instead of concluding the game cheated.
- **F13.** Replay per `matchId`, driven by the same engine npm package reading `history`, with a visible **"replay hash matches on-chain hash ✓"** check. **Launch scope is deliberately thin:** load history → re-run through the engine → auto-play render → hash check. A scrubber/timeline is a fast follow.
- **F14.** Lobby: countdown, pre-commit sign-up + tally, wallet-readiness check, live-status banner, last session's stat sheet and replay links; during a session, a list of live matches with scores (spectate = watch a board via the notice stream).
- **F15.** Pre-commit + readiness backend: a small conventional web service (Supabase-class) storing pre-commits and slot-poll votes, and checking readiness (has the address sent a test input?) by reading on-chain inputs. Explicitly in scope — it is the go/no-go data source.

**Ship order.** Launch blockers: F1–F12, F14, F15. F13 (thin) must ship before Session #1 — it is both the shareable artifact and the determinism proof; without it the primary metric in §4 is unmeasurable.

**Build order (recommended):** week 1 = walking skeleton on OP Sepolia (deploy a trivial echo dApp, measure real input→notice latency, **verify the node's input confirmation depth is near-`latest`** — launch prerequisite) → engine rules + determinism tests (audit enforced from the first line) → Cartesi wrapper + reports → match board + queue flow (F10–F12) → lobby + backend (F14–F15) → headless replay verify, then thin playback (F13) → **dry-run session with ~5 wallets** (non-optional; it is the only pre-launch exercise of node hosting, inspect contention, and GraphQL lag under concurrency).

## 8. Session stat sheet & shareable outcomes

All derived off-chain from F5/F6 notices; posted as the session result thread on Twitter/X within 24h by one named owner:

1. **#Matches completed** — the session's headline volume number.
2. **Fastest win** — shortest non-forfeit match by duration; the standing record to beat next session.
3. **King of the chain** — most squares closed in one uninterrupted turn across the session.
4. **Per-match results** — winner, score, replay link with its verification ✓.
5. **"I was there — Session #1"** — participated; tests history-as-identity.
6. Any SDK issues found and filed — for the Cartesi audience, "we found and filed X under load" *is* content.

Forfeit wins count as matches but are excluded from fastest-win (a farmable stat otherwise). **Zero-move forfeits** (the loser never played) are treated like abandoned matches: they appear in *no* stat, including #matches — otherwise two alts could inflate the headline number at one "match" per ~70 seconds with no replay content. Abandoned matches appear in no stat.

## 9. Non-goals

- No money: no vault, fees, payouts, or tokenomics.
- No account abstraction / gasless onboarding (deferred; see friction note in §11).
- **No Discord or community server of any kind.** Twitter/X is the channel of record; the lobby's status banner is the live support surface; Cartesi's existing channels receive one-off recruitment posts only.
- No tournament structure: no brackets, seeds, ratings, or rankings — FIFO pairing only.
- No commit-reveal; ordering is whatever the sequencer says.
- No teams. No private matches or challenge-a-friend (pairing is queue-only).
- No spectator chat.
- No cross-session leaderboard pages (the stat sheet is a per-session thread; standing records live in the lobby as static text).
- No automated session scheduling; the owner schedules (F2) and a human announces.
- No mainnet deploy; no mobile-optimized UI (responsive desktop only); no NFT minting.

## 10. Sybil stance

No anti-sybil measures. One human may control multiple addresses — including **both sides of a match** (the queue can pair a player with their own alt). **Accepted with eyes open:** with no money, what self-play attacks is the credibility of the stat sheet (a farmed king-of-the-chain, an inflated match count). Stakes are zero, the launch audience is small and high-context, and every match is publicly auditable via F5/F6 — a farmed chain record comes with a replay anyone can inspect and call out. Fastest-win already excludes forfeits, which closes the laziest farm. **Hard gate: revisit this line before any payout layer or prize.**

## 11. Technical decisions

- **Base chain: OP Sepolia (Optimism testnet).** ~2s blocks: a move's confirmed latency is dominated by wallet signing and node/frontend polling, not L1 inclusion. Gas negligible, faucets plentiful. **Launch prerequisite:** verify the rollups node reads inputs near-`latest` (a `finalized` setting would add minutes per move; caught in the week-1 walking skeleton).
- **Grid: 6×6 dots** (60 edges, 25 squares). At ~10–15s per confirmed move alternating between two engaged players: **~12–15 min per match**, several matches per player per session. Odd square count ⇒ no ties. Tunable per session via F2.
- **`TURN_TIMEOUT`: ~60s.** It is a *forfeit* timer, not a coordination allowance — which raises the stakes on infrastructure: a timer set near the latency floor converts node lag into unjust forfeit losses and blows the ≤ 25% forfeit metric. **The 60s value must be validated against the p95 input→notice latency measured in the week-1 walking skeleton** (tunable per session via F2 if reality disagrees). Derived constants: **`FIRST_MOVE_GRACE` = 2 × `TURN_TIMEOUT`** (the first joiner discovers the pairing asynchronously — §6.5) and **`SWEEP_IDLE` = 10 × `TURN_TIMEOUT`** (the abandonment threshold for the scheduling-time sweep; generous enough that no live overtime match is ever swept).
- **`LAST_MATCH_CUTOFF`: ~15 min.** Matches are short; only genuinely late starts are throttled.
- **Concurrency profile:** ~10 live matches ⇒ every client polls GraphQL notices for deltas (cursor-based, every 2–3s) and hits inspect rarely; if needed, a 1–2s caching proxy in front of inspect. GraphQL has no subscriptions — polling is the model, planned for rather than discovered.
- **Transaction friction (acknowledged, not solved).** Every move is a signed transaction: ~30 popups per player per match. OP Sepolia removes the block-time penalty; strict alternation naturally spaces signatures and the submit-disabled-while-pending rule (F12) prevents nonce pileups. Mitigated at the funnel by the readiness check (§12). Account abstraction / session keys are the V6+ answer if friction shows up in §13.
- **Determinism kit (hard requirement):** no `Date.now`, no `Math.random`; integer-only math; stable iteration order anywhere hashes or winners are computed; all timing from input metadata; addresses lowercased in-engine; canonical board encoding hashed with **keccak256 via viem/`@noble/hashes`** (pure JS, byte-identical in browser and machine — no `node:crypto`, nothing WASM-optional); engine version stamped into `MatchEnded` and checked by F13 before hash comparison. Per-match facts are deterministic in-engine (including both players' chain maxima in F5); session-level ranking tie-breaks live in the off-chain stat script with rules fixed by F7, so any reproduction from the notice stream agrees.
- **Same-engine browser replay:** the engine ships as one npm package, **dual ESM+CJS** (`exports` map), no Node-only or DOM imports, consumed at an identical locked version by both the Cartesi Machine entrypoint and the frontend — "same engine by construction" dies the day someone patches one side.
- **Node hosting is a named workstream:** someone runs the Cartesi node with uptime during sessions (self-host or PaaS); it is exercised for the first time in the dry-run session, by design.
- **Read API:** Cartesi inspect (HTTP) for state; GraphQL for notices/history.

## 12. Launch & distribution

- **Channel of record: the game's Twitter/X account.** Session announcements, the go/no-go call, the 24h result thread (stat sheet + replay links + SDK issues filed), and standing records. No community server exists or is planned.
- **Recruitment: one-off posts in Cartesi's existing ecosystem channels** (showcase/dev channels, grants/spotlight pipeline). The ask is literal: *"help battle-test the rollups SDK — show up Thursday 19:00 UTC and play."* These are announcements in someone else's community, not an operated presence.
- **Pre-commit page** live ≥ 1 week before Session #1: sign up (social only, no wallet), see the tally, share, vote on the slot time. Doubles as the notify list. Backed by F15.
- **Wallet-readiness check** on the lobby: faucet link, setup instructions, and a "send one test input before session day" step with a visible ✓ per address — closes the pre-commit → working-wallet funnel gap before the session, not during it.
- **Go/no-go:** ≥ 16 pre-commits, 24h out, else postpone (§5.6).
- **The artifact is the replay link** with its verification check — "watch exactly what happened, verifiably" is the one hook only an on-chain game offers. Short matches mean many artifacts per session.
- **Live support during sessions:** the lobby's status banner plus a pinned live tweet. Anything heavier waits for evidence it's needed.

## 13. Session #1 observation list

Decisions deliberately deferred until real data exists; the result thread should address each:

- **Forfeit/abandonment rate** vs. the ≤ 25% floor — the direct test of whether 1v1 holds attention; gates any timeout retuning or queue design changes.
- **Actual move cadence** vs. the 10–15s estimate (first measured in the week-1 skeleton, confirmed under real concurrency) — retune grid size and `TURN_TIMEOUT` via F2.
- **Queue liquidity** — median wait to be paired; if players idle unpaired mid-session, consider showing "waiting" prominently in the live match list to attract finishers.
- **Wallet friction** — did ~30 popups/match visibly suppress matches-per-player? (Gates account-abstraction priority.)
- **Self-play farming** — observed in the stats? (Gates whether §10's stance survives to V6.)
- **Sandbagging** — did losing players stop moving to convert a decisive loss into a forfeit win for the opponent, denying them the fastest-win record (which excludes forfeits)? Accepted at zero stakes, but watch for it.
- **Inspect/GraphQL behavior under ~10 concurrent boards** — did polling hold within the §4 availability metric?

## 14. Open questions

- **Q1.** Should a rematch between the same pair be offered directly at match end (skipping the queue), or does everything go through FIFO? Lean: FIFO-only for Session #1 — one pairing path, less code; revisit if players ask.
- **Q2.** Standing records (fastest win ever, longest chain ever) across sessions: keep as static lobby text derived off-chain, or move on-engine? Lean: off-chain until someone disputes one — the replays are the proof anyway.

## 15. Out of scope — V6+ candidates

- Challenge links / private matches; rematch flow (per Q1).
- Ratings, ladders, tournaments, prizes.
- Account abstraction / session keys / gasless onboarding.
- Replay scrubber/timeline polish (fast follow after thin F13).
- Cross-session leaderboard pages; richer achievements.
- Team or free-for-all modes on a shared board — the graduation path if sessions prove a community large enough to sustain one.
- Mainnet; mobile-first; NFT minting.
