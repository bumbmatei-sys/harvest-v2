import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleWorker } from "./bundle-worker";
import { runProbes } from "./run-probes";

type LocalRuntime = {
  dispatchFetch: (url: string, init: RequestInit) => Promise<Response>;
  dispose: () => Promise<void>;
};
const entry = process.env.CF02_MINIFLARE_MODULE;
if (!entry || !entry.startsWith("/")) throw new Error("Set CF02_MINIFLARE_MODULE to the absolute path of an offline-installed Miniflare package entry");
const { Miniflare, convertV4MiniflareOptions } = await import(entry) as {
  Miniflare: new (options: object) => LocalRuntime;
  convertV4MiniflareOptions: (options: object) => object;
};
delete process.env.TEST_DATABASE_URL;

const directory = await mkdtemp(join(tmpdir(), "harvest-cf02-worker-"));
const scriptPath = await bundleWorker(directory, true).catch(async (error) => {
  await rm(directory, { recursive: true, force: true });
  throw error;
});
let fixture: Awaited<ReturnType<typeof import("../database").testDatabase>> | undefined;
let runtime: LocalRuntime | undefined;
try {
  const { testDatabase } = await import("../database");
  fixture = await testDatabase({ migrationOwner: true });
  const database = decodeURIComponent(new URL(fixture.appURL).pathname.slice(1));
  const token = randomBytes(36).toString("base64url");
  let otp: string | undefined;
  let deliveries = 0;
  runtime = new Miniflare(convertV4MiniflareOptions({
    cf: false, host: "127.0.0.1", scriptPath, modules: true, modulesRoot: directory, compatibilityDate: "2026-11-17", compatibilityFlags: ["nodejs_compat"],
    hyperdrives: { APP_HYPERDRIVE: fixture.appURL, WORKER_HYPERDRIVE: fixture.workerURL },
    bindings: { CF02_PROBE_TOKEN: token, CF02_AUTH_SECRET: randomBytes(48).toString("base64url"),
      RESEND_API_KEY: "fixture", EMAIL_FROM: "test@example.invalid" },
    serviceBindings: { MAILBOX: async (request: Request) => {
      deliveries += 1;
      otp = (await request.text()).match(/\b\d{6}\b/)?.[0];
      return new Response();
    } },
  }));
  const current = runtime;
  await runProbes(async (request) => current.dispatchFetch(request.url, {
    method: request.method, headers: request.headers, body: await request.text(), signal: request.signal,
  }), "http://localhost", token, [database, database], true);

  // Repeat the same real route sequence as CF-01 without resetting workerd.
  const origin = "http://localhost";
  const email = `${randomUUID()}@example.invalid`;
  const headers = { origin, "content-type": "application/json", "x-forwarded-for": "192.0.2.1" };
  const issue = await current.dispatchFetch(`${origin}/api/auth/email-otp/send-verification-otp`,
    { method: "POST", headers, body: JSON.stringify({ email, type: "sign-in" }) });
  assert.equal(issue.status, 200);
  await issue.text();
  assert.equal(deliveries, 1);
  assert.ok(otp);
  const verify = await current.dispatchFetch(`${origin}/api/auth/sign-in/email-otp`,
    { method: "POST", headers, body: JSON.stringify({ email, otp }) });
  assert.equal(verify.status, 200);
  const cookie = verify.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  await verify.text();
  assert.ok(cookie);
  const workspace = await current.dispatchFetch(`${origin}/api/workspaces`, { headers: { cookie } });
  assert.equal(workspace.status, 200);
  assert.deepEqual(await workspace.json(), []);
  console.log("PASS reused-isolate OTP issue / sign-in / authenticated workspace (200 / 200 / 200)");

  // The timeoutAbort probe's pg_sleep(3) keeps running on the server after the client aborts and closes its socket;
  // PostgreSQL ends it only when the statement finishes. Wait for it to drain instead of racing it.
  const active = async () => (await fixture!.admin.query<{ active: number }>(`
    select count(*)::int as active from pg_stat_activity where datname = current_database()
      and usename in ('harvest_app', 'harvest_worker') and state is distinct from 'idle'`)).rows[0].active;
  let busy = await active();
  for (let attempt = 0; busy > 0 && attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    busy = await active();
  }
  assert.equal(busy, 0, "No app or worker sessions should be active after probes");
} finally {
  try {
    await runtime?.dispose();
    if (fixture) {
      // PostgreSQL ends a backend asynchronously after its client socket closes, so allow it a moment (as the integration suite does).
      const remaining = async () => (await fixture!.admin.query<{ count: number }>(`
        select count(*)::int as count from pg_stat_activity where datname = current_database()
          and usename in ('harvest_app', 'harvest_worker')`)).rows[0].count;
      let count = await remaining();
      for (let attempt = 0; count > 0 && attempt < 30; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        count = await remaining();
      }
      assert.equal(count, 0, "No app or worker connections should remain after disposing the local runtime");
    }
  } finally {
    try { await fixture?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}
