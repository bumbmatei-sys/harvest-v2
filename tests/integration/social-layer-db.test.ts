import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { AccessError } from "../../src/server/permissions";
import { FakeProvider } from "../../src/server/social/fake-provider";
import { cancelPost, getPost, linkConnection, listConnections, listPosts, refreshConnectionHealth, reschedulePost, retryPost, schedulePost, setConnectionEnabled } from "../../src/server/social/service";
import { runSocialPublisher } from "../../src/server/social/publisher";
import { useKeyProvider } from "../../src/server/connect-key-provider";
import { CANARY, depsFor, newFake, noNetwork, seedPeople, useTestKeys, type Fixture } from "./social-layer-fixture";

vi.mock("server-only", () => ({}));
let f: Fixture, p: Awaited<ReturnType<typeof seedPeople>>, fake: FakeProvider, deps: ReturnType<typeof depsFor>, connectionId: string;
let fetchSpy: ReturnType<typeof noNetwork>;
const future = (ms = 3_600_000) => new Date(Date.now() + ms).toISOString();
const denied = async (promise: Promise<unknown>, status = 403) => { const error = await promise.then(() => null, (e) => e); expect(error, "expected an access error").toBeInstanceOf(AccessError); expect((error as AccessError).status).toBe(status); };
const row = async (id: string) => (await f.admin.query("select * from social_posts where id = $1", [id])).rows[0];
const makeDue = (id: string) => f.admin.query("update social_posts set scheduled_for = now() - interval '1 second', next_attempt_at = now() - interval '1 second' where id = $1", [id]);
const newPost = async (content = "Sunday service at 10", at = future()) => (await schedulePost(f.db, p.owner, p.tenant, { connectionId, content, scheduledFor: at }, deps)).post;
// Time travel for tests: the guard (rightly) refuses publishing -> publishing without a provider reference, so lease ageing bypasses it.
const timeTravel = async (statement: string, ...values: unknown[]) => {
  await f.admin.query("alter table social_posts disable trigger social_post_guard");
  try { await f.admin.query(statement, values); } finally { await f.admin.query("alter table social_posts enable trigger social_post_guard"); }
};
const run = () => runSocialPublisher(f.workerPool, () => fake);

beforeAll(async () => {
  f = await testDatabase(); useTestKeys(); fetchSpy = noNetwork();
  p = await seedPeople(f, "sl"); fake = newFake(); deps = depsFor(fake);
  connectionId = (await linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: CANARY, accountRef: "acc-ig-1" }, deps)).connection.id;
});
afterAll(async () => { fetchSpy.mockRestore(); useKeyProvider(null); await f?.close(); });
afterEach(() => { fake.calls.length = 0; });

