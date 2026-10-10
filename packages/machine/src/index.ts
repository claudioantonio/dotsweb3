/**
 * Cartesi Machine entrypoint: the /finish loop only. No logic — dispatches to
 * createApp() and POSTs the outputs it is handed (docs/architecture.md §2).
 */
import { createApp, type App } from "./app";
import { createRollup, type Rollup } from "./rollup";

/** Runs the finish loop until `shouldStop()` returns true (tests only; production never stops). */
export async function runLoop(rollup: Rollup, app: App, shouldStop: () => boolean = () => false): Promise<void> {
    let status: "accept" | "reject" = "accept";
    for (;;) {
        const request = await rollup.finish(status);
        if (request === null) {
            if (shouldStop()) return;
            continue;
        }
        if (request.request_type === "advance_state") {
            const { metadata, payload } = request.data;
            // Raw value logged on purpose: settles the ms-vs-seconds question (task 3).
            console.log(
                `advance input=${metadata.input_index} sender=${metadata.msg_sender} block_timestamp=${metadata.block_timestamp}`,
            );
            const result = app.advance(metadata, payload);
            for (const n of result.notices) await rollup.notice(n);
            for (const r of result.reports) await rollup.report(r);
            status = result.status;
        } else {
            await rollup.report(app.inspect(request.data.payload));
            status = "accept";
        }
    }
}

function main(): Promise<void> {
    const url = process.env.ROLLUP_HTTP_SERVER_URL;
    if (!url) throw new Error("ROLLUP_HTTP_SERVER_URL is not set");
    const owner = process.env.DOTS_OWNER;
    if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(owner)) throw new Error("DOTS_OWNER must be set to the owner address");
    return runLoop(createRollup(url), createApp({ owner: owner.toLowerCase() }));
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
