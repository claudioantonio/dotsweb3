# AGENTS.md

Monorepo: Cartesi Machine backend (`packages/machine`) + web frontend
(`packages/frontend`) for the Dots game. Game rules live in the separate
[`dots-engine`](https://github.com/claudioantonio/dots-engine) repo, pulled
in as a dependency — never copy its source in here.

## Commands

- `npm install` — install all workspaces
- `npm run build` / `npm test` / `npm run lint` — run across all workspaces
- Per-package: `npm run <script> -w @dotsweb3/machine` (or `-w @dotsweb3/frontend`)

## Layout

- `packages/machine/` — advance/inspect loop against the Cartesi rollup HTTP
  API; owns session/queue/forfeit state. See its README for the
  `dots-engine` version-pinning discipline.
- `packages/frontend/` — no framework chosen yet.
- `docs/context.md` — why this repo is split this way.

## Conventions

- `dots-engine` is consumed as a locked dependency by both packages — bump
  its pin deliberately, and never diverge the version between `machine` and
  `frontend` (the whole replay/hash verification story depends on both
  running the identical engine).
- No engine rules logic belongs in this repo — if you're tempted to
  reimplement or patch game logic here, it belongs in `dots-engine` instead.
- `packages/machine` follows the same determinism rules as the engine (no
  `Date.now`/`Math.random`, stable iteration order) — enforced by its
  `eslint.config.mjs`.
