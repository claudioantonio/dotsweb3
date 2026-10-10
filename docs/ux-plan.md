# UX plan — complete player journey and screens (Session #1)

Companion to [PRD-v5](./PRD-v5.md) (F10–F15) and the [TODO](./TODO.md)
roadmap (phases 4–6). The PRD says *what* the frontend must do; this
document designs the journey: state model, routes, every screen and its
states, copy rules, and the visual system. Screen mockups (23 artboards,
desktop 1280 px) live in the design canvas:
<https://claude.ai/code/artifact/2f7f1bd8-a963-4eb7-a35b-3a8abe685293>

Journey in one line: **welcome → connect wallet → join queue → get paired →
play → result → re-queue, until match starts close for the session.**

Scope: everything in F10–F15 — lobby, connect, queue, board, result,
re-queue / session-over, spectate, replay, pre-commit / readiness.
Off-session the app is a countdown lobby; wallet connect is optional until
a session is open (PRD §5.4). Desktop only (PRD §9).

Starting point in code: one local-play screen
(`packages/frontend/src/App.tsx` + `src/board/DotGrid.tsx`). No wallet,
node client, router, or theme yet — all of this is greenfield.

---

## 1. State model (drives every screen)

### 1.1 Session phase — global, from inspect `session()` (F9)

| Phase | Condition | Joins | UI headline |
|---|---|---|---|
| `NONE` | no session scheduled | ✗ | "No session scheduled yet — follow @handle" |
| `SCHEDULED` | now < sessionStart | ✗ | Countdown "Next session in 2d 04:12:33" |
| `OPEN` | sessionStart ≤ now < sessionEnd − LAST_MATCH_CUTOFF | ✓ | "Session #N is live — 1:32:10 left to start a match" |
| `CUTOFF` | cutoff ≤ now < sessionEnd | ✗ | "Match starts closed — live matches play to the end" |
| `ENDED` | now ≥ sessionEnd | ✗ | "Session #N ended — stat sheet within 24h" (live matches still finish) |

Countdown targets are the machine's timestamps (from `session()`), never a
client constant; wall-clock is used only to tick the display. Phase also
re-evaluates on every join-rejection report (no open session / past
cutoff) so a client with a skewed clock still converges.

### 1.2 Wallet state — global

`DISCONNECTED` → `CONNECTING` → `WRONG_CHAIN` (switch to OP Sepolia
prompt) → `CONNECTED`, plus two derived flags: `UNFUNDED` (balance below
gas for ~30 txs) and `READY ✓` (address has ≥ 1 accepted on-chain input —
the F15 readiness check).

### 1.3 Player state — per connected address, from `queue()` + `state()` inspect and the notice stream

```
IDLE ──join tx──▶ JOINING ──accepted──▶ QUEUED(pos n) ──MatchStarted──▶ IN_MATCH
  ▲                  │ rejected              │ leave tx                    │
  │                  ▼                       ▼                              ▼
  └──────────── (toast why) ◀──────── LEAVING ──accepted──▶ IDLE      MATCH_OVER ──▶ IDLE
```

`IN_MATCH` sub-states (F10/F12):

- `MY_TURN` (countdown to my forfeit deadline), `THEIR_TURN` (countdown to theirs)
- `TX_PENDING` (my move signed, not confirmed — submit locked, pending badge on the edge)
- `OPPONENT_TIMED_OUT` (their deadline passed → **Claim forfeit** CTA), `CLAIM_PENDING`
- `I_TIMED_OUT` (my deadline passed; I can still move until they claim — banner warns)

`MATCH_OVER` variants (from `MatchEnded`): `WON`, `LOST`, `WON_BY_FORFEIT`,
`LOST_BY_FORFEIT`, `LOST_FORFEIT_RACE` (my valid move landed after their
claim), `ABANDONED` (no winner), `ZERO_MOVE` (recorded but stat-excluded —
say so).

**Recovery rule:** on page load or reconnect, derive player state from
inspect (`queue()`, `state()` by address) and deep-link to the right
screen — a refresh mid-match must land back on the board.

### 1.4 App health — global banner

`cartesi_getApplication` `enabled/status` ≠ OK, inspect unreachable
> 60 s, or notice poll stalled → sticky top banner "Node unreachable —
moves may not confirm; countdowns may be stale." Never hide the board.

---

## 2. Navigation & routes