describe("tables, grants and row-level security", () => {
  it("forces RLS, grants no DELETE and gives the worker role no table access", async () => {
    for (const table of ["social_connections", "social_posts", "social_webhook_events"]) {
      expect((await f.admin.query("select relforcerowsecurity from pg_class where relname = $1", [table])).rows[0].relforcerowsecurity, table).toBe(true);
      expect((await f.admin.query("select privilege_type from information_schema.role_table_grants where grantee = 'harvest_app' and table_name = $1 order by 1", [table])).rows.map((r) => r.privilege_type), table).toEqual(["INSERT", "SELECT", "UPDATE"]);
      await expect(f.workerPool.query(`select * from ${table}`), table).rejects.toMatchObject({ code: "42501" });
    }
  });
  it("owner and admin are allowed; member, viewer and a non-member are denied (service and database)", async () => {
    for (const user of [p.owner, p.admin]) {
      expect((await listConnections(f.db, user, p.tenant, deps)).connections.length).toBeGreaterThan(0);
      await listPosts(f.db, user, p.tenant, {}, deps);
    }
    for (const user of [p.member, p.viewer, p.outsider]) {
      await denied(listConnections(f.db, user, p.tenant, deps)); await denied(listPosts(f.db, user, p.tenant, {}, deps));
      await denied(schedulePost(f.db, user, p.tenant, { connectionId, content: "x", scheduledFor: future() }, deps));
      await denied(linkConnection(f.db, user, p.tenant, { provider: "fake", credential: CANARY, accountRef: "acc-fb-2" }, deps));
    }
    // The database enforces the role too: a member with the right tenant context sees nothing and cannot write.
    await f.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${p.tenant}, true), set_config('app.user_id', ${p.member}, true)`);
      expect((await tx.execute(sql`select count(*)::int as n from social_connections`)).rows[0]).toEqual({ n: 0 });
      expect((await tx.execute(sql`select count(*)::int as n from social_posts`)).rows[0]).toEqual({ n: 0 });
    });
    await expect(f.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${p.tenant}, true), set_config('app.user_id', ${p.member}, true)`);
      await tx.execute(sql`update social_connections set health = 'failing'`);
      await tx.execute(sql`insert into social_posts (tenant_id, connection_id, content, idempotency_key, created_by) values (${p.tenant}, ${connectionId}, 'x', 'abcdefghij', ${p.member})`);
    })).rejects.toBeDefined();
    // No tenant context at all: nothing.
    await f.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', '', true), set_config('app.user_id', ${p.owner}, true)`);
      expect((await tx.execute(sql`select count(*)::int as n from social_connections`)).rows[0]).toEqual({ n: 0 });
    });
  });
  it("another ministry sees none of it, and cannot touch it by id", async () => {
    const post = await newPost();
    expect((await listConnections(f.db, p.outsider, p.other, deps)).connections).toEqual([]);
    expect((await listPosts(f.db, p.outsider, p.other, {}, deps)).posts).toEqual([]);
    await denied(getPost(f.db, p.outsider, p.tenant, post.id, deps));            // not a member of that ministry
    await denied(getPost(f.db, p.outsider, p.other, post.id, deps), 404);        // own ministry, someone else's id
    await denied(cancelPost(f.db, p.outsider, p.other, post.id, deps), 404);
    await denied(setConnectionEnabled(f.db, p.outsider, p.other, connectionId, false, deps), 404);
    await denied(schedulePost(f.db, p.outsider, p.other, { connectionId, content: "x", scheduledFor: future() }, deps), 404);
    expect((await row(post.id)).status).toBe("scheduled");
  });
  it("only the application role can resolve an account, and only the worker role can claim or complete", async () => {
    expect((await f.pool.query("select * from public.social_resolve_account('fake', 'acc-ig-1')")).rows).toEqual([{ tenant_id: p.tenant, connection_id: connectionId }]);
    expect((await f.pool.query("select * from public.social_resolve_account('fake', 'nobody')")).rows).toEqual([]);
    await expect(f.workerPool.query("select * from public.social_resolve_account('fake', 'acc-ig-1')")).rejects.toMatchObject({ code: "42501" });
    await expect(f.pool.query("select public.social_publish_claim(1, 60)")).rejects.toMatchObject({ code: "42501" });
    await expect(f.pool.query("select public.social_publish_complete(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'failed', null, 'DISABLED', 0)")).rejects.toMatchObject({ code: "42501" });
    await expect(f.workerPool.query("select public.social_publish_claim(0, 60)")).rejects.toBeDefined();
  });
});

