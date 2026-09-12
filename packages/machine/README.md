# @dotsweb3/machine

The Cartesi Machine backend: session scheduling, matchmaking queue, and
forfeit handling around [`dots-engine`](https://github.com/claudioantonio/dots-engine),
which owns all actual game rules.

Talks to the rollup server over its HTTP API (`ROLLUP_HTTP_SERVER_URL`,
advance/inspect via `/finish`) — see `src/index.ts`. Request/response shapes
are taken from Rollups 2.0's OpenAPI spec
(github.com/cartesi/openapi-interfaces, `rollup.yaml`), not assumed: in
particular, advance-state metadata's timing field is `block_timestamp`
(milliseconds), there is no plain `timestamp` field, and inspect-state
requests carry no metadata at all.

## Status

Skeleton only: the advance/inspect loop is wired up, but session/queue/move/
forfeit routing is not implemented. Build order and F-numbers are tracked in
`dots-engine`'s `docs/TODO.md` (§4-9), which is the source of truth for what
this package needs to do.

## The `dots-engine` dependency

`dots-engine` isn't published to a registry yet, so `package.json` pins it to
a specific commit via a git dependency
(`github:claudioantonio/dots-engine#<commit>`). Bump that pin deliberately
when the engine changes — this package and the frontend must run the
*identical* engine version, per the engine's determinism guarantee. Once
`dots-engine` is published to npm, switch this to a normal semver dependency.