| Route | Screen | Guard |
|---|---|---|
| `/` | Lobby (welcome, all session phases) | none |
| `/queue` | Queue | wallet CONNECTED; redirects to `/` if not OPEN |
| `/match/:matchId` | Match board (player) | connected address ∈ players; else renders as Spectate |
| `/match/:matchId/result` | Result | match ended |
| `/watch/:matchId` | Spectate (read-only) | none |
| `/replay/:matchId` | Replay + hash check | none |
| `/precommit` | Pre-commit sign-up + slot poll | none |
| `/session/:n` | Session stat sheet (results, replay links) | none |

Global chrome on every route: **header** (logo, session-phase pill with
countdown, wallet chip: address/ENS + chain dot + balance warning;
"Connect" button when disconnected), **status banner** (owner-authored
one-liner — the only support surface), **health banner** (§1.4), toast
region (bottom-right).

Auto-navigation — the only places the app moves the user itself:

- `QUEUED` + `MatchStarted` containing my address → `/match/:id` (F11).
  A 3 s "Paired with 0xAB…CD — you move first/second" interstitial, no
  click required.
- `IN_MATCH` + `MatchEnded` for my match → `/match/:id/result`.
- Everything else is a click.

---

## 3. Screen inventory

States marked ★ are separate mockup artboards.

### S1 Lobby / Welcome (`/`)

Layout: header → hero row → two-column body (main 2/3, aside 1/3) → footer.