describe("connections and credentials", () => {
  it("links only an account the provider returns for that credential, and only once across ministries", async () => {
    await denied(linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: CANARY, accountRef: "not-an-account" }, deps), 400);
    await denied(linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: "wrong-credential", accountRef: "acc-fb-2" }, deps), 400);
    await expect(linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: CANARY, accountRef: "acc-fb-2", extra: 1 }, deps)).rejects.toBeDefined();
    await denied(linkConnection(f.db, p.outsider, p.other, { provider: "fake", credential: CANARY, accountRef: "acc-ig-1" }, deps), 409);
    const linked = await linkConnection(f.db, p.outsider, p.other, { provider: "fake", credential: CANARY, accountRef: "acc-yt-3" }, deps);
    expect(linked.connection).toMatchObject({ provider: "fake", platform: "youtube", externalAccountRef: "acc-yt-3", status: "active", health: "unknown" });
    expect(JSON.stringify(linked)).not.toMatch(/envelope|ciphertext|CANARY/);
  });
  it("never stores the credential in plaintext: not in any table, the audit trail or any error", async () => {
    const errors: string[] = [];
    await linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: "wrong-CANARY-credential", accountRef: "acc-fb-2" }, deps).catch((e) => errors.push(String(e.message), JSON.stringify(e.details ?? {})));
    expect(errors.join(" ")).not.toMatch(/CANARY/i);
    const { rows: tables } = await f.admin.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'");
    for (const { table_name } of tables) expect((await f.admin.query(`select count(*)::int as n from "${table_name}" t where t::text ilike '%canary%'`)).rows[0].n, table_name).toBe(0);
    const { rows: [conn] } = await f.admin.query("select credential_envelope from social_connections where id = $1", [connectionId]);
    expect(Object.keys(conn.credential_envelope).sort()).toEqual(["binding", "ciphertext", "iv", "keyId", "tag", "version"]);
    expect(conn.credential_envelope.binding).toBe(`social-credential:${p.tenant}:${connectionId}`);
    const audits = (await f.admin.query("select action, metadata from audit_logs where tenant_id = $1 and action like 'social.%'", [p.tenant])).rows;
    expect(audits.length).toBeGreaterThan(0);
    for (const a of audits) expect(Object.keys(a.metadata).every((k) => ["provider", "platform", "status", "health"].includes(k)), a.action).toBe(true);
  });
  it("writes the credential to no log, even when the provider call fails", async () => {
    const logged: string[] = [];
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); }));
    try {
      fake.fail("listAccounts", "UNAVAILABLE", 1);
      await linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: CANARY, accountRef: "acc-ig-1" }, deps).catch(() => {});   // provider outage
      await linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: CANARY, accountRef: "acc-ig-1" }, deps).catch(() => {});   // already linked
      const post = await newPost("log scan"); await makeDue(post.id); fake.fail("publishPost", "UNAVAILABLE", 1); await run();
      await f.admin.query("update social_posts set next_attempt_at = now() where id = $1", [post.id]); await run();
    } finally { spies.forEach((s) => s.mockRestore()); }
    expect(logged.join("\n")).not.toMatch(/CANARY/i);
  });
  it("refuses a plaintext-shaped credential column at the database", async () => {
    for (const bad of [{ secret: CANARY }, { version: 1, keyId: "k", binding: "b", iv: "i", tag: "t", ciphertext: "c", token: CANARY }, {}]) {
      // Own transaction: the creator guard needs the signed-in user, and a failed statement must not poison the shared connection.
      const client = await f.admin.connect();
      try {
        await client.query("begin"); await client.query("select set_config('app.user_id', $1, true)", [p.owner]);
        await expect(client.query("insert into social_connections (tenant_id, provider, platform, external_account_ref, credential_envelope, created_by) values ($1, 'fake', 'instagram', $2, $3, $4)",
          [p.tenant, `plain-${Math.random()}`, JSON.stringify(bad), p.owner])).rejects.toMatchObject({ code: "23514" });
      } finally { await client.query("rollback"); client.release(); }
    }
  });
  it("disables, re-enables and health-checks a connection (audited, version bumped)", async () => {
    const id = (await linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: CANARY, accountRef: "acc-fb-2" }, deps)).connection.id;
    expect((await refreshConnectionHealth(f.db, p.owner, p.tenant, id, deps)).connection).toMatchObject({ health: "healthy", healthCode: null });
    expect((await setConnectionEnabled(f.db, p.admin, p.tenant, id, false, deps)).connection.status).toBe("disabled");
    await denied(refreshConnectionHealth(f.db, p.owner, p.tenant, id, deps), 404);
    expect((await setConnectionEnabled(f.db, p.admin, p.tenant, id, true, deps)).connection.status).toBe("active");
    await setConnectionEnabled(f.db, p.owner, p.tenant, id, false, deps);
    await denied(schedulePost(f.db, p.owner, p.tenant, { connectionId: id, content: "x" }, deps), 404);
  });
  it("rejects every service call while the integration is disabled", async () => {
    const off = { ...deps, enabled: false };
    await denied(listConnections(f.db, p.owner, p.tenant, off), 404);
    await denied(linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: CANARY, accountRef: "acc-fb-2" }, off), 404);
    await denied(schedulePost(f.db, p.owner, p.tenant, { connectionId, content: "x" }, off), 404);
    await denied(listPosts(f.db, p.owner, p.tenant, {}, off), 404);
  });
});

