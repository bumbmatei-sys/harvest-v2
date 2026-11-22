import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { build } from "esbuild";
import { testDatabase } from "../database";

type LocalRuntime = {
  dispatchFetch(url: string, request?: RequestInit): Promise<Response>;
  getQueueProducer(name: string): Promise<{ send(body: unknown): Promise<void> }>;
  dispose(): Promise<void>;
};

const modulePath = process.env.CF04_MINIFLARE_MODULE;
if (!modulePath?.startsWith("/")) throw new Error("Set an absolute CF04_MINIFLARE_MODULE path");
delete process.env.TEST_DATABASE_URL;

// Forward neither fixture binding values nor raw runtime errors to the terminal.
const stdout = process.stdout.write;
const stderr = process.stderr.write;
process.stdout.write = (() => true) as typeof stdout;
process.stderr.write = (() => true) as typeof stderr;
const fixtures: Awaited<ReturnType<typeof testDatabase>>[] = [];
const runtimes: LocalRuntime[] = [];
let step = "bundle";
let result = "";
try {
  const [{ Miniflare, Log, convertV4MiniflareOptions }, { outputFiles: [output] }] = await Promise.all([
    import(modulePath) as Promise<{
      Miniflare: new (options: object) => LocalRuntime;
      Log: new (level: number) => unknown;
      convertV4MiniflareOptions(options: object): object;
    }>,
    build({ entryPoints: ["tests/cf04/worker.ts"], bundle: true, write: false, platform: "node", format: "esm",
      conditions: ["workerd"], external: ["cloudflare:*", "pg-native"],
      banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
      plugins: [{
        name: "server-only-worker",
        setup(builder) {
          builder.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "cf04" }));
          builder.onLoad({ filter: /.*/, namespace: "cf04" }, () => ({ contents: "export {}" }));
        },
      }] }),
  ]);

  step = "embedded PostgreSQL";
  const fixture = await testDatabase({ migrationOwner: true });
  fixtures.push(fixture);
  const key = randomBytes(32).toString("hex");
  function runtime(connectionString?: string, appBinding?: string, directLoopback = false) {
    const instance = new Miniflare(convertV4MiniflareOptions({
      cf: false, host: "127.0.0.1", script: output.text, modules: true, compatibilityDate: "2026-11-19",
      compatibilityFlags: ["nodejs_compat"], log: new Log(0),
      bindings: { HARVEST_ENV: "local", HARVEST_SOCIAL_PUBLISHER: "test", HARVEST_CONNECT_TEST_KEY: key, NODE_ENV: "test",
        HARVEST_CONNECT_INTAKE: "synthetic", HARVEST_CHAT_PURGE_WORKER_ENABLED: "1", HARVEST_NEWSLETTER_RETENTION_ENABLED: "1",
        ...(directLoopback ? { WORKER_HYPERDRIVE: { connectionString } } : {}) },
      hyperdrives: { ...(connectionString && !directLoopback ? { WORKER_HYPERDRIVE: connectionString } : {}),
        ...(appBinding ? { APP_HYPERDRIVE: appBinding } : {}) },
      queueProducers: { JOB_QUEUE: "cf04-jobs", JOB_DEAD_LETTERS: "cf04-dead" },
      queueConsumers: { "cf04-jobs": { maxBatchTimeout: 0, maxRetries: 4 }, "cf04-dead": { maxBatchTimeout: 0 } },
    }));
    runtimes.push(instance);
    return instance;
  }
  const worker = runtime(fixture.workerURL, undefined, true);
  async function call(instance: LocalRuntime, path: string, body?: unknown) {
    const response = await instance.dispatchFetch(`http://127.0.0.1${path}`,
      body ? { method: "POST", body: JSON.stringify(body) } : undefined);
    if (response.status !== 204) {
      const code = await response.text();
      throw new Error(/^(?:[A-Z_]+|\d+:\d+)$/.test(code) ? code : "WORKER_RESPONSE_INVALID");
    }
  }

  step = "cron, production guards, dedupe, retries and poison";
  await call(worker, "/checks");
  assert.equal((await fixture.admin.query("select count(*)::int as total from public.worker_job_receipts")).rows[0].total, 1);
  assert.equal((await fixture.admin.query("select count(*)::int as total from public.connect_retention_runs")).rows[0].total, 1);

  step = "local Queue binding and consumer";
  await (await worker.getQueueProducer("JOB_QUEUE")).send({ extra: "poison" });
  await call(worker, "/native/enqueue");
  let nativeComplete = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const dlq = await (await worker.dispatchFetch("http://127.0.0.1/native/dead")).json();
    const { rows: [{ total }] } = await fixture.admin.query("select count(*)::int as total from public.connect_retention_runs");
    if (Array.isArray(dlq) && dlq.length === 1 && total === 2) {
      assert.deepEqual(dlq, [{ reason: "invalid_dispatch" }]);
      nativeComplete = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(nativeComplete);

  step = "worker credential scope";
  await call(runtime(fixture.appURL), "/role");
  await call(runtime(undefined, fixture.appURL), "/role");
  const hyperdrive = runtime(fixture.workerURL);
  await fixture.admin.query("alter role harvest_worker createdb");
  try {
    await call(hyperdrive, "/role");
  } finally {
    await fixture.admin.query("alter role harvest_worker nocreatedb");
  }
  assert.equal((await fixture.admin.query("select count(*)::int as total from public.worker_job_receipts")).rows[0].total, 2);

  step = "hard-off retention port using local fixtures";
  await call(worker, "/retention");
  assert.equal((await fixture.admin.query("select count(*)::int as total from public.worker_job_receipts")).rows[0].total, 7);

  step = "lease contention, recovery and stale fence";
  await call(hyperdrive, "/lease/start");
  await fixture.admin.query("update public.worker_job_leases set expires_at = clock_timestamp() - interval '1 second'");
  await call(hyperdrive, "/lease/recover");

  step = "seed grouped social publish, inbox reply and analytics";
  const hook = registerHooks({ resolve: (name, context, next) => name === "server-only"
    ? { url: "data:text/javascript,export%20{}", shortCircuit: true } : next(name, context) });
  const { users } = await import("../../src/db/schema");
  const { createWorkspace } = await import("../../src/server/workspaces");
  const { createTestKeyProvider, useKeyProvider: setFixtureKeys } = await import("../../src/server/connect-key-provider");
  const { socialRouteDeps, SOCIAL_TEST_CREDENTIAL } = await import("../../src/server/social-publish-gate");
  const { linkConnection } = await import("../../src/server/social/service");
  const { saveDraft, changeDraft } = await import("../../src/server/social/drafts");
  const { listInbox } = await import("../../src/server/social/inbox-read");
  const { submitInboxReply } = await import("../../src/server/social/inbox-reply");
  const { createReplyHandoff, handoffKey } = await import("../../src/server/social/inbox-reply-handoff");
  hook.deregister();
  setFixtureKeys(createTestKeyProvider({ keys: () => ({ "test-1": key }), current: "test-1" }));
  const deps = socialRouteDeps({ NODE_ENV: "test" });
  const owner = "cf04-owner";
  await fixture.db.insert(users).values({ id: owner, name: "Fixture", email: "owner@example.test", emailVerified: true });
  const { tenantId } = await createWorkspace(fixture.db, owner, "CF-04 fixture");
  const { connection } = await linkConnection(fixture.db, owner, tenantId,
    { provider: "fake", accountRef: "test-facebook", credential: SOCIAL_TEST_CREDENTIAL }, deps);
  const { draft } = await saveDraft(fixture.db, owner, tenantId,
    { type: "post", content: "Synthetic post", connectionIds: [connection.id] }, deps);
  const review = await changeDraft(fixture.db, owner, tenantId, draft.id, { action: "review", version: draft.version }, deps);
  await changeDraft(fixture.db, owner, tenantId, draft.id,
    { action: "publishNow", version: review.draft.version, reviewToken: review.review!.token, timezone: "UTC" }, deps);
  const { items: [item] } = await listInbox(fixture.db, owner, tenantId, { kind: "dm", account: connection.id }, deps);
  const handoff = createReplyHandoff();
  const id = randomUUID();
  await submitInboxReply(fixture.db, owner, tenantId, item.id, { id, mode: "message", text: "Synthetic reply" },
    { enabled: true, social: deps, handoff });

  step = "run fake social jobs in workerd";
  await call(worker, "/social", handoff.read(handoffKey(tenantId, id)));
  const { rows: [outcomes] } = await fixture.admin.query(`
    select (select count(*)::int from public.social_posts where status='published') as posts,
      (select count(*)::int from public.social_inbox_replies where state='confirmed') as replies,
      (select count(*)::int from public.social_analytics_posts where provider_ref='fixture-analytics') as analytics`);
  assert.deepEqual(outcomes, { posts: 1, replies: 1, analytics: 1 });
  result = "CF-04 workerd probe passed. Cron routing, production guards, queue dispositions and local bindings, role scope, lease recovery, and three fake social jobs.";
} catch (error) {
  const code = error instanceof Error && /^(?:[A-Z_]+|\d+:\d+)$/.test(error.message) ? ` (${error.message})` : "";
  result = `CF-04 workerd probe failed during ${step}${code}.`;
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled(runtimes.map(runtime => runtime.dispose()));
  for (const fixture of fixtures) cleanup.push(...await Promise.allSettled([fixture.close()]));
  if (cleanup.some(item => item.status === "rejected")) {
    result += " Fixture cleanup failed.";
    process.exitCode = 1;
  }
  process.stdout.write = stdout;
  process.stderr.write = stderr;
  console.info(result);
}
