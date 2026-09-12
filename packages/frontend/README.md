# @dotsweb3/frontend

Lobby, matchmaking queue UI, match board, and browser replay viewer.

## Status

Placeholder — no framework/bundler chosen yet. Consumes `dots-engine`
directly for the replay verifier (F13): same engine version as
`packages/machine`, loading a match's `history` and re-running it to check
`finalBoardHash`. Talks to `packages/machine` only through the Cartesi node's
inspect/GraphQL read APIs (F9) — never by importing machine internals.

Requirements are tracked in `dots-engine`'s `docs/PRD-v5.md` §7 (F10-F15).
