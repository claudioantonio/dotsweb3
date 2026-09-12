# Project context

## What this is

`dotsweb3` is the Cartesi Machine backend (`packages/machine`) and web
frontend (`packages/frontend`) for a 1v1 Dots-and-Boxes game running on a
Cartesi rollup. The rules engine that both packages depend on lives in a
separate repo, [`dots-engine`](https://github.com/claudioantonio/dots-engine)
— see that repo's `docs/context.md` and `docs/PRD-v5.md` for the full product
story (session model, matchmaking, determinism requirements).

## Why the engine is a separate repo

The product's core guarantee is that a match's on-chain result and its
browser replay are produced by the *identical* engine code — same npm
package, same version, on both sides. Keeping the engine in its own repo
with its own release cadence makes that boundary a real one: `machine` and
`frontend` install it like any other dependency instead of importing a
sibling directory's source, so there's no way to accidentally patch the
rules on one side only.

Until `dots-engine` is published to a registry, both packages would
otherwise need to pin it independently — `packages/machine`'s `package.json`
currently does this via a git dependency pinned to a commit hash. `frontend`
should do the same once its replay verifier (F13) is built, and the two pins
must always match.

## Repo split

- **`dots-engine`** (separate repo) — pure game rules, no chain or DOM code.
- **`packages/machine`** (here) — runs inside the Cartesi Machine: session
  scheduling, matchmaking queue, forfeit handling. Talks to the rollup
  server's HTTP API; calls into `dots-engine` for every rule decision.
- **`packages/frontend`** (here) — lobby, queue UI, match board, and the
  browser replay viewer. Reads machine state only through the Cartesi node's
  inspect/GraphQL APIs (F9), never by reaching into `packages/machine`
  internals.

## Working here

- If a change feels like a game rule (turn order, scoring, forfeit
  eligibility, hashing), it belongs in `dots-engine`, not here.
- `packages/machine`'s state transitions (queue, session sweep, forfeit
  deadlines) are as replay-sensitive as the engine itself — same care, same
  determinism rules (no wall clock, no randomness, stable iteration order).
- Current build status and the ordered task list live in `dots-engine`'s
  `docs/TODO.md`; this repo doesn't duplicate it.