- **Hero:** title "Dots", one-line thesis ("1v1 dots-and-boxes, every
  move on-chain, every match replayable"), **session status card** with
  phase headline + countdown + primary CTA:
  - `NONE`: CTA "Pre-commit to the next session" → `/precommit`
  - `SCHEDULED`: countdown; CTA "Pre-commit" + secondary "Get your wallet ready" ★
  - `OPEN`: "Session #N is live", countdown to cutoff, live-match count;
    CTA "Connect wallet" (disconnected) / "Join queue" (connected & ready) /
    "Fund wallet first" (unfunded) ★
  - `CUTOFF`: "Match starts have closed — N matches still live"; CTA "Watch a live match" ★
  - `ENDED`: personal recap if connected ("You played 3 matches, won 2,
    longest chain 4"), "Stat sheet within 24h", next-session countdown if
    scheduled. **This is the session-over screen.** ★
- **Main column:** during `OPEN/CUTOFF/ENDED`: **Live matches** list
  (A vs B, score, moves, elapsed, "Watch"; a "waiting in queue: k" line to
  attract finishers — PRD §13). Off-session: **Last session** stat sheet
  (#matches, fastest win, king of the chain, per-match results with
  replay ✓ links) + **Standing records** (static text).
- **Aside:** **How to play** (4 bullets: 6×6, extra move on close, 60 s per
  turn or forfeit, first joiner moves first), **Wallet readiness
  checklist** (Connect → OP Sepolia → Fund (faucet link) → Send one test
  input ✓), **Pre-commit tally** ("23 committed for Thu 19:00 UTC").
- First visit: no modal; the how-to-play aside *is* the welcome. Never gate.

### S2 Connect wallet (modal over any screen)

- One "Connect wallet" injected-connector button; explains OP Sepolia testnet, no money.
- ★ **Wrong chain**: "Switch to OP Sepolia" button (wagmi `switchChain`).
- ★ **Unfunded**: balance, "You need gas for ~30 transactions per match",
  faucet links, "Re-check" button.
- Ready state closes the modal; header wallet chip shows address/ENS + readiness ✓.

### S3 Queue (`/queue`)

- Position card: "You're #3 in queue · 2 ahead of you" + "Matches start
  when two players are queued" + waiting indicator; time since joined.
- **Leave queue** (secondary, no confirm; disabled while tx pending).
- Countdown to cutoff, prominent ("Pairing closes in 14:02").
- Live matches list (same component as S1) so waiting is not empty.
- ★ **Joining** (tx pending, "Confirm in your wallet…") and **Join
  rejected** toasts per reason: no open session / past cutoff / already
  queued / already in a live match (→ link: "You still have a live match —
  finish it or claim forfeit").
- ★ **Cutoff reached while queued**: "Pairing has closed for Session #N —
  you won't be matched this session. Your queue entry clears
  automatically." CTAs "Back to lobby" / "Watch live matches".
- ★ **Paired** interstitial: "Paired! vs 0xAB…CD — you move first. Board
  opens…" (auto-redirect ≤ 3 s).

### S4 Match board (`/match/:id`) — the core screen

Layout: header → **match bar** → board (left, ~520 px) + side panel (right).

- **Match bar:** Player A card (address/ENS, color swatch, big score) —
  "vs" — Player B card. The on-turn card carries a **forfeit countdown
  ring** ("0:47"). Move counter "Move 23/60".
- **Board:** reuse `DotGrid` visuals (teal A / orange B, two-click
  selection, neighbor hints). Add: **pending edge** drawn dashed with a
  "pending" badge until the F6 notice with the matching `moveIndex`
  arrives; last confirmed edge pulses briefly; hover shows a ghost edge.
- **Side panel:** turn status ("Your move · 0:47 left" / "Waiting for
  0xAB…CD · 0:52"), extra-move hint ("You closed a square — go again!"),
  **move log** (newest first: `#23 you (2,3)→(3,3) +1`), "Longest chain
  this match: you 3 · them 2", tx status ("Move #24 pending · view tx"),
  "Leaving = forfeit" note.
- In-match session banner when phase ≥ `CUTOFF`: "Session #N match starts
  are closed — this match plays to the end." (never alarm the player).
- ★ **My turn** · ★ **Their turn + tx pending badge** · ★ **Opponent timed
  out** → red card "Opponent hasn't moved in 60 s" + primary **Claim
  forfeit** (enabled / claim pending / rejected `DEADLINE_NOT_ELAPSED` →
  "The machine's clock says the deadline hasn't passed yet — try again in
  a few seconds") · ★ **I timed out** (amber: "Your turn has expired — your
  opponent can claim a forfeit. Moving now still counts until they do.").
- Rejection toasts (F12), correlated receipt input index → report: out of
  turn / edge already drawn / non-adjacent / out of bounds / not a player /
  no such live match, plus the **forfeit-race** copy: "Your move confirmed,
  but it arrived after your opponent's forfeit claim. The match ended by
  forfeit." → Result `LOST_FORFEIT_RACE`.
- First-move grace: the first joiner sees "You have 2:00 for your first
  move" — just a longer countdown from inspect's resolved deadline.

### S5 Result (`/match/:id/result`)

- Headline by variant: "You won 13–12" / "You lost 11–14" / "Won by
  forfeit — opponent stopped moving" / "Lost by forfeit — you didn't move
  in time" / "Lost — your move arrived after the forfeit claim" (+ one-line
  explanation) / "Abandoned — no winner" / zero-move note ("Recorded, but
  excluded from stats").
- Final board thumbnail (read-only `DotGrid`), score, duration, longest
  chain for both players, `finalBoardHash` (mono, truncated, copy), engine
  version.
- **Replay** link + "verify ✓" chip, **Share** (copies replay URL /
  pre-filled tweet).
- Primary CTA by session phase: `OPEN` → **Join queue again** (one click);
  `CUTOFF/ENDED` → "Match starts are closed for this session" + "Back to
  lobby" (S1 `ENDED` recap). ★ win · ★ loss / forfeit-race · ★ session-closed CTA.

### S6 Spectate (`/watch/:id`)

Same layout as S4 without interaction: "Watching" header, both players,
scores, countdown for the on-turn player, move log ticking from notices,
"Live" pill. On `MatchEnded` shows the result overlay + "Replay" link. If
the connected address is a player, redirect to S4.

### S7 Replay (`/replay/:id`)

- Board auto-plays from `history(matchId)` through the engine
  (~200 ms/move), progress "Move 31/60", play/pause (scrubber is a fast
  follow — leave a disabled slot).
- **Verification card** is the hero: "Replay hash `0x9f3a…` matches
  on-chain hash ✓" / ✗ mismatch (red; "engine version skew: replay v0.1.0
  vs on-chain v0.1.1" or "divergence at move k"). Engine version, match
  meta, share.

### S8 Pre-commit (`/precommit`)

"I'll be there" form (social handle only, no wallet), tally + goal bar
("23 / 16 needed — session is a go"), slot-time poll (3–4 options, one
vote per handle), share. Readiness checklist repeated with the "send one
test input" step and per-address ✓ (reads `cartesi_listInputs` by sender).

### S9 Session stat sheet (`/session/:n`)

The shareable page: #matches, fastest win (address, m:ss, replay ✓), king
of the chain (address, n squares, replay ✓), per-match results table
(winner, score, forfeit?, replay ✓), "I was there" address list, SDK
issues filed. Rendered from the off-chain stat script output (F7).

### Global components (one artboard)

Header states (disconnected / connected / wrong chain / unfunded), session
pill per phase, status banner, health banner, toast set (rejection
reasons, paired, tx confirmed), wallet chip.

Artboard count: ~22 (S1×5, S2×3, S3×4, S4×4, S5×3, S6, S7, S8, S9, globals).

---

## 4. Copy & tone rules

- Never blame the player for infra: every rejection names the cause and the
  fix. Forfeit-race copy is the PRD F12 wording.
- Countdowns show `m:ss`; under 10 s turn red. The "Claim forfeit" CTA
  appears only once the resolved deadline has passed by machine time
  (+ 2 s slack to avoid a `DEADLINE_NOT_ELAPSED` bounce).
- Addresses: ENS if resolvable, else `0x1234…abcd`; "you" replaces the
  player's own address everywhere.
- No money words; no Discord; support pointer = status banner + @handle.

## 5. Visual system

- Chakra v3 custom system, **dark-first**: surfaces
  `#141517 / #1a1b1e / #25262b`, accent cyan `#15aabf`, semantic
  success/warning/danger `#40c057 / #fab005 / #fa5252` (from the Cartesi
  frontend design standard). Keep the board's existing player colors teal
  `#2C7A7B` (A) / orange `#C05621` (B), brightened for the dark background.
  Open Sans; mono for hashes and addresses. 4 px spacing unit, `md` radii.
- Board stays SVG (`DotGrid`); mockups use the same geometry
  (`CELL 64 / PAD 32`).

---

## 6. Data sources per surface

| Surface | Reads | Writes |
|---|---|---|
| Session pill, lobby status card, queue countdown | inspect `session()` | — |
| Queue position | inspect `queue()`; `MatchStarted` notices | `joinQueue`, `leaveQueue` |
| Board, turn, forfeit countdown | inspect `state(matchId)` (resolved deadline); per-move notices (F6) | move `{matchId, edge}`, `claimForfeit{matchId}` |
| Pending badge / rejection toasts | tx receipt → input index → reports (`cartesi_listReports`) | — |
| Result | `MatchEnded` notice | — |
| Live matches, spectate | `session()` live list; notice stream filtered by `matchId` | — |
| Replay | inspect `history(matchId)` + `MatchEnded.finalBoardHash` | — |
| Readiness ✓ | `cartesi_listInputs` filtered by sender | one test input |
| Pre-commit tally / slot poll | F15 web service | F15 web service |
| Health banner | `cartesi_getApplication`, inspect/poll liveness | — |

Notices and reports are polled (cursor-based, 2–3 s); inspect is hit on
navigation and on recovery, not in a loop.

---

## 7. Edge-case checklist (must be visibly handled)

- Refresh or reconnect mid-match → back on the board (§1.3 recovery rule).
- Queued when cutoff hits → explicit "won't be matched" state (S3).
- Opponent never claims a hung match → both addresses locked; the join
  rejection links to the live match so the player can finish or claim.
- Node outage → health banner; board stays visible; countdowns flagged stale.
- Zero-move forfeit → result says it is recorded but excluded from stats.
- Move confirmed after opponent's claim → forfeit-race result, not "you lost".
- Session ends while a match is live → in-match banner, match plays on.

## 8. PRD traceability

| F | Where |
|---|---|
| F10 board, score, turn, countdown, opponent, Claim forfeit | S4 |
| F11 join → position → auto-redirect; result + re-queue | S3, S5, §2 auto-navigation |
| F12 pending badge, submit lock, rejection surfacing, forfeit-race copy | S4, §4 |
| F13 replay + hash check | S7, S5 link |
| F14 lobby: countdown, pre-commit, readiness, banner, stat sheet, live list / spectate | S1, S6, S9 |
| F15 pre-commit backend + readiness | S8, S1 aside |

## 9. Open questions

- Rematch at match end (PRD Q1): stays **no** — FIFO only; the Result CTA is "Join queue again".
- ENS on a testnet: resolve against mainnet ENS or skip; default to truncated addresses if unresolved.
- Whether the session stat sheet (S9) is a route in this app or a static page generated by the stat script.

## 10. Next steps

Implementation follows [TODO](./TODO.md) phases 4–6, targeting the
screens and states here; the canvas artboards are the visual reference
(page "Flows" = one row per journey step, page "Components" = shared
chrome, toasts, board states, colour tokens).
