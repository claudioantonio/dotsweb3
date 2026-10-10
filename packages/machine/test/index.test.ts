import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { decodeInspectResponse, decodeNotice, decodeRejected, encodeAction, utf8ToHex } from "@dotsweb3/protocol";
import { createApp } from "../src/app";
import { runLoop } from "../src/index";
import { createRollup } from "../src/rollup";
import { OWNER, START } from "./helpers";

/** Minimal fake rollup HTTP server: serves scripted requests, records finishes and outputs. */
function fakeRollup(requests: unknown[]) {
    const finishes: string[] = [];
    const notices: string[] = [];
    const reports: string[] = [];
    let served = 0;
    const body = (req: IncomingMessage) =>
        new Promise<{ status?: string; payload?: string }>((resolve) => {
            let s = "";
            req.on("data", (c) => (s += c));
            req.on("end", () => resolve(JSON.parse(s)));
        });
    const server: Server = createServer(async (req, res) => {
        const b = await body(req);
        if (req.url === "/finish") {
            finishes.push(b.status ?? "");
            if (served < requests.length) {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(requests[served++]));
            } else {
                res.writeHead(202);
                res.end();
            }
            return;
        }
        (req.url === "/notice" ? notices : reports).push(b.payload ?? "");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
    });
    return { server, finishes, notices, reports, done: () => served >= requests.length };
}

const meta = (sender: string, i: number) => ({
    chain_id: 31337, app_contract: "0x" + "e".repeat(40), msg_sender: sender, input_index: i,
    block_number: i, block_timestamp: START, prev_randao: "0x00",
});

it("runLoop drives the app against a rollup server", async () => {
    const A = "0x" + "a".repeat(40);
    const B = "0x" + "b".repeat(40);
    const adv = (sender: string, i: number, payload: string) => ({ request_type: "advance_state", data: { metadata: meta(sender, i), payload } });
    const fake = fakeRollup([
        adv(OWNER, 0, encodeAction({ type: "scheduleSession", sessionStart: START, sessionEnd: START + 3600, gridSize: 2, turnTimeout: 10 })),
        adv(A, 1, encodeAction({ type: "joinQueue" })),
        adv(B, 2, encodeAction({ type: "joinQueue" })),
        adv(B, 3, encodeAction({ type: "move", matchId: "1", edge: [[0, 0], [1, 0]] })),
        { request_type: "inspect_state", data: { payload: utf8ToHex(JSON.stringify({ route: "queue" })) } },
    ]);
    await new Promise<void>((r) => fake.server.listen(0, "127.0.0.1", r));
    const port = (fake.server.address() as AddressInfo).port;
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    try {
        await runLoop(createRollup(`http://127.0.0.1:${port}`), createApp({ owner: OWNER }), fake.done);
    } finally {
        log.mockRestore();
        await new Promise((r) => fake.server.close(r));
    }
    // initial accept, then the status of each request in order (inspect → accept).
    // The declined move also finishes "accept" (§1.4) so the node persists its report.
    expect(fake.finishes).toEqual(["accept", "accept", "accept", "accept", "accept", "accept"]);
    expect(fake.notices.map((n) => decodeNotice(n).type)).toEqual(["MatchStarted"]);
    expect(fake.reports).toHaveLength(2);
    expect(decodeRejected(fake.reports[0])).toMatchObject({ code: "NOT_YOUR_TURN", matchId: "1" });
    expect(decodeInspectResponse(fake.reports[1])).toEqual({ ok: true, route: "queue", data: { entries: [] } });
});
