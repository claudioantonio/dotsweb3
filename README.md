# dotsweb3

Monorepo for the decentralized version of Dots game.

- `packages/machine` — runs the game logic inside the Cartesi Machine. Consumes
  [`dots-engine`](https://github.com/claudioantonio/dots-engine) for all game
  rules.
- `packages/frontend` — lobby, matchmaking queue UI, match board, and browser
  replay viewer.

The rules engine lives in its own repo and is consumed here as a dependency.

npm workspaces; see `docs/context.md` for the fuller picture.

## Commands

- `npm install` — install all workspaces
- `npm run build` / `npm test` / `npm run lint` — run across all workspaces
