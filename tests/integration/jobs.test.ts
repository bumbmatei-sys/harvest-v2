import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { testDatabase } from "../database";
import * as schema from "../../src/db/schema";
import { auditLogs, externalWebhookEvents, jobs, outboxEvents, users, webhookResourceStates, workspaces } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { withTenant } from "../../src/server/tenancy";
import { appendOutboxEvent, enqueueJob } from "../../src/server/jobs/outbox";
import { claimJob, drainJobs, flushOutbox, listJobs, listWebhookEvents, replayJob, runClaimedJob } from "../../src/server/jobs/service";
import { receiveWebhook } from "../../src/server/webhooks/receiver";
import { MAX_WEBHOOK_BYTES, signSyntheticWebhook } from "../../src/server/webhooks/synthetic";
import type { JobInput } from "../../src/server/jobs/primitives";

let fixture: Awaited<ReturnType<typeof testDatabase>>, tenantA: string, tenantB: string;
let parallelPool: Pool, parallelDb: typeof fixture.db;
const owner = "jobs-alice", other = "jobs-bob", viewer = "jobs-viewer";
const signingKey = "synthetic-only-test-key-with-no-provider-access";
const context = <T>(run: Parameters<typeof withTenant<T>>[4]) => withTenant(fixture.db, owner, tenantA, "jobs:operate", run);
const enqueue = (data: Partial<JobInput> = {}) => context((tx) => enqueueJob(tx, tenantA, { kind: "domain.receipt", idempotencyKey: randomUUID(), payload: {}, ...data }));
const getJob = (id: string) => context(async (tx) => (await tx.select().from(jobs).where(and(eq(jobs.tenantId, tenantA), eq(jobs.id, id))))[0]);
async function expire(id: string) {
  await context((tx) => tx.update(jobs).set({ lockedAt: sql`now() - interval '2 minutes'` }).where(and(eq(jobs.tenantId, tenantA), eq(jobs.id, id))));
}
function signedRequest(event: Record<string, unknown>, connection = "connection-a", extra: Record<string, string> = {}, raw?: string) {
  const body = Buffer.from(raw ?? JSON.stringify(event)), timestamp = String(Math.floor(Date.now() / 1000));
  return new Request("http://localhost/api/integrations/webhook/synthetic", { method: "POST", body, headers: {
    "content-type": "application/json", "x-harvest-connection": connection, "x-harvest-timestamp": timestamp,
    "x-harvest-signature": signSyntheticWebhook(body, connection, signingKey, timestamp), ...extra,
  } });
}
function receive(request: Request, provider = "synthetic") {
  return receiveWebhook(fixture.db, request, provider, [
    { id: "connection-a", tenantId: tenantA, signingKey }, { id: "connection-b", tenantId: tenantB, signingKey },
  ]);
}
const event = (patch: Record<string, unknown> = {}) => ({ id: randomUUID(), resourceId: randomUUID(), sequence: 1, occurredAt: "2026-11-05T12:00:00Z", data: { value: "ready" }, ...patch });
beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values([
    { id: owner, name: "Alice", email: "jobs-alice@example.test" }, { id: other, name: "Bob", email: "jobs-bob@example.test" },
    { id: viewer, name: "Viewer", email: "jobs-viewer@example.test" },
  ]);
  tenantA = (await createWorkspace(fixture.db, owner, "Jobs A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, other, "Jobs B")).tenantId;
  await putMember(fixture.db, owner, tenantA, "jobs-viewer@example.test", "viewer");
  parallelPool = new Pool({ connectionString: fixture.appURL, max: 2 });
  parallelDb = drizzle(parallelPool, { schema });
});
afterAll(async () => { await parallelPool?.end(); await fixture?.close(); });

