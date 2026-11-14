import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDatabase } from "../database";
import { useKeyProvider } from "../../src/server/connect-key-provider";
import { drainJobs } from "../../src/server/jobs/service";
import { FakeProvider } from "../../src/server/social/fake-provider";
import { runSocialPublisher } from "../../src/server/social/publisher";
import { linkConnection, schedulePost } from "../../src/server/social/service";
import { receiveSocialWebhook } from "../../src/server/social/webhook";
import { CANARY, depsFor, event, newFake, noNetwork, seedPeople, signedRequest, useTestKeys, type Fixture } from "./social-layer-fixture";

vi.mock("server-only", () => ({}));
let f: Fixture, p: Awaited<ReturnType<typeof seedPeople>>, fake: FakeProvider, deps: ReturnType<typeof depsFor>, connA: string, connB: string;
let fetchSpy: ReturnType<typeof noNetwork>;
const send = async (req: Request) => { const r = await receiveSocialWebhook(f.db, req, "fake", deps); return { status: r.status, body: await r.text() }; };
const events = async (tenant: string) => (await f.admin.query("select * from social_webhook_events where tenant_id = $1 order by received_at, id", [tenant])).rows;
const outbox = async (tenant: string) => (await f.admin.query("select * from outbox_events where tenant_id = $1 and kind = 'social.webhook'", [tenant])).rows;
const ACCEPTED = { status: 202, body: JSON.stringify({ accepted: true }) };

beforeAll(async () => {
  f = await testDatabase(); useTestKeys(); fetchSpy = noNetwork();
  p = await seedPeople(f, "sw"); fake = newFake(); deps = depsFor(fake);
  connA = (await linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: CANARY, accountRef: "acc-ig-1" }, deps)).connection.id;
  connB = (await linkConnection(f.db, p.outsider, p.other, { provider: "fake", credential: CANARY, accountRef: "acc-yt-3" }, deps)).connection.id;
});
afterAll(async () => { fetchSpy.mockRestore(); useKeyProvider(null); await f?.close(); });

