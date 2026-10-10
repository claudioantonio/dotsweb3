# @dotsweb3/machine

The Cartesi Machine backend: session scheduling, matchmaking queue, and
forfeit handling around [`dots-engine`](https://github.com/claudioantonio/dots-engine),
which owns all actual game rules. Design: `docs/architecture.md` §2; wire
contract: `packages/protocol`.

```
src/index.ts          /finish loop only (logs raw block_timestamp per advance)
src/rollup.ts         fetch client for /finish, /notice, /report
src/app.ts            createApp(cfg) → { advance, inspect }; timeOf(meta)
src/router.ts         decode → handler; Reject → Rejected report; other throws → ENGINE_ERROR
src/state.ts          State + initialState()
src/session.ts        scheduleSession (owner, validation, sweep, queue clear)
src/queue.ts          joinQueue / leaveQueue / pairing
src/match.ts          move / claimForfeit / MatchEnded builder
src/inspect.ts        read-only views
src/engine-adapter.ts the only importer of dots-engine (TODO-engine stubs)
```

Talks to the rollup server over its HTTP API (`ROLLUP_HTTP_SERVER_URL`).
Config: `DOTS_OWNER` (session owner address; the Dockerfile defaults it to
Anvil account #0 for local devnet only — override for any real deployment).

## Time

`metadata.block_timestamp` is read in exactly one place, `timeOf()` in
`src/app.ts`, which returns integer unix seconds (values ≥ 1e12 are treated
as ms). Everything on the wire is seconds.

## Build / run in a Cartesi Machine (cartesi CLI 2.0.0-alpha)

Run from this directory. `cartesi.toml` points the Docker build at the repo
root (the image needs the protocol workspace and the root lockfile).

```sh
cartesi build
cartesi run            # local Anvil devnet + node
cartesi send --encoding string '{"type":"joinQueue"}'
```

## The `dots-engine` dependency

Pinned to an exact npm version (`0.1.0-alpha.0`). Bump deliberately, in the
same commit as `packages/frontend`, and update `ENGINE_VERSION` in
`src/engine-adapter.ts` (a test asserts they match) — both packages must run
the *identical* engine.

### Local devnet notes (verified 2026-10-10)

- If the host has an old `cartesi-machine` (e.g. 0.18.x in `/usr/bin`), the
  CLI uses it and `cartesi build` fails (`unknown option "data_filename"`),
  and `cartesi run` hangs on "machine snapshot not found". Either uninstall
  it, or put shims first on `PATH` for both `cartesi-machine` and
  `cartesi-machine-stored-hash` that run the SDK image's binaries:
  `exec docker run --rm -v "$PWD:$PWD" -w "$PWD" --user "$(id -u):$(id -g)" cartesi/sdk:0.12.0-alpha.41 <tool> "$@"`.
- `cartesi send` is interactive; from scripts use
  `cast send <InputBox> "addInput(address,bytes)" <app> <hex>` against
  `http://127.0.0.1:6751/anvil`.
- Inspect: `curl -X POST http://127.0.0.1:6751/inspect/<project> -d '{"route":"session"}'`
  (raw body, no wrapper).
- `block_timestamp` arrives in **seconds**.
- Reports emitted on a **rejected** advance are not returned by
  `cartesi_listReports` on this node version — which is why declined inputs
  finish "accept" with a Rejected report (architecture §1.4).