describe("durable jobs and transactional outbox", () => {
  it("applies the migration twice and enables forced RLS on every new table", async () => {
    const { rows } = await fixture.admin.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1)", [["jobs", "outbox_events", "external_webhook_events", "webhook_resource_states"]]);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });
  it("dedupes repeated/concurrent enqueue and rejects conflicting reuse", async () => {
    const key = randomUUID(), data = { kind: "domain.receipt", idempotencyKey: key, payload: { a: 1, b: { c: 2 } } };
    const [first, duplicate] = await Promise.all([
      enqueue(data), withTenant(parallelDb, owner, tenantA, "jobs:operate", (tx) => enqueueJob(tx, tenantA, { ...data, payload: { b: { c: 2 }, a: 1 } })),
    ]);
    expect(first.id).toBe(duplicate.id);
    await expect(enqueue({ ...data, payload: { a: 2 } })).rejects.toMatchObject({ status: 409 });
    await drainJobs(fixture.db, owner, tenantA, "test");
    expect((await enqueue(data)).status).toBe("succeeded");
    expect((await getJob(first.id)).attempts).toBe(1);
  });
  it("commits/rolls back a domain write and event together, and dedupes dispatch", async () => {
    const key = randomUUID();
    await expect(context(async (tx) => {
      await tx.update(workspaces).set({ name: "Rolled back" }).where(eq(workspaces.tenantId, tenantA));
      await appendOutboxEvent(tx, tenantA, { kind: "domain.receipt", idempotencyKey: key, payload: { type: "test.domain-write" } });
      throw new Error("intentional rollback");
    })).rejects.toThrow("intentional rollback");
    await context(async (tx) => {
      expect(await tx.select().from(outboxEvents).where(eq(outboxEvents.idempotencyKey, key))).toEqual([]);
      expect((await tx.select().from(workspaces))[0].name).toBe("Jobs A");
      const first = await appendOutboxEvent(tx, tenantA, { kind: "domain.receipt", idempotencyKey: key, payload: { type: "test.domain-write" } });
      const again = await appendOutboxEvent(tx, tenantA, { kind: "domain.receipt", idempotencyKey: key, payload: { type: "test.domain-write" } });
      expect(again.id).toBe(first.id);
    });
    await expect(context((tx) => appendOutboxEvent(tx, tenantA, { kind: "domain.receipt", idempotencyKey: key, payload: { changed: true } }))).rejects.toMatchObject({ status: 409 });
    expect(await flushOutbox(fixture.db, owner, tenantA)).toBe(1);
    expect(await flushOutbox(fixture.db, owner, tenantA)).toBe(0);
    await drainJobs(fixture.db, owner, tenantA, "test");
  });
  it("rolls back dispatch if job insertion fails, then dispatches on retry", async () => {
    await context((tx) => appendOutboxEvent(tx, tenantA, { kind: "domain.receipt", idempotencyKey: "dispatch-rollback", payload: {} }));
    await fixture.admin.query("create function test_reject_job() returns trigger language plpgsql as $$ begin raise exception 'test job failure'; end $$");
    await fixture.admin.query("create trigger test_reject_job before insert on jobs for each row execute function test_reject_job()");
    try { await expect(flushOutbox(fixture.db, owner, tenantA)).rejects.toThrow(); }
    finally { await fixture.admin.query("drop trigger test_reject_job on jobs"); }
    expect(await flushOutbox(fixture.db, owner, tenantA)).toBe(1);
    await drainJobs(fixture.db, owner, tenantA, "test");
  });
  it("does not claim future work; concurrent workers skip held job rows", async () => {
    const future = await enqueue({ scheduledFor: new Date(Date.now() + 3_600_000) });
    expect(await claimJob(fixture.db, owner, tenantA, "test")).toBeNull();
    const one = await enqueue(), two = await enqueue();
    let release!: () => void, ready!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<void>((resolve) => { ready = resolve; });
    const blocker = context(async (tx) => {
      await tx.select().from(jobs).where(eq(jobs.id, one.id)).for("update"); ready(); await held;
    });
    await locked;
    let claim;
    try { claim = await claimJob(parallelDb, owner, tenantA, "overlapping-worker"); expect(claim?.id).toBe(two.id); }
    finally { release(); await blocker; }
    expect((await getJob(future.id)).attempts).toBe(0);
    expect(await runClaimedJob(fixture.db, owner, tenantA, claim!)).toEqual({ status: "succeeded" });
    await drainJobs(fixture.db, owner, tenantA, "test");
  });
  it("reclaims expired claims, fences old tokens and commits one effect", async () => {
    const row = await enqueue();
    const old = await claimJob(fixture.db, owner, tenantA, "old-worker"); expect(old?.id).toBe(row.id);
    await expire(row.id);
    expect(await runClaimedJob(fixture.db, owner, tenantA, old!)).toEqual({ status: "stale_claim" });
    const fresh = await claimJob(fixture.db, owner, tenantA, "new-worker"); expect(fresh?.lockToken).not.toBe(old?.lockToken);
    let effects = 0;
    const handler = { "domain.receipt": async () => { effects++; } };
    expect(await runClaimedJob(fixture.db, owner, tenantA, old!, handler)).toEqual({ status: "stale_claim" });
    expect(await runClaimedJob(fixture.db, owner, tenantA, fresh!, handler)).toEqual({ status: "succeeded" });
    expect(await runClaimedJob(fixture.db, owner, tenantA, fresh!, handler)).toEqual({ status: "stale_claim" });
    expect(effects).toBe(1); expect((await getJob(row.id)).attempts).toBe(2);
  });
  it("rolls back partial handler effects, stores safe diagnostics, retries, DLQs and audits replay", async () => {
    const row = await enqueue({ maxAttempts: 2 });
    const failing = { "domain.receipt": async (tx: Parameters<Parameters<typeof context>[0]>[0]) => {
      await tx.update(workspaces).set({ name: "Must roll back" }).where(eq(workspaces.tenantId, tenantA));
      throw new Error("pretend-secret-must-not-be-stored");
    } };
    let claim = await claimJob(fixture.db, owner, tenantA, "test");
    expect(await runClaimedJob(fixture.db, owner, tenantA, claim!, failing)).toEqual({ status: "queued" });
    let stored = await getJob(row.id);
    expect(stored.lastError).toBe("HANDLER_FAILED");
    expect(stored.scheduledFor.getTime() - stored.updatedAt.getTime()).toBe(1000);
    expect(await claimJob(fixture.db, owner, tenantA, "test")).toBeNull();
    await context(async (tx) => {
      expect((await tx.select().from(workspaces))[0].name).toBe("Jobs A");
      await tx.update(jobs).set({ scheduledFor: sql`now()` }).where(eq(jobs.id, row.id));
    });
    claim = await claimJob(fixture.db, owner, tenantA, "test");
    expect(await runClaimedJob(fixture.db, owner, tenantA, claim!, failing)).toEqual({ status: "dead_letter" });
    await replayJob(fixture.db, owner, tenantA, row.id);
    stored = await getJob(row.id); expect(stored.attempts).toBe(2); expect(stored.runAttempts).toBe(0); expect(stored.replayCount).toBe(1);
    await expect(replayJob(fixture.db, owner, tenantA, row.id)).rejects.toMatchObject({ status: 409 });
    const replayed = await claimJob(fixture.db, owner, tenantA, "test");
    expect(replayed?.idempotencyKey).toBe(row.idempotencyKey);
    expect(await runClaimedJob(fixture.db, owner, tenantA, claim!)).toEqual({ status: "stale_claim" });
    await runClaimedJob(fixture.db, owner, tenantA, replayed!);
    await context(async (tx) => expect((await tx.select().from(auditLogs).where(eq(auditLogs.action, "job.replay"))).map((a) => a.targetId)).toContain(row.id));
    await expect(replayJob(fixture.db, owner, tenantA, row.id)).rejects.toMatchObject({ status: 409 });
  });
  it("serializes concurrent runs of the same claim and commits exactly one database effect", async () => {
    const row = await enqueue();
    const claim = await claimJob(fixture.db, owner, tenantA, "concurrent-runners");
    const handler = { "domain.receipt": async (tx: Parameters<Parameters<typeof context>[0]>[0]) => {
      await tx.insert(auditLogs).values({ tenantId: tenantA, actorId: owner, action: "test.job_effect", targetId: row.id });
    } };
    const results = await Promise.all([
      runClaimedJob(fixture.db, owner, tenantA, claim!, handler), runClaimedJob(parallelDb, owner, tenantA, claim!, handler),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["stale_claim", "succeeded"]);
    await context(async (tx) => expect(await tx.select().from(auditLogs).where(and(eq(auditLogs.action, "test.job_effect"), eq(auditLogs.targetId, row.id)))).toHaveLength(1));
  });
  it("recovers the outer transaction after a PostgreSQL handler error", async () => {
    const row = await enqueue({ maxAttempts: 1 });
    const claim = await claimJob(fixture.db, owner, tenantA, "sql-error");
    const failing = { "domain.receipt": async (tx: Parameters<Parameters<typeof context>[0]>[0]) => { await tx.execute(sql`select 1/0`); } };
    expect(await runClaimedJob(fixture.db, owner, tenantA, claim!, failing)).toEqual({ status: "dead_letter" });
    expect(await getJob(row.id)).toMatchObject({ lastError: "HANDLER_FAILED", status: "dead_letter" });
  });
  it("dead-letters an exhausted crashed lease and unknown handlers", async () => {
    const crashed = await enqueue({ maxAttempts: 1 });
    await claimJob(fixture.db, owner, tenantA, "crashed"); await expire(crashed.id);
    expect(await claimJob(fixture.db, owner, tenantA, "recovery")).toBeNull();
    expect(await getJob(crashed.id)).toMatchObject({ status: "dead_letter", lastError: "LEASE_EXPIRED", lockToken: null });
    const unsupported = await enqueue({ kind: "toString", maxAttempts: 1 });
    await drainJobs(fixture.db, owner, tenantA, "test");
    expect(await getJob(unsupported.id)).toMatchObject({ status: "dead_letter", lastError: "UNSUPPORTED_JOB_KIND" });
  });
});

describe("signed webhook audit, dedupe and ordering", () => {
  it("verifies bytes before writing, fails closed and ignores forged workspace headers", async () => {
    const input = event();
    await expect(receive(signedRequest(input, "connection-a", { "x-harvest-signature": "f".repeat(64) }))).rejects.toMatchObject({ status: 401 });
    await expect(receive(signedRequest(input, "missing"))).rejects.toMatchObject({ status: 404 });
    await expect(receive(signedRequest(input), "real-provider")).rejects.toMatchObject({ status: 404 });
    await expect(receive(signedRequest(input, "connection-a", { "x-harvest-timestamp": "1000000000" }))).rejects.toMatchObject({ status: 401 });
    expect((await listWebhookEvents(fixture.db, owner, tenantA)).rows).toEqual([]);
    const raw = JSON.stringify(input, null, 2);
    expect(await receive(signedRequest(input, "connection-a", { "x-harvest-workspace": tenantB }, raw))).toEqual({ accepted: true, duplicate: false });
    await context(async (tx) => {
      const [stored] = await tx.select().from(externalWebhookEvents);
      expect(stored.rawBody).toBe(raw); expect(stored.tenantId).toBe(tenantA);
    });
    expect((await listWebhookEvents(fixture.db, other, tenantB)).rows).toEqual([]);
  });
  it("rejects oversized/malformed/unsupported payloads without audit writes", async () => {
    await expect(receive(signedRequest({}, "connection-a", {}, "x".repeat(MAX_WEBHOOK_BYTES + 1)))).rejects.toMatchObject({ status: 413 });
    await expect(receive(signedRequest({}, "connection-a", {}, "{"))).rejects.toBeInstanceOf(SyntaxError);
    await expect(receive(signedRequest(event({ sequence: -1 })))).rejects.toThrow();
    await expect(receive(signedRequest(event(), "connection-a", { "content-type": "text/plain" }))).rejects.toMatchObject({ status: 415 });
    expect((await listWebhookEvents(fixture.db, owner, tenantA)).rows).toHaveLength(1);
  });
  it("dedupes concurrent provider IDs, atomically persists outbox, and rejects conflicting reuse", async () => {
    const input = event();
    const connection = [{ id: "connection-a", tenantId: tenantA, signingKey }];
    const results = await Promise.all([receive(signedRequest(input)), receiveWebhook(parallelDb, signedRequest(input), "synthetic", connection)]);
    expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
    await expect(receive(signedRequest({ ...input, data: { value: "changed" } }))).rejects.toMatchObject({ status: 409 });
    await context(async (tx) => {
      const rows = await tx.select().from(externalWebhookEvents).where(eq(externalWebhookEvents.providerEventId, input.id));
      expect(rows).toHaveLength(1);
      expect(await tx.select().from(outboxEvents).where(eq(outboxEvents.idempotencyKey, `webhook:${rows[0].id}`))).toHaveLength(1);
    });
    await fixture.admin.query("create function test_reject_outbox() returns trigger language plpgsql as $$ begin raise exception 'test outbox failure'; end $$");
    await fixture.admin.query("create trigger test_reject_outbox before insert on outbox_events for each row execute function test_reject_outbox()");
    const rolledBack = event();
    try { await expect(receive(signedRequest(rolledBack))).rejects.toThrow(); }
    finally { await fixture.admin.query("drop trigger test_reject_outbox on outbox_events"); }
    await context(async (tx) => expect(await tx.select().from(externalWebhookEvents).where(eq(externalWebhookEvents.providerEventId, rolledBack.id))).toEqual([]));
  });
  it("applies only increasing resource sequences, with equal/older events and duplicates retained", async () => {
    const resourceId = randomUUID(), newer = event({ resourceId, sequence: 20, data: { value: "newer" } });
    await receive(signedRequest(newer));
    await drainJobs(fixture.db, owner, tenantA, "test");
    for (const sequence of [19, 20, 1]) await receive(signedRequest(event({ resourceId, sequence, data: { value: "stale" } })));
    await drainJobs(fixture.db, owner, tenantA, "test");
    await receive(signedRequest(newer));
    await context(async (tx) => {
      const [state] = await tx.select().from(webhookResourceStates).where(eq(webhookResourceStates.resourceId, resourceId));
      expect(state).toMatchObject({ sequence: 20, payload: { value: "newer" } });
      expect(await tx.select().from(externalWebhookEvents).where(eq(externalWebhookEvents.resourceId, resourceId))).toHaveLength(4);
    });
  });
  it("drains a verified event through the actual local operator CLI", async () => {
    const input = event();
    await receive(signedRequest(input));
    const { stdout } = await promisify(execFile)(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/drain-jobs.ts", owner, tenantA, "drain", "100"], {
      env: { ...process.env, DATABASE_URL: fixture.appURL }, timeout: 20_000,
    });
    const result = JSON.parse(stdout);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((job: { status: string }) => job.status === "succeeded")).toBe(true);
    await context(async (tx) => expect(await tx.select().from(webhookResourceStates).where(eq(webhookResourceStates.resourceId, input.resourceId))).toHaveLength(1));
  });
  it("retains raw audit immutably, including against owner mutation", async () => {
    await expect(context((tx) => tx.execute(sql`update external_webhook_events set raw_body = '{}'`))).rejects.toThrow();
    await expect(fixture.admin.query("delete from external_webhook_events")).rejects.toThrow("append-only");
    await expect(fixture.admin.query("truncate external_webhook_events cascade")).rejects.toThrow("append-only");
  });
});

