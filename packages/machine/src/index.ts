/**
 * Cartesi Machine backend entrypoint (Rollups HTTP API — advance/inspect
 * loop against the rollup server's /finish endpoint). This process owns
 * session scheduling, matchmaking, and forfeit handling; all actual game
 * rules are delegated to `dots-engine`, imported as a locked dependency —
 * never copied source (see dots-engine's docs/PRD-v5.md §11).
 */

const rollupServer = process.env.ROLLUP_HTTP_SERVER_URL;
if (!rollupServer) {
    throw new Error("ROLLUP_HTTP_SERVER_URL is not set");
}

// Shapes below match the Rollup HTTP API's OpenAPI spec
// (github.com/cartesi/openapi-interfaces, rollup.yaml) as of Rollups 2.0.
// Notably: there is no plain `timestamp` field — it's `block_timestamp`, in
// *milliseconds* — and inspect requests carry no metadata at all.

interface AdvanceMetadata {
    chain_id: number;
    app_contract: string;
    msg_sender: string;
    input_index: number;
    block_number: number;
    /** Unix timestamp of the block, in milliseconds. */
    block_timestamp: number;
    prev_randao: string;
}

type RollupRequest =
    | { request_type: "advance_state"; data: { metadata: AdvanceMetadata; payload: string } }
    | { request_type: "inspect_state"; data: { payload: string } };

function hexToUtf8(hex: string): string {
    return Buffer.from(hex.replace(/^0x/, ""), "hex").toString("utf8");
}

function utf8ToHex(text: string): string {
    return "0x" + Buffer.from(text, "utf8").toString("hex");
}

async function report(payload: string): Promise<void> {
    await fetch(`${rollupServer}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: utf8ToHex(payload) }),
    });
}

/**
 * Handles a game input: joinQueue, leaveQueue, move, claimForfeit,
 * scheduleSession. See dots-engine's docs/TODO.md §3-7 for the state
 * machine this must implement; nothing here is built out yet.
 */
async function handleAdvance(data: { metadata: AdvanceMetadata; payload: string }): Promise<"accept" | "reject"> {
    const { metadata, payload } = data;
    const body = JSON.parse(hexToUtf8(payload));
    console.log("advance_state", { metadata, body });

    // TODO: route body.type to session/queue/move/forfeit handling, using
    // dots-engine's Dots class for all rules and the move log. Any timing
    // decision (forfeit deadlines, session windows) must use
    // metadata.block_timestamp — never Date.now() — per the engine's
    // determinism rules; convert from milliseconds as needed.

    await report(`received: ${JSON.stringify(body)}`);
    return "accept";
}

/**
 * Handles a read-only query (state, queue position, session window,
 * history) per dots-engine's docs/PRD-v5.md F9. Nothing here is built
 * out yet. Inspect requests carry no metadata, and the Rollup HTTP Server
 * ignores whatever status /finish is next called with after one.
 */
async function handleInspect(data: { payload: string }): Promise<void> {
    const { payload } = data;
    const query = hexToUtf8(payload);
    console.log("inspect_state", { query });

    await report(`no handler for query: ${query}`);
}

async function main(): Promise<void> {
    let status: "accept" | "reject" = "accept";

    for (;;) {
        const finishResponse = await fetch(`${rollupServer}/finish`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
        });

        if (finishResponse.status === 202) {
            console.log("no pending rollup request, retrying");
            continue;
        }

        const rollupRequest = (await finishResponse.json()) as RollupRequest;

        if (rollupRequest.request_type === "advance_state") {
            status = await handleAdvance(rollupRequest.data);
        } else {
            await handleInspect(rollupRequest.data);
            status = "accept";
        }
    }
}

main();