describe("signed webhook intake", () => {
  it("stores a verified event minimally, under the tenant that owns the account, and queues one job", async () => {
    expect(await send(signedRequest(event("ev-1", "message.received", { subjectRef: "conv-1", text: "PRIVATE PRAYER REQUEST", sender: { name: "Jane Doe" } })))).toEqual(ACCEPTED);
    const [row] = await events(p.tenant);
    expect(row).toMatchObject({ tenant_id: p.tenant, connection_id: connA, provider: "fake", provider_event_id: "ev-1", event_type: "message.received", external_account_ref: "acc-ig-1", subject_ref: "conv-1", processed_at: null });
    expect(row.detail).toEqual({ platform: "instagram" }); expect(row.body_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toMatch(/PRAYER|Jane/);
    expect(await outbox(p.tenant)).toHaveLength(1); expect(await events(p.other)).toEqual([]);
  });
  it("takes the tenant from our connection record, never from the payload", async () => {
    expect(await send(signedRequest(event("ev-2", "comment.received", { subjectRef: "c1", tenantId: p.other, tenant_id: p.other, connectionId: connB })))).toEqual(ACCEPTED);
    expect((await events(p.tenant)).map((r) => r.provider_event_id)).toContain("ev-2");
    expect((await events(p.other)).map((r) => r.provider_event_id)).not.toContain("ev-2");
    expect(await send(signedRequest(event("ev-3", "message.received", { accountRef: "acc-yt-3", subjectRef: "conv-7", platform: "youtube" })))).toEqual(ACCEPTED);
    expect((await events(p.other)).map((r) => r.provider_event_id)).toEqual(["ev-3"]);
  });
  it("is idempotent by provider event id: a replay, even with a different body, stores and queues nothing", async () => {
    const before = [(await events(p.tenant)).length, (await outbox(p.tenant)).length];
    expect(await send(signedRequest(event("ev-1", "message.received", { subjectRef: "conv-1" })))).toEqual(ACCEPTED);
    expect(await send(signedRequest(event("ev-1", "post.failed", { subjectRef: "tampered" })))).toEqual(ACCEPTED);
    expect([(await events(p.tenant)).length, (await outbox(p.tenant)).length]).toEqual(before);
    expect((await events(p.tenant)).find((r) => r.provider_event_id === "ev-1")!.event_type).toBe("message.received");
  });
  it("acknowledges unknown accounts, revoked accounts, stale events and unrecognised types without storing them", async () => {
    const total = async () => Number((await f.admin.query("select count(*) from social_webhook_events")).rows[0].count);
    const before = await total();
    for (const e of [event("ev-u1", "post.published", { accountRef: "no-such-account" }), event("ev-u2", "analytics.updated"), event("ev-u3", "post.published", { timestamp: new Date(Date.now() - 80 * 3_600_000).toISOString() }),
      event("ev-u4", "post.published", { timestamp: new Date(Date.now() + 3_600_000).toISOString() })]) expect(await send(signedRequest(e))).toEqual(ACCEPTED);
    expect(await total()).toBe(before);
  });
  it("refuses bad signatures identically and stores nothing", async () => {
    const before = (await events(p.tenant)).length, raw = JSON.stringify(event("ev-bad", "post.published"));
    const bad = new Request("http://localhost/api/integrations/social/webhook/fake", { method: "POST", headers: { "content-type": "application/json", "x-fake-signature": "0".repeat(64) }, body: raw });
    const res = await send(bad);
    expect(res.status).toBe(404); expect(res.body).toBe((await send(new Request("http://localhost/x", { method: "POST", body: raw }))).body);
    expect((await events(p.tenant)).length).toBe(before);
  });
  it("applies provider events: accepted posts finish, and a disconnect revokes the connection and frees the account", async () => {
    // An accepted post (provider has it, final answer pending).
    class Async extends FakeProvider { async publishPost(...a: Parameters<FakeProvider["publishPost"]>) { return { ...(await super.publishPost(...a)), status: "publishing" as const }; } }
    const slow = new Async({ validSecret: CANARY, accounts: fake.accounts });
    const ok = (await schedulePost(f.db, p.owner, p.tenant, { connectionId: connA, content: "pending final answer", scheduledFor: new Date(Date.now() + 3_600_000).toISOString() }, deps)).post;
    const bad = (await schedulePost(f.db, p.owner, p.tenant, { connectionId: connA, content: "will fail later", scheduledFor: new Date(Date.now() + 3_600_000).toISOString() }, deps)).post;
    await f.admin.query("update social_posts set scheduled_for = now() - interval '1 second', next_attempt_at = now() - interval '1 second' where id in ($1, $2)", [ok.id, bad.id]);
    expect(await runSocialPublisher(f.workerPool, () => slow)).toMatchObject({ claimed: 2, accepted: 2 });
    const ref = async (id: string) => (await f.admin.query("select status, provider_post_ref from social_posts where id = $1", [id])).rows[0];
    const [okRef, badRef] = [await ref(ok.id), await ref(bad.id)];
    expect(okRef.status).toBe("publishing");
    expect(await send(signedRequest(event("ev-p1", "post.published", { subjectRef: okRef.provider_post_ref })))).toEqual(ACCEPTED);
    expect(await send(signedRequest(event("ev-p2", "post.failed", { subjectRef: badRef.provider_post_ref, errorCategory: "auth_expired" })))).toEqual(ACCEPTED);
    expect(await send(signedRequest(event("ev-p3", "post.published", { subjectRef: "unknown-post" })))).toEqual(ACCEPTED);
    const drained = await drainJobs(f.db, p.owner, p.tenant, "worker-1");
    expect(drained.results.every((r) => r.status === "succeeded")).toBe(true);
    expect(await ref(ok.id)).toMatchObject({ status: "published" });
    expect((await f.admin.query("select status, last_error_code, published_at from social_posts where id = $1", [bad.id])).rows[0]).toMatchObject({ status: "failed", last_error_code: "PROVIDER_REJECTED", published_at: null });
    expect((await events(p.tenant)).every((r) => r.processed_at !== null)).toBe(true);
    // Replays of applied events do nothing further.
    expect(await send(signedRequest(event("ev-p1", "post.failed", { subjectRef: okRef.provider_post_ref })))).toEqual(ACCEPTED);
    expect((await drainJobs(f.db, p.owner, p.tenant, "worker-1")).results).toEqual([]);
    expect((await ref(ok.id)).status).toBe("published");

    expect(await send(signedRequest(event("ev-d1", "account.disconnected")))).toEqual(ACCEPTED);
    await drainJobs(f.db, p.owner, p.tenant, "worker-1");
    expect((await f.admin.query("select status, health, health_code from social_connections where id = $1", [connA])).rows[0]).toEqual({ status: "revoked", health: "failing", health_code: "account_disconnected" });
    // The account no longer resolves, and another ministry may now link it.
    expect(await send(signedRequest(event("ev-d2", "message.received", { subjectRef: "c" })))).toEqual(ACCEPTED);
    expect((await events(p.tenant)).map((r) => r.provider_event_id)).not.toContain("ev-d2");
    expect((await linkConnection(f.db, p.outsider, p.other, { provider: "fake", credential: CANARY, accountRef: "acc-ig-1" }, deps)).connection.status).toBe("active");
    await expect(f.admin.query("update social_connections set status = 'active' where id = $1", [connA])).rejects.toThrow(/revoked social connection cannot change/);
  });
  it("only ever stamps processed_at on an event row", async () => {
    await expect(f.admin.query("update social_webhook_events set event_type = 'post.failed' where tenant_id = $1", [p.tenant])).rejects.toThrow(/only gain a processed time/);
    await expect(f.admin.query("update social_webhook_events set processed_at = now() where tenant_id = $1", [p.tenant])).rejects.toThrow(/only gain a processed time/);
  });
  it("never used the network", () => { expect(fetchSpy).not.toHaveBeenCalled(); });
});