describe("jobs/webhook RLS and authorization", () => {
  it("denies missing context, cross-tenant direct reads/writes and queue replay", async () => {
    const foreign = await withTenant(fixture.db, other, tenantB, "jobs:operate", (tx) => enqueueJob(tx, tenantB, { kind: "unsupported", idempotencyKey: "foreign", payload: {}, maxAttempts: 1 }));
    await drainJobs(fixture.db, other, tenantB, "other-worker");
    await receive(signedRequest(event(), "connection-b"));
    expect(await fixture.db.select().from(jobs)).toEqual([]);
    expect(await fixture.db.select().from(externalWebhookEvents)).toEqual([]);
    expect(await fixture.db.select().from(outboxEvents)).toEqual([]);
    expect(await fixture.db.select().from(webhookResourceStates)).toEqual([]);
    await context(async (tx) => {
      for (const table of [jobs, externalWebhookEvents, outboxEvents, webhookResourceStates]) {
        expect(await tx.select().from(table).where(eq(table.tenantId, tenantB))).toEqual([]);
        expect((await tx.select().from(table)).every((row) => row.tenantId === tenantA)).toBe(true);
      }
      expect(await tx.update(jobs).set({ status: "queued" }).where(eq(jobs.tenantId, tenantB)).returning()).toEqual([]);
    });
    await expect(context((tx) => enqueueJob(tx, tenantB, { kind: "domain.receipt", idempotencyKey: "escape", payload: {} }))).rejects.toThrow();
    await expect(context((tx) => appendOutboxEvent(tx, tenantB, { kind: "domain.receipt", idempotencyKey: "escape", payload: {} }))).rejects.toThrow();
    await expect(context((tx) => tx.insert(externalWebhookEvents).values({ tenantId: tenantB, provider: "synthetic", connectionId: "forged", providerEventId: "forged", resourceId: "forged", sequence: 1, rawBody: "{}", bodyHash: "a".repeat(64), payload: {}, occurredAt: new Date() }))).rejects.toThrow();
    await expect(context((tx) => tx.insert(webhookResourceStates).values({ tenantId: tenantB, provider: "synthetic", connectionId: "forged", resourceId: "forged", sequence: 1, eventId: randomUUID(), payload: {} }))).rejects.toThrow();
    await expect(replayJob(fixture.db, owner, tenantA, foreign.id)).rejects.toMatchObject({ status: 404 });
    await expect(replayJob(fixture.db, owner, tenantB, foreign.id)).rejects.toMatchObject({ status: 403 });
    await expect(listJobs(fixture.db, owner, tenantB)).rejects.toMatchObject({ status: 403 });
    await expect(listWebhookEvents(fixture.db, owner, tenantB)).rejects.toMatchObject({ status: 403 });
    await expect(drainJobs(fixture.db, owner, tenantB, "escape")).rejects.toMatchObject({ status: 403 });
    for (const command of [listJobs(fixture.db, viewer, tenantA), listWebhookEvents(fixture.db, viewer, tenantA), replayJob(fixture.db, viewer, tenantA, foreign.id)]) await expect(command).rejects.toMatchObject({ status: 403 });
    expect((await listJobs(fixture.db, other, tenantB)).rows[0].status).toBe("dead_letter");
    const { rows: [reset] } = await fixture.pool.query("select nullif(current_setting('app.tenant_id', true), '') as tenant");
    expect(reset.tenant).toBeNull();
  });
  it("allows the same idempotency/provider event IDs independently in two tenants", async () => {
    const key = randomUUID();
    const a = await enqueue({ idempotencyKey: key });
    const b = await withTenant(fixture.db, other, tenantB, "jobs:operate", (tx) => enqueueJob(tx, tenantB, { kind: "domain.receipt", idempotencyKey: key, payload: {} }));
    expect(a.id).not.toBe(b.id);
    const input = event();
    await receive(signedRequest(input)); await receive(signedRequest(input, "connection-b"));
    expect((await listWebhookEvents(fixture.db, other, tenantB)).rows.some((row) => row.providerEventId === input.id)).toBe(true);
  });
});
