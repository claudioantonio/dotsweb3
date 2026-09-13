# @dotsweb3/frontend

Lobby, matchmaking queue UI, match board, and browser replay viewer.

## Status

Vite + React + TypeScript + Chakra UI. Currently a local-only 6×6 board:
two-click edge selection validated by `dots-engine` (same version pin as
`packages/machine`), no wallet, InputBox, inspect, queue, or lobby yet.

```
npm run dev -w @dotsweb3/frontend
```

Talks to `packages/machine` only through the Cartesi node's
inspect/GraphQL read APIs (F9) — never by importing machine internals.

Requirements are tracked in [`docs/PRD-v5.md`](../../docs/PRD-v5.md) §7 (F10-F15).
