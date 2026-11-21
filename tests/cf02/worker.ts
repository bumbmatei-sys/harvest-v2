import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { databases, isolationCases, seedIsolation, type IsolationCase } from "./isolation";
import { isolationRuntime } from "./runtime";

type Env = {
  APP_HYPERDRIVE: { connectionString: string };
  WORKER_HYPERDRIVE: { connectionString: string };
  CF02_PROBE_TOKEN: string;
  CF02_AUTH_SECRET: string;
};

const fixtureSchema = z.object({ a: z.uuid(), b: z.uuid(), ids: z.object({ a: z.uuid(), b: z.uuid(), member: z.uuid() }) });
let isolateId: string | undefined;
const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const supplied = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${env.CF02_PROBE_TOKEN}`);
    if (request.method !== "POST" || !env.CF02_PROBE_TOKEN || env.CF02_PROBE_TOKEN.length < 32 ||
        !env.CF02_AUTH_SECRET || env.CF02_AUTH_SECRET.length < 32 || expected.length !== supplied.length ||
        !timingSafeEqual(supplied, expected)) return new Response(null, { status: 404 });
    const operation = new URL(request.url).pathname.slice(1);
    const runtime = isolationRuntime(
      { runtime: "workers", role: "app", APP_HYPERDRIVE: env.APP_HYPERDRIVE },
      { runtime: "workers", role: "worker", WORKER_HYPERDRIVE: env.WORKER_HYPERDRIVE }, env.CF02_AUTH_SECRET, request.signal,
    );
    isolateId ??= randomUUID();
    try {
      let result: unknown;
      if (operation === "databases") result = await databases(runtime);
      else if (operation === "seed") result = await seedIsolation(runtime);
      else if (Object.hasOwn(isolationCases, operation)) {
        await isolationCases[operation as IsolationCase](runtime, fixtureSchema.parse(await request.json()));
      } else return new Response(null, { status: 404 });
      return Response.json({ result, isolateId }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      // Keep provider/driver error strings, fixture IDs and SQL parameters out of the response.
      return Response.json({ type: error instanceof Error ? error.name : "Error" },
        { status: 500, headers: { "cache-control": "no-store" } });
    }
  },
};

export default worker;
