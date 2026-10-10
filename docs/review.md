# Architecture review — build round 1 (pre-devnet sign-off)

Scope: the uncommitted diff (protocol, machine, frontend, docs) against
AGENTS.md, [architecture](./architecture.md), [PRD-v5](./PRD-v5.md),
[TODO](./TODO.md). Verified locally on 2026-10-10: `npm run build` OK
(frontend chunk-size warning only), `npm run lint` OK (machine only; frontend
has no lint script), `npm test` OK — machine 159/159 jest, frontend 105/105
vitest. No devnet started (the tester's end-to-end run is taken as given).

## Verdict

**Yes, ready for devnet — once the frontend `rpc.ts` fix (B1, being made now) lands with a test.**
The machine is small, readable and does what the architecture says. Every
declined path throws before it writes. The engine is called last and does not
mutate when it throws. `machineTime` only moves on applied inputs. Output
objects are literals with a fixed key order. Iteration uses only arrays or
`Map`s. Addresses are lowercased at ingress. Time is read in one place.
AGENTS.md hard rules hold: only the two `engine-adapter.ts` files import
`dots-engine`; both packages pin `0.1.0-alpha.0` exactly, and there is one
lockfile entry; the machine lint bans `Date.now`, `Math.random` and `for…in`,
and a grep finds no `new Date`, `Intl`, `localeCompare`, `Object.keys` or
`.sort` in `machine/src` or `protocol/src`. I found no blocker in the machine
or the protocol. Two one-line hardening fixes are worth doing before the
next devnet run (S1, S2). The rest is "before OP Sepolia/Session #1" or
"leave it alone".

## Findings

### Blocker

- **B1 — `packages/frontend/src/cartesi/rpc.ts`: `cartesi_getInput` /
  `cartesi_getApplication` responses (`{result:{data}}`) are not unwrapped**
  (tester finding). Without the fix, `awaitInput` never sees `ACCEPTED`, so
  every tx sits in "processing" until it times out, and the health banner is
  wrong. The fix is in progress and I did not review it in depth. Done means:
  an `rpc.test.ts` case built from a real node response body, and the tester's
  2×2 devnet game re-run once.

### Should-fix-now (cheap, before the next devnet run)

- **S1 — No input-size cap.** `packages/protocol/src/index.ts:319`
  (`decodeAction`). A 2 MB junk payload costs ~100 ms on host just in
  `hexToUtf8` + `JSON.parse` (measured), and much more in the emulator. On a
  testnet that is cheap griefing of input latency, and input latency decides
  whether players lose unjustly by forfeit (PRD §11). **Minimal fix:** first
  line of `decodeAction`:
  `if (hex.length > 2 + 2 * 1024) malformed("payload too large")`. The largest
  real action is under 200 bytes. This gives MALFORMED_PAYLOAD + accept, which
  is deterministic. Add one test. Do **not** put the cap in `decodeJson`: the
  frontend uses it for history responses of ~100 KB. The rollup server's own
  transfer of the payload is a cost we cannot avoid, and that is acceptable.
- **S2 — `scheduleSession` has no upper bounds.**
  `packages/machine/src/session.ts:27` (and `:22-23`). This is not a real
  overflow: `isSafeInteger` keeps `2·T`/`10·T` finite and deterministic. It is
  a footgun for the owner given this repo's history of ms-vs-seconds mix-ups.
  `turnTimeout: 60000` (ms by mistake) would snapshot a 16 h turn timer into
  every match of the session, with sweep only after ~7 days. **Minimal fix:**
  `turnTimeout > 3600` → `INVALID_SESSION`, and
  `sessionEnd >= 1e12` → `INVALID_SESSION` ("looks like ms"). Add one test
  each. Nothing else (no gridSize-per-session table, no config object).
- **S3 — Stale comment:** `packages/machine/src/reject.ts:5` still says the
  router turns a Reject into `/finish {status:"reject"}`. It should say
  "accept + one Rejected report (ENGINE_ERROR excepted, §1.4)". Also
  `docs/TODO.md` task 7 wording ("Engine throws → `/finish` reject") should
  point to §1.4.

### Later (before the OP Sepolia deploy / Session #1 — not for devnet)

- **L1 — Machine state grows without bound (by design), but RAM is 128 MiB.**
  `state.ts:31` keeps every match with its live `Dots` object
  (`match.ts:63` `endMatch` never releases it). Keeping history is
  **required** (F9 `history`, F13 replays of past sessions), so "keep forever"
  is right. Measured: ~26 KB per 6×6 match with zero moves (engine object),
  about 60 KB for a full match. At PRD scale (10–30 matches a week) that lasts
  for years. Under PRD §10's accepted sybil model, though, alt pairs doing
  join/join/claim (~3 inputs per match) could create a few thousand matches in
  one session. An out-of-memory crash inside the machine stops the app for
  good. **Minimal fix, when it matters:** in `endMatch`, drop the engine
  handle for ended matches, and have `inspect.ts:43-45` read
  `scores`/`longestChain` from `match.ended` (they are already there). That
  takes ended matches to ~1–2 KB. Optionally raise machine RAM in
  `cartesi.toml`. No pruning or archiving.
- **L2 — `dots-engine` console noise:** `Grid.js` logs 26 lines per new 6×6
  game. Those lines go through the emulator console on every pairing, and in
  the browser on every `rebuild()` (once per notice on the Match screen).
  The fix belongs in **dots-engine** (see Next steps). Do not wrap or silence
  it here.
- **L3 — Rescheduling mid-session keeps the queue.** `session.ts:54` clears
  the queue only when `now ≥ old cutoffAt`. If the owner reschedules while a
  session is open (the case that matters is a future `sessionStart`), a player
  still queued from the old session gets paired days later and loses by a
  zero-move forfeit. Stats already exclude zero-move forfeits (PRD §8). For
  now it is an **operator rule**: don't reschedule into the future during an
  open session. A one-line fix if wanted: also clear when
  `sessionStart > ctx.now`.
- **L4 — One-shot stale refetch:** `frontend/src/screens/Match.tsx:33-35`
  refetches when `stale` turns true. If the refetched view is still behind
  the notices, `stale` stays true and nothing fires again. This is unlikely,
  because inspect is at least as fresh as the outputs it serves. Fix later by
  keying the effect on `[stale, notices.length]`.
- **L5 — Missed `MatchStarted` at boot.** The poller starts at the tail
  (`notices.ts:40`). A pairing that lands between the `state(player)` seed and
  the first tail read is never seen, so the Queue screen shows "not in queue".
  The window is about one RTT at boot, and the user recovers through the
  IN_LIVE_MATCH toast's "Go to match". Fix later: when the 10 s queue poll
  drops me while I was QUEUED, invalidate `qk.player(me)`. Do not add history
  replay to the poller.
- **L6 — `findLateMove` scans all reports oldest-first**
  (`inputStatus.ts:79-98`). It only runs on a forfeit-loss result screen.
  Reports exist only for declined inputs, and `getInput` is called only for
  `MATCH_ENDED`+`matchId` hits, so the cost is a few pages per session.
  Fix later: scan newest-first and stop at the first page older than
  `ended.timestamp`.
- **L7 — Node version skew:** root `package.json` `engines: node >=24`, and
  tests run on Node 24, while the image runs Node 22.14 (`Dockerfile:10,21`).
  Nothing in use differs, but determinism claims should be tested on the
  runtime that ships. Run machine tests under Node 22 once (or in CI), or set
  `engines` to `>=22`.
- **L8 — Frontend has no `lint` script.** It is not required by AGENTS.md;
  add one when a CI exists.

### Won't-fix (acceptable at this stage — do not build)

- **Unhandled `/notice`/`/report` HTTP errors exit the loop**
  (`index.ts:24-25`). No output we emit can be invalid or oversized. The
  largest is a 10×10 history inspect report of ~100 KB. Retrying would hide
  real bugs.
- **`timeOf` ≥1e12 ms guard** (`app.ts:32-35`): one line, settled as seconds,
  pinned by `replay.test.ts`. Keep it as the documented guard.
- **Protocol `utf8ToHex` string concatenation** is slow (~280 ms per 2 MB), but
  real outputs are ≤ 100 KB. Revisit only if dry-run inspect latency points
  here.

## Tester-flagged risks — disposition

| Risk | Disposition |
|---|---|
| 2 MB junk payloads as cheap DoS | **S1**: one-line cap in `decodeAction`. Residual transfer cost accepted. |
| Unbounded `turnTimeout` overflowing 2·T | It does not overflow (`isSafeInteger`), but it is an owner footgun → **S2** cap at 3600 s. |
| Reschedule keeps stale queue → zero-move forfeits | **L3**: operator rule now; stats already exclude these; one-line clear optional. |
| ENGINE_ERROR rollback never exercised live | **Won't-fix.** It cannot be reached without fault injection: every engine message is classified, and the adapter test pins every message mapping. Adding a debug action to the machine just to test this is not worth it. Unit-covered in `app.test.ts`. Revisit if an unclassified engine message ever appears. |
| `findLateMove` scans all reports; relies on MATCH_ENDED checked before player membership | Ordering is intentional (`match.ts:19-22`), pinned by `scenarios.test.ts:63,205`. Sender is re-checked via `getInput`, so a non-player's MATCH_ENDED can't be misattributed. Scan cost **L6**. |
| Notice poller starts at current end | Correct by design (history = inspect). Move gaps are caught by `moveIndex` → `stale` → refetch. Boot-window `MatchStarted` gap → **L5**. |
| Dev deps in the Docker prod image | **Not reproduced.** I simulated `Dockerfile:33` (`npm ci --omit=dev -w protocol -w machine`, npm 10.7): it installs only `dots-engine` plus the workspace links, and leaves empty `@scope/` dirs (192 KB). Even if confirmed, it only affects image size. Won't-fix. |
| `runLoop` busy-retries `/finish` on 202 | **Won't-fix.** Inside the machine `/finish` blocks until the next request, so 202 only shows up with host-mode or test servers. A sleep would need a timer, which the determinism rules discourage in machine code for no gain. |
| dots-engine `console.log` noise | **L2**, fix goes to the dots-engine repo. |

## Overengineering to cut

Little. The codebase is lean, and the §6 "do not build" list was respected:
no state library, no zod, no retry framework, no GraphQL client, no
persistence, no hashing. Optional trims, each about one line:

- `protocol/src/index.ts:387` — the `{"payload":"0x…"}` unwrap in
  `decodeInspectQuery`. Devnet showed the raw body is delivered (machine
  README). Cut it, or leave it as a harmless one-liner. Don't extend it.
- `machine/src/index.ts:20-22` — the per-advance `console.log` of the raw
  `block_timestamp` existed to settle task 3, which is settled. It costs
  emulator console I/O on every input. Remove it, or keep it only until the
  OP Sepolia check (task 2/4) confirms seconds there too.

Not overengineering, so keep: the `Result.applied` flag, the protocol's dual
CJS/ESM build, the cross-tab `findLateMove` (F12 needs it), and the Practice
mode (reuses the adapter).

## Contract drift check

Protocol is the single source of truth for both apps, and no types are
duplicated in machine or frontend. Rejection semantics agree in
`router.ts`, protocol `RejectedReport` docs, architecture §1.4,
frontend `inputStatus.ts` and `copy/rejections.ts` (all 19 `ReasonCode`s have
copy, typed as `Record<ReasonCode, …>`, so a new code fails to compile).
Deadlines are always resolved by the machine. The frontend never recomputes
a timeout rule (`turnStatus` only compares against `forfeitDeadline`).
`MatchEnded.squares`/`longestChain` key order comes from `players`
(`engine-adapter.ts:76`). The only drift is the two doc/comment items in S3.

## Recommended next steps

1. Land B1 with a test from a real node response, then S1–S3, re-run
   `npm test`, then repeat the tester's devnet game (2×2 play-through,
   forfeit, a declined move, the forfeit race).
