import {
  decodeInspectResponse,
  encodeInspectQuery,
  type InspectData,
  type InspectQuery,
  type InspectRoute,
} from "@dotsweb3/protocol";

export class InspectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectError";
  }
}

type QueryFor<R extends InspectRoute> = Extract<InspectQuery, { route: R }>;

export type Inspect = <R extends InspectRoute>(query: QueryFor<R>) => Promise<InspectData[R]>;

/**
 * POST <inspectUrl> with body JSON.stringify(query). The node answers
 * `{ status, reports: [{payload}], … }`; the machine always emits exactly one
 * report holding an InspectResponse (architecture §1.1).
 */
export function createInspect(inspectUrl: string, fetchFn: typeof fetch = fetch): Inspect {
  return async function inspect<R extends InspectRoute>(query: QueryFor<R>): Promise<InspectData[R]> {
    const res = await fetchFn(inspectUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: encodeInspectQuery(query),
    });
    if (!res.ok) throw new InspectError(`inspect ${query.route}: HTTP ${res.status}`);
    const body = (await res.json()) as { status?: string; reports?: { payload: string }[] };
    const payload = body.reports?.[0]?.payload;
    if (!payload) throw new InspectError(`inspect ${query.route}: no report (status ${body.status ?? "?"})`);
    const response = decodeInspectResponse<R>(payload);
    if (!response.ok) throw new InspectError(`inspect ${query.route}: ${response.code} ${response.message}`);
    return response.data;
  };
}
