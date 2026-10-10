# @dotsweb3/frontend

Lobby, matchmaking queue, match board, spectate and replay for the Dots game.
Vite + React 19 + Chakra UI v3 + wagmi/viem + react-query + react-router.
Design: [`docs/architecture.md`](../../docs/architecture.md) §3, screens in
[`docs/ux-plan.md`](../../docs/ux-plan.md).

## Run

```
cp packages/frontend/.env.example packages/frontend/.env.devnet   # fill in from `cartesi run` / `cartesi address-book`
npm run dev -w @dotsweb3/frontend -- --mode devnet
npm test -w @dotsweb3/frontend      # vitest
npm run build -w @dotsweb3/frontend
```

Only `.env.example` is committed. Without a mode env file the app renders a
"not configured" page listing the missing variables. If the node sends no
CORS headers, set `NODE_PROXY_TARGET` (dev server only) and use relative
`/rpc` and `/inspect/<app>` URLs — see `.env.example`.

## Layout

- `src/config.ts` — validated `import.meta.env`
- `src/cartesi/` — InputBox `addInput` (`inputBox.ts`), JSON-RPC client
  (`rpc.ts`), inspect (`inspect.ts`), the one app-wide notice poller
  (`notices.ts`, 2.5 s, cursor = output offset), `awaitInput` (`inputStatus.ts`)
- `src/state/` — pure reducers: match view from inspect + notices, live list,
  session/player phase, pending-move reconciliation, replay driver;
  `__fixtures__` are protocol-typed fixtures for working without a machine
- `src/copy/rejections.ts` — reason code → user copy, forfeit-race detection
- `src/engine-adapter.ts` — the **only** importer of `dots-engine`
  (rebuild/replay via `play()`; `// TODO-engine:` stubs for hash + version)
- `src/screens/` — Lobby, ConnectModal, Queue, Match (+ Spectate), Result, Replay, Practice
- `src/tx.tsx` — one in-flight input at a time, rejection toasts

The wire contract comes from `@dotsweb3/protocol` (its `dist` must be built:
`npm run build -w @dotsweb3/protocol`, or the root `npm run build`).