describe("post state machine at the database", () => {
  const raw = (id: string, set: string) => f.admin.query(`update social_posts set ${set} where id = $1`, [id]);
  it("creates drafts and scheduled posts only, and validates input", async () => {
    const draft = (await schedulePost(f.db, p.owner, p.tenant, { connectionId, content: "draft" }, deps)).post;
    expect(draft).toMatchObject({ status: "draft", scheduledFor: null, attempts: 0 });
    expect((await newPost()).status).toBe("scheduled");
    for (const bad of [{ connectionId, content: "" }, { connectionId, content: "x".repeat(10_001) }, { connectionId, content: "x", scheduledFor: new Date(Date.now() - 3_600_000).toISOString() },
      { connectionId, content: "x", scheduledFor: new Date(Date.now() + 400 * 86_400_000).toISOString() }, { connectionId, content: "x", media: [{ kind: "image", url: "http://insecure.example/a.jpg" }] }, { connectionId, content: "x", status: "published" }]) {
      await expect(schedulePost(f.db, p.owner, p.tenant, bad, deps), JSON.stringify(bad)).rejects.toBeDefined();
    }
    await expect(f.admin.query("insert into social_posts (tenant_id, connection_id, status, content, idempotency_key, created_by) values ($1,$2,'published','x','abcdefghij',$3)", [p.tenant, connectionId, p.owner])).rejects.toBeDefined();
  });
  it("walks the legal path and refuses every illegal move", async () => {
    const id = (await schedulePost(f.db, p.owner, p.tenant, { connectionId, content: "walk" }, deps)).post.id;
    await expect(raw(id, "status = 'published', provider_post_ref = 'x', published_at = now()")).rejects.toThrow(/cannot move from draft to published/);
    await expect(raw(id, "status = 'publishing', lock_token = gen_random_uuid(), locked_at = now(), first_attempt_at = now()")).rejects.toThrow(/cannot move from draft to publishing/);
    await raw(id, "status = 'scheduled', scheduled_for = now(), next_attempt_at = now()");
    await expect(raw(id, "status = 'published', provider_post_ref = 'x', published_at = now()")).rejects.toThrow(/cannot move from scheduled to published/);
    await raw(id, "status = 'publishing', attempts = 1, lock_token = gen_random_uuid(), locked_at = now(), first_attempt_at = now()");
    await expect(raw(id, "content = 'edited while in flight'")).rejects.toThrow();
    await expect(raw(id, "attempts = 0")).rejects.toThrow();
    await expect(raw(id, "status = 'draft', lock_token = null, locked_at = null")).rejects.toThrow(/cannot move from publishing to draft/);
    await expect(raw(id, "status = 'published', lock_token = null, locked_at = null")).rejects.toBeDefined();           // needs a provider reference
    await raw(id, "status = 'published', provider_post_ref = 'ref-1', published_at = now(), lock_token = null, locked_at = null");
    for (const set of ["status = 'failed', last_error_code = 'DISABLED'", "status = 'scheduled', scheduled_for = now(), next_attempt_at = now()", "status = 'cancelled'", "content = 'rewrite history'", "version = version + 1"]) {
      await expect(raw(id, set), set).rejects.toThrow(/social post is published and cannot change/);
    }
    for (const set of ["tenant_id = gen_random_uuid()", "connection_id = gen_random_uuid()", "idempotency_key = 'different-key'", "created_by = 'someone-else'"]) await expect(raw(id, set), set).rejects.toBeDefined();
  });
  it("cancelled is terminal, a provider reference never changes and failed needs a reason", async () => {
    const id = (await newPost()).id;
    await cancelPost(f.db, p.owner, p.tenant, id, deps);
    await expect(raw(id, "status = 'scheduled', next_attempt_at = now()")).rejects.toThrow(/cancelled and cannot change/);
    await denied(cancelPost(f.db, p.owner, p.tenant, id, deps), 409);
    const other = (await newPost()).id;
    await raw(other, "status = 'publishing', attempts = 1, lock_token = gen_random_uuid(), locked_at = now(), first_attempt_at = now()");
    await expect(raw(other, "status = 'failed', lock_token = null, locked_at = null")).rejects.toMatchObject({ code: "23514" });
    await raw(other, "status = 'publishing', provider_post_ref = 'r1', lock_token = null, locked_at = null, next_attempt_at = now()");
    await expect(raw(other, "provider_post_ref = 'r2'")).rejects.toThrow(/provider reference is immutable/);
  });
  it("refuses a retry that could double-post: ambiguous outcome, or older than the provider's idempotency window", async () => {
    for (const [code, firstAttempt] of [["IDEMPOTENCY_WINDOW_EXPIRED", "now()"], ["UNCONFIRMED", "now()"], ["PROVIDER_UNAVAILABLE", "now() - interval '24 hours'"]] as const) {
      const id = (await newPost()).id;
      await raw(id, `status = 'publishing', attempts = 1, lock_token = gen_random_uuid(), locked_at = now(), first_attempt_at = ${firstAttempt}`);
      await raw(id, `status = 'failed', last_error_code = '${code}', lock_token = null, locked_at = null`);
      await denied(retryPost(f.db, p.owner, p.tenant, id, deps), 409);
      expect((await row(id)).status, code).toBe("failed");
    }
    const ok = (await newPost()).id;
    await raw(ok, "status = 'publishing', attempts = 2, lock_token = gen_random_uuid(), locked_at = now(), first_attempt_at = now()");
    await raw(ok, "status = 'failed', last_error_code = 'PROVIDER_REJECTED', lock_token = null, locked_at = null");
    expect((await retryPost(f.db, p.owner, p.tenant, ok, deps)).post).toMatchObject({ status: "scheduled", attempts: 0 });
  });
  it("reschedules, unschedules and lists", async () => {
    const id = (await newPost()).id;
    expect((await reschedulePost(f.db, p.owner, p.tenant, id, { scheduledFor: null }, deps)).post).toMatchObject({ status: "draft", scheduledFor: null });
    expect((await reschedulePost(f.db, p.owner, p.tenant, id, { scheduledFor: future(7_200_000) }, deps)).post.status).toBe("scheduled");
    expect((await listPosts(f.db, p.owner, p.tenant, { status: "scheduled" }, deps)).posts.every((x) => x.status === "scheduled")).toBe(true);
    await denied(reschedulePost(f.db, p.owner, p.tenant, "00000000-0000-4000-8000-000000000000", { scheduledFor: null }, deps), 404);
  });
});

