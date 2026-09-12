# dotsweb3

Monorepo for the Dots game's Cartesi Machine backend and web frontend.

- `packages/machine` — runs inside the Cartesi Machine: session scheduling,
  matchmaking queue, forfeit handling. Consumes
  [`dots-engine`](https://github.com/claudioantonio/dots-engine) for all game
  rules.
- `packages/frontend` — lobby, matchmaking queue UI, match board, and browser
  replay viewer.

The rules engine lives in its own repo and is consumed here as a pinned
dependency, never a copied source tree — see `packages/machine/README.md`
for how that pin works today (pre-npm-publish).

npm workspaces; see `docs/context.md` for the fuller picture and
`dots-engine`'s `docs/PRD-v5.md` for the product spec.

## Commands

- `npm install` — install all workspaces
- `npm run build` / `npm test` / `npm run lint` — run across all workspaces