2. Commit in two steps, protocol+machine first and then frontend, so the
   wire contract lands on its own.
3. TODO tasks 2 and 4: deploy to OP Sepolia, measure p95 input→notice latency
   and confirmation depth, and confirm `block_timestamp` is in seconds there.
   Then decide whether 60 s `turnTimeout` holds (PRD §11).
4. Before Session #1: L1 (release engine handles of ended matches) and L7,
   then the ~5-wallet dry run (task 40).
5. **To the dots-engine repo** (then bump the pin in both packages in one
   commit and update both `ENGINE_VERSION` constants):
   - `replay(log)` that checks `squaresClosed`/`turnAfter` per record. This
     replaces the frontend `Replayer` loop.
   - A canonical board encoding plus `finalBoardHash()` (keccak256 via
     viem/`@noble/hashes`, per PRD §11). It replaces both `boardHash()` stubs
     and makes F13's "hash matches ✓" real. **F13 is a Session #1
     prerequisite, so this is the critical engine item.**
   - `ENGINE_VERSION` export.
   - Typed error codes, which retire the message-prefix `classify()`.
   - Remove the `console.log`s in `Grid.createSquares` (L2).
   - Dual ESM+CJS `exports`, required by PRD §11 and working today only
     because Vite pre-bundles.
   - Optional: time-free forfeit helpers (`forfeitDeadline`/`checkClaim`) and
     an exported `normalizePlayerId`.