describe("posting worker (worker role, fake provider only)", () => {
  beforeAll(async () => { await f.admin.query("delete from social_posts"); });
  it("publishes a due post once, with its idempotency key, and records the provider reference", async () => {
    const post = await newPost("Publish me"); await makeDue(post.id);
    expect(await run()).toMatchObject({ claimed: 1, published: 1, failed: 0 });
    const done = await row(post.id);
    expect(done).toMatchObject({ status: "published", attempts: 1, last_error_code: null, lock_token: null });
    expect(done.provider_post_ref).toMatch(/^fake-post-/); expect(done.published_at).not.toBeNull();
    expect(fake.calls).toEqual([{ method: "publishPost", key: done.idempotency_key }]);
    expect((await run()).claimed).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("does not publish a post that is not yet due, or a draft or cancelled one", async () => {
    const later = await newPost("later"), draft = (await schedulePost(f.db, p.owner, p.tenant, { connectionId, content: "draft" }, deps)).post, gone = await newPost("gone");
    await cancelPost(f.db, p.owner, p.tenant, gone.id, deps); await makeDue(draft.id).catch(() => {});
    expect((await run()).claimed).toBe(0); expect(fake.calls).toEqual([]);
    expect([(await row(later.id)).status, (await row(draft.id)).status, (await row(gone.id)).status]).toEqual(["scheduled", "draft", "cancelled"]);
  });
  it("retries a transient failure with backoff and the SAME key, then publishes", async () => {
    const post = await newPost("flaky"); await makeDue(post.id);
    fake.fail("publishPost", "UNAVAILABLE", 1);
    expect(await run()).toMatchObject({ claimed: 1, retried: 1, published: 0 });
    let r = await row(post.id);
    expect(r).toMatchObject({ status: "scheduled", attempts: 1, last_error_code: "PROVIDER_UNAVAILABLE" });
    expect(new Date(r.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect((await run()).claimed).toBe(0);                       // backing off
    await f.admin.query("update social_posts set next_attempt_at = now() where id = $1", [post.id]);
    expect(await run()).toMatchObject({ claimed: 1, published: 1 });
    r = await row(post.id);
    expect(r).toMatchObject({ status: "published", attempts: 2, last_error_code: null });
    expect(new Set(fake.calls.map((c) => c.key))).toEqual(new Set([r.idempotency_key])); expect(fake.calls).toHaveLength(2);
  });
  it("fails permanent errors at once, and after the attempt cap for transient ones", async () => {
    const auth = await newPost("bad auth"); await makeDue(auth.id); fake.fail("publishPost", "AUTH", 1);
    expect(await run()).toMatchObject({ claimed: 1, failed: 1 });
    expect(await row(auth.id)).toMatchObject({ status: "failed", attempts: 1, last_error_code: "PROVIDER_AUTH" });
    const flaky = await newPost("always down"); await makeDue(flaky.id); fake.fail("publishPost", "UNAVAILABLE", 99);
    for (let i = 0; i < 5; i++) { await f.admin.query("update social_posts set next_attempt_at = now() - interval '1 second' where id = $1 and status = 'scheduled'", [flaky.id]); await run(); }
    expect(await row(flaky.id)).toMatchObject({ status: "failed", attempts: 5, last_error_code: "MAX_ATTEMPTS" });
    fake.fail("publishPost", "UNAVAILABLE", 0);
    // A person may retry the definitive failure while the provider still remembers its key.
    expect((await retryPost(f.db, p.owner, p.tenant, auth.id, deps)).post).toMatchObject({ status: "scheduled", attempts: 0 });
    expect(await run()).toMatchObject({ published: 1 });
  });
  it("never resends a post whose idempotency window has passed, even after a clean transient retry and a long worker outage", async () => {
    const post = await newPost("outage"); await makeDue(post.id);
    fake.fail("publishPost", "UNAVAILABLE", 1);
    expect(await run()).toMatchObject({ claimed: 1, retried: 1 });
    expect(await row(post.id)).toMatchObject({ status: "scheduled", attempts: 1 });
    fake.calls.length = 0;
    // The worker was down for a day: the first attempt is now 24 hours old and the retry is due.
    await timeTravel("update social_posts set first_attempt_at = now() - interval '24 hours', next_attempt_at = now() - interval '1 second' where id = $1", post.id);
    expect(await run()).toMatchObject({ claimed: 0 });
    expect(await row(post.id)).toMatchObject({ status: "failed", last_error_code: "IDEMPOTENCY_WINDOW_EXPIRED", lock_token: null });
    expect(fake.calls).toEqual([]);                                  // never sent
    await denied(retryPost(f.db, p.owner, p.tenant, post.id, deps), 409);
  });
  it("cannot be made claimable again by rescheduling or a draft round-trip once an attempt has been made", async () => {
    const post = await newPost("moved"); await makeDue(post.id);
    fake.fail("publishPost", "UNAVAILABLE", 1);
    await run();
    for (const age of ["24 hours", "1 hour"]) {                       // expired, and still inside the window
      await timeTravel(`update social_posts set first_attempt_at = now() - interval '${age}' where id = $1`, post.id);
      await denied(reschedulePost(f.db, p.owner, p.tenant, post.id, { scheduledFor: future() }, deps), 409);
      await denied(reschedulePost(f.db, p.owner, p.tenant, post.id, { scheduledFor: null }, deps), 409);
      expect(await row(post.id)).toMatchObject({ status: "scheduled", attempts: 1 });
    }
    // Even a database-level draft round-trip is refused by the guard.
    await expect(f.admin.query("update social_posts set status = 'draft', scheduled_for = null, next_attempt_at = null where id = $1", [post.id])).rejects.toThrow(/had an attempt/);
    await expect(f.admin.query("update social_posts set content = 'edited after an attempt' where id = $1", [post.id])).rejects.toThrow(/had an attempt/);
    // It can still be cancelled by a person.
    expect((await cancelPost(f.db, p.owner, p.tenant, post.id, deps)).post.status).toBe("cancelled");
  });
  it("still retries inside the window, with the same key", async () => {
    const post = await newPost("in window"); await makeDue(post.id);
    fake.fail("publishPost", "UNAVAILABLE", 1);
    await run();
    const key = (await row(post.id)).idempotency_key;
    await timeTravel("update social_posts set first_attempt_at = now() - interval '22 hours', next_attempt_at = now() - interval '1 second' where id = $1", post.id);
    expect(await run()).toMatchObject({ claimed: 1, published: 1 });
    expect(fake.calls.map((c) => c.key)).toEqual([key, key]);
    expect(await row(post.id)).toMatchObject({ status: "published", attempts: 2 });
  });
  it("records an accepted post, then reconciles it by asking for its status, never by publishing again", async () => {
    class Async extends FakeProvider { async publishPost(...a: Parameters<FakeProvider["publishPost"]>) { const r = await super.publishPost(...a); return { ...r, status: "publishing" as const }; }
      async getPostStatus(...a: Parameters<FakeProvider["getPostStatus"]>) { const r = await super.getPostStatus(...a); return { ...r, status: "published" as const }; } }
    const slow = new Async({ validSecret: CANARY, accounts: fake.accounts });
    const post = await newPost("async"); await makeDue(post.id);
    expect(await runSocialPublisher(f.workerPool, () => slow)).toMatchObject({ claimed: 1, accepted: 1 });
    let r = await row(post.id);
    expect(r).toMatchObject({ status: "publishing", lock_token: null, locked_at: null }); expect(r.provider_post_ref).toMatch(/^fake-post-/);
    expect((await runSocialPublisher(f.workerPool, () => slow)).claimed).toBe(0);      // not due for reconciliation yet
    await f.admin.query("update social_posts set next_attempt_at = now() where id = $1", [post.id]);
    expect(await runSocialPublisher(f.workerPool, () => slow)).toMatchObject({ claimed: 1, published: 1 });
    r = await row(post.id);
    expect(r.status).toBe("published"); expect(slow.calls.map((c) => c.method)).toEqual(["publishPost", "getPostStatus"]);
  });
  it("recovers a crashed claim with the same key inside 23 hours, and fails it for a person after that", async () => {
    const claim = async () => (await f.workerPool.query("select public.social_publish_claim(10, 60) as c")).rows[0].c as { postId: string; lockToken: string; attempts: number }[];
    const inside = await newPost("crash inside"); await makeDue(inside.id);
    const [first] = await claim(); expect(first.postId).toBe(inside.id); expect(first.attempts).toBe(1);
    await timeTravel("update social_posts set locked_at = now() - interval '10 minutes' where id = $1", inside.id);
    const [again] = await claim(); expect(again.postId).toBe(inside.id); expect(again.attempts).toBe(2); expect(again.lockToken).not.toBe(first.lockToken);
    // The first (dead) worker's late answer is refused.
    expect((await f.workerPool.query("select public.social_publish_complete($1, $2, $3, 'published', 'late-ref', null, 0) as s", [p.tenant, inside.id, first.lockToken])).rows[0].s).toBe("stale");
    expect((await f.workerPool.query("select public.social_publish_complete($1, $2, $3, 'published', 'ref-ok', null, 0) as s", [p.tenant, inside.id, again.lockToken])).rows[0].s).toBe("published");
    const outside = await newPost("crash outside"); await makeDue(outside.id);
    await claim();
    await timeTravel("update social_posts set locked_at = now() - interval '10 minutes', first_attempt_at = now() - interval '24 hours' where id = $1", outside.id);
    expect(await claim()).toEqual([]);
    expect(await row(outside.id)).toMatchObject({ status: "failed", last_error_code: "IDEMPOTENCY_WINDOW_EXPIRED" });
    await denied(retryPost(f.db, p.owner, p.tenant, outside.id, deps), 409);
  });
  it("fails due posts whose connection was disabled or revoked, without calling the provider", async () => {
    fake.accounts.push({ accountRef: "acc-spare-1", platform: "threads", displayName: "spare" });
    const spare = (await linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: CANARY, accountRef: "acc-spare-1" }, deps)).connection.id;
    const post = (await schedulePost(f.db, p.owner, p.tenant, { connectionId: spare, content: "orphaned", scheduledFor: future() }, deps)).post; await makeDue(post.id);
    await setConnectionEnabled(f.db, p.owner, p.tenant, spare, false, deps); fake.calls.length = 0;
    expect(await run()).toMatchObject({ claimed: 0 });
    expect(await row(post.id)).toMatchObject({ status: "failed", last_error_code: "CONNECTION_UNAVAILABLE" }); expect(fake.calls).toEqual([]);
  });
  it("fails a post whose sealed credential cannot be opened", async () => {
    const post = await newPost("broken credential"); await makeDue(post.id);
    await f.admin.query("update social_connections set credential_envelope = jsonb_set(credential_envelope, '{binding}', '\"social-credential:other\"') where id = $1", [connectionId]);
    try { expect(await run()).toMatchObject({ claimed: 1, failed: 1 }); }
    finally { await f.admin.query("update social_connections set credential_envelope = jsonb_set(credential_envelope, '{binding}', to_jsonb($2::text)) where id = $1", [connectionId, `social-credential:${p.tenant}:${connectionId}`]); }
    expect(await row(post.id)).toMatchObject({ status: "failed", last_error_code: "CREDENTIAL_UNAVAILABLE" }); expect(fake.calls).toEqual([]);
  });
  it("never reaches the network: only the fake saw calls, and global fetch was never used", async () => { expect(fetchSpy).not.toHaveBeenCalled(); });
});

describe("worker script", () => {
  const exec = promisify(execFile);
  const runScript = (env: Record<string, string | undefined>) => exec(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/run-social-publisher.ts"],
    { env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME, HARVEST_CONNECT_TEST_KEY: "44".repeat(32), ...env }, timeout: 30_000 })
    .then((r) => ({ code: 0, stdout: r.stdout }), (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
  it("refuses without test mode, on the application login, or with only DATABASE_URL; runs as the worker role in test mode", async () => {
    expect(await runScript({ WORKER_DATABASE_URL: f.workerURL })).toMatchObject({ code: 1, stdout: "" });
    expect(await runScript({ HARVEST_SOCIAL_PUBLISHER: "test", WORKER_DATABASE_URL: f.appURL })).toMatchObject({ code: 1, stdout: "" });
    expect(await runScript({ HARVEST_SOCIAL_PUBLISHER: "test", DATABASE_URL: f.workerURL })).toMatchObject({ code: 1, stdout: "" });
    const post = await newPost("script run"); await makeDue(post.id);
    const ok = await runScript({ HARVEST_SOCIAL_PUBLISHER: "test", WORKER_DATABASE_URL: f.workerURL, DATABASE_URL: f.appURL });
    expect(JSON.parse(ok.stdout)).toMatchObject({ claimed: 1, published: 1, failed: 0 });
    expect((await row(post.id)).status).toBe("published");
  });
});
