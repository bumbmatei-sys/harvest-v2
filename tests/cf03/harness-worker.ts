import { timingSafeEqual } from "node:crypto";
import { WorkerEntrypoint } from "cloudflare:workers";
import { withDb, type DatabaseEnvironment } from "../../src/db/request";
import { createCatalogItem, enrolInCatalogItem, setCatalogState } from "../../src/server/free-catalog";
import { createWorkspace, putMember } from "../../src/server/workspaces";

// CF-03 staging harness only: a synthetic mailbox for the fixture's MAILBOX service binding, and the seed steps the
// local run performs directly in Node. It is deployed next to the staging fixture for one test and deleted afterwards.
// The mailbox is the named `Mailbox` entrypoint, reachable only through the service binding; the public fetch handler
// serves only the token-guarded operations and refuses to run unless HARVEST_ENV is "staging".
type Bucket = {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string, options?: { onlyIf?: { etagDoesNotMatch: string } }): Promise<unknown>;
  delete(key: string): Promise<void>;
};
type Env = {
  APP_HYPERDRIVE: { connectionString: string };
  APP_DATABASE_NAME: string;
  CODES: Bucket;
  HARNESS_TOKEN: string;
  HARVEST_ENV: string;
};

const synthetic = (to: unknown): to is string => typeof to === "string" && /^[0-9a-f-]{36}@example\.invalid$/.test(to);

function authorized(request: Request, env: Env) {
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${env.HARNESS_TOKEN}`);
  return env.HARNESS_TOKEN?.length >= 32 && supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export class Mailbox extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    // The fixture's Resend stand-in posts here. Only synthetic recipients are accepted, and each code is written once.
    if (request.method !== "POST" || this.env.HARVEST_ENV !== "staging") return new Response(null, { status: 404 });
    const { to, text } = await request.json() as { to?: unknown; text?: unknown };
    const code = typeof text === "string" ? /\b\d{6}\b/.exec(text)?.[0] : undefined;
    if (!synthetic(to) || !code) return new Response(null, { status: 400 });
    await this.env.CODES.put(`code/${to}`, code, { onlyIf: { etagDoesNotMatch: "*" } });
    return new Response(null, { status: 204 });
  }
}

const harness = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (env.HARVEST_ENV !== "staging") return new Response(null, { status: 404 });
    if (request.method !== "POST" || !authorized(request, env)) return new Response(null, { status: 404 });
    const input = await request.json() as Record<string, string>;
    if (path === "/code") {
      if (!synthetic(input.to)) return new Response(null, { status: 400 });
      const stored = await env.CODES.get(`code/${input.to}`);
      await env.CODES.delete(`code/${input.to}`);
      return json({ code: stored ? await stored.text() : null });
    }
    const database: DatabaseEnvironment = { runtime: "workers", role: "app", APP_HYPERDRIVE: env.APP_HYPERDRIVE, database: env.APP_DATABASE_NAME };
    try {
      const result = await withDb(database, async (db, connection) => {
        if (path === "/workspace") return { tenantId: (await createWorkspace(db, input.user, input.name)).tenantId };
        if (path === "/member") { await putMember(db, input.actor, input.tenant, input.email, "member"); return {}; }
        if (path === "/catalog") {
          const item = await createCatalogItem(db, input.user, input.tenant, {
            kind: "download", title: "Fixture download", visibility: "listed", slug: input.slug, fileIds: [input.file],
          });
          await setCatalogState(db, input.user, input.tenant, item.id, { version: 1, state: "published" });
          return {};
        }
        if (path === "/enrol") return enrolInCatalogItem(db, input.user, input.slug);
        if (path === "/session-ip") {
          const { rows } = await connection.query<{ ip: string | null }>("select ip_address as ip from sessions where user_id = $1", [input.user]);
          return { ips: rows.map((row) => row.ip) };
        }
        return undefined;
      });
      return result === undefined ? new Response(null, { status: 404 }) : json(result);
    } catch (error) {
      return json({ type: error instanceof Error ? error.name : "Error" }, 500);
    }
  },
};

export default harness;
