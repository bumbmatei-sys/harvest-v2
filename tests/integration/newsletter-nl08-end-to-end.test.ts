import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { GET } from "../../src/app/f/[slug]/route";
import { POST as submitForm } from "../../src/app/f/[slug]/submit/route";
import { GET as sinkGET } from "../../src/app/api/newsletter/confirmation-sink/route";
import { POST as confirmPOST } from "../../src/app/api/newsletter/confirm/route";
import { POST as unsubscribePOST } from "../../src/app/api/newsletter/unsubscribe/route";
import { NEWSLETTER_BLOCK_IDS } from "../../src/lib/newsletter-signup";
import { getCrmForm, saveCrmForm } from "../../src/server/crm-forms";
import { transitionCrmForm } from "../../src/server/crm-form-publication";
import { createNewsletterAudience, createNewsletterList } from "../../src/server/newsletter";
import { createNewsletterSignupFormDraft } from "../../src/server/newsletter-forms";
import { cancelCampaign, dispatchCampaign, getCampaign, rescheduleCampaign, reviewCampaign, testCampaignToSink, writeCampaign } from "../../src/server/newsletter-campaigns/campaigns";
import { createIdentity, updateIdentity } from "../../src/server/newsletter-campaigns/identities";
import { estimateRecipients } from "../../src/server/newsletter-campaigns/recipients";
import { FakeNewsletterProvider } from "../../src/server/newsletter-campaigns/fake-provider";
import { runNewsletterWorker } from "../../src/server/newsletter-campaigns/worker";
import { recheckNewsletterDomains } from "../../src/server/newsletter-campaigns/maintenance";
import { saveMailingAddress } from "../../src/server/newsletter-campaigns/sender-setup";
import { withTenant } from "../../src/server/tenancy";
import { zonedSchedule } from "../../src/lib/newsletter-schedule";
import { testDatabase } from "../database";
import { noNetwork, seedPeople } from "./social-layer-fixture";

// NL-08: one ministry, end to end through the synthetic transport only. Sign-up form -> confirmation from the fake inbox -> campaign reviewed,
// scheduled, rescheduled and delivered by the test worker to the fake provider -> one-click unsubscribe from that message -> the next campaign
// skips the person. Nothing leaves the process: fetch is refused and the provider is the in-memory fake.
vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", () => ({ getDb: () => fixture.db }));
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let people: Awaited<ReturnType<typeof seedPeople>>;
let fetchSpy: ReturnType<typeof noNetwork>;
let list: string, senderId: string, replyToId: string;
const origin = "http://localhost:3000";
const tokenKey = randomBytes(32).toString("hex"), suppressionKeys = JSON.stringify([randomBytes(32).toString("hex")]);
const workerEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", HARVEST_NEWSLETTER_WORKER_ENABLED: "1", HARVEST_NEWSLETTER_TOKEN_KEY: tokenKey, HARVEST_NEWSLETTER_SUPPRESSION_KEYS: suppressionKeys };
const content = [{ type: "richText", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi {{firstName}}, news from {{ministryName}}" }] }] } }];

beforeAll(async () => {
  fetchSpy = noNetwork();
  fixture = await testDatabase({ migrationOwner: true });
  people = await seedPeople(fixture, "nl08");
  vi.stubEnv("HARVEST_CRM_FORMS", "synthetic");
  vi.stubEnv("HARVEST_CRM_FORMS_TEST_KEY", "5b".repeat(32));
  vi.stubEnv("HARVEST_NEWSLETTER_TOKEN_KEY", tokenKey);
  vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", suppressionKeys);
  vi.stubEnv("DATABASE_URL", fixture.appURL);
  vi.stubEnv("BETTER_AUTH_URL", origin);
  const audience = (await createNewsletterAudience(fixture.db, people.owner, people.tenant, { name: "Congregation" })).id;
  list = (await createNewsletterList(fixture.db, people.owner, people.tenant, audience, { name: "Weekly" })).id;
  await saveMailingAddress(fixture.db, people.owner, people.tenant, { address: "1 Main Street, Example City" });
  senderId = (await verifyMailbox("hello@nl08.example.test", "sender")).identity.id;
  replyToId = (await verifyMailbox("replies@nl08.example.test", "reply-to")).identity.id;
  expect(await recheckNewsletterDomains(fixture.workerPool, { ...workerEnv, HARVEST_NEWSLETTER_DOMAIN_RECHECK_ENABLED: "1" }, new FakeNewsletterProvider())).toEqual({ checked: 1 });
}, 90_000);
afterAll(async () => {
  try { expect(fetchSpy).not.toHaveBeenCalled(); } finally {
    fetchSpy?.mockRestore();
    vi.unstubAllEnvs();
    await fixture?.close();
  }
});

async function verifyMailbox(address: string, purpose: "sender" | "reply-to") {
  const confirmMailbox = vi.fn<FakeNewsletterProvider["confirmMailbox"]>();
  const created = await createIdentity(fixture.db, people.owner, people.tenant, { address, purpose }, { confirmMailbox });
  const code = confirmMailbox.mock.calls[0][0].text.split(" ").at(-1);
  return updateIdentity(fixture.db, people.owner, people.tenant, created.identity.id, { action: "confirm", code, version: 1 });
}

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
let visitors = 0;
const visitor = () => `198.53.${(visitors >> 8) & 255}.${visitors++ & 255}`;
async function publishedForm() {
  const { id } = await createNewsletterSignupFormDraft(fixture.db, people.admin, people.tenant, { listIds: [list] });
  const { definition } = await getCrmForm(fixture.db, people.admin, people.tenant, id);
  definition.settings.spamCheck = false;
  await saveCrmForm(fixture.db, people.admin, people.tenant, id, { definition, revision: definition.revision });
  const saved = await getCrmForm(fixture.db, people.admin, people.tenant, id);
  const slug = `nl08-${Date.now().toString(36)}`;
  await transitionCrmForm(fixture.db, people.admin, people.tenant, id, { action: "publish", slug, revision: saved.definition.revision });
  return slug;
}
async function signUp(slug: string, email: string, first: string) {
  const manifest = await GET(new Request(`${origin}/f/${slug}`, { headers: { "x-forwarded-for": visitor() } }), ctx(slug));
  expect(manifest.status).toBe(200);
  const { proof } = await manifest.json() as { proof: string };
  const answers = { [NEWSLETTER_BLOCK_IDS.email]: email, [NEWSLETTER_BLOCK_IDS.first]: first, consent0: "yes" };
  const response = await submitForm(new Request(`${origin}/f/${slug}/submit`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": visitor() },
    body: JSON.stringify({ proof, answers }) }), ctx(slug));
  expect(response.status).toBeLessThan(300);
}
/** The fake inbox for confirmation mail: the newest message to the address carries the confirm link. */
async function confirmFromInbox(email: string) {
  const response = sinkGET(new Request(`${origin}/api/newsletter/confirmation-sink?to=${encodeURIComponent(email)}`));
  expect(response.status).toBe(200);
  const [message] = (await response.json() as { messages: { path: string }[] }).messages;
  const query = new URL(message.path, origin).searchParams;
  const confirmed = await confirmPOST(new Request(`${origin}/api/newsletter/confirm`, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: query.get("email"), token: query.get("token") }) }));
  expect(confirmed.status).toBe(202);
}
const subscription = async (email: string) => (await fixture.admin.query(`select s.state from newsletter_subscriptions s join newsletter_subscribers b on b.tenant_id=s.tenant_id and b.id=s.subscriber_id
  join contact_identifiers i on i.tenant_id=b.tenant_id and i.contact_id=b.contact_id and i.kind='email' where i.normalized_value=$1 and s.list_id=$2`, [email, list])).rows[0]?.state;
const deliveries = async (campaign: string) => (await fixture.admin.query("select state, skip_reason, next_check_at from newsletter_deliveries where campaign_id=$1 order by id", [campaign])).rows;
const draft = (name: string) => writeCampaign(fixture.db, people.owner, people.tenant, { name, subject: "Ministry news", preheader: "This week", content, senderId, replyToId, selection: { listIds: [list], segmentIds: [] } });
const inSeconds = (seconds: number) => zonedSchedule(new Date(Date.now() + seconds * 1000).toISOString().slice(0, 16), "UTC")!;
async function schedule(campaign: string, version: number, at: { at: string; timezone: string }) {
  const dispatch = { mode: "schedule", schedule: at } as const;
  const reviewed = await reviewCampaign(fixture.db, people.owner, people.tenant, campaign, { version, dispatch });
  return dispatchCampaign(fixture.db, people.owner, people.tenant, campaign, { version: reviewed.version, token: reviewed.token, dispatch }, "schedule");
}
/** Runs the test worker until something is claimed (the schedule is due) or the deadline passes. */
async function deliverWhenDue(provider: FakeNewsletterProvider, deadlineMs = 90_000) {
  const end = Date.now() + deadlineMs;
  for (;;) {
    const result = await runNewsletterWorker(fixture.workerPool, workerEnv, provider);
    if (result && result.claimed > 0) return result;
    if (Date.now() > end) throw new Error("schedule never became due");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

it("installs the reschedule definer with a pinned search path, app-only execute and the guard branch", async () => {
  const { rows } = await fixture.admin.query(`select p.prosecdef, p.proconfig, has_function_privilege('public',p.oid,'execute') as pub,
    has_function_privilege('harvest_app',p.oid,'execute') as app, has_function_privilege('harvest_worker',p.oid,'execute') as worker
    from pg_proc p where p.proname='newsletter_reschedule_campaign'`);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ prosecdef: true, pub: false, app: true, worker: false });
  expect(String(rows[0].proconfig)).toContain("search_path=pg_catalog, pg_temp");
  const { rows: [guard] } = await fixture.admin.query("select prosecdef, proconfig from pg_proc where proname='newsletter_input_guard'");
  expect(guard.prosecdef).toBe(false);
  expect(String(guard.proconfig)).toContain("search_path=pg_catalog, pg_temp");
});

it("NL-08: sign-up form to confirmation, scheduled delivery to the fake inbox, one-click unsubscribe and suppression on the next campaign", async () => {
  // 1. Two people sign up on the hosted form and confirm from the fake inbox.
  const slug = await publishedForm();
  const ana = `ana-${randomUUID()}@example.test`, ben = `ben-${randomUUID()}@example.test`;
  await signUp(slug, ana, "Ana");
  await signUp(slug, ben, "Ben");
  expect(await subscription(ana)).toBeUndefined();
  await confirmFromInbox(ana);
  await confirmFromInbox(ben);
  expect(await subscription(ana)).toBe("subscribed");
  expect(await subscription(ben)).toBe("subscribed");
  expect(await estimateRecipients(fixture.db, people.owner, people.tenant, { listIds: [list] })).toMatchObject({ selected: 2, eligible: 2 });

  // 2. A campaign: a test to the fake inbox, then review and schedule an hour ahead.
  const first = await draft("First");
  expect(await testCampaignToSink(fixture.db, people.owner, people.tenant, first.id, "nl08-owner@example.test")).toEqual({ test: true, mailbox: "synthetic", state: "accepted" });
  const scheduled = await schedule(first.id, first.version, inSeconds(3600));
  expect(scheduled).toMatchObject({ state: "scheduled", timezone: "UTC", deliveryMode: "synthetic" });
  expect((await deliveries(first.id)).map((row) => row.state)).toEqual(["queued", "queued"]);

  // Sending is off: without the explicit test flag the worker does nothing, and with it nothing is due yet.
  const provider = new FakeNewsletterProvider(), submit = vi.spyOn(provider, "submit");
  expect(await runNewsletterWorker(fixture.workerPool, { ...workerEnv, HARVEST_NEWSLETTER_WORKER_ENABLED: undefined }, provider)).toBeNull();
  expect(await runNewsletterWorker(fixture.workerPool, workerEnv, provider)).toMatchObject({ claimed: 0 });
  expect(submit).not.toHaveBeenCalled();

  // 3. Reschedule to a few seconds from now: the campaign and its queued deliveries move together.
  const soon = inSeconds(120);
  const moved = await rescheduleCampaign(fixture.db, people.owner, people.tenant, first.id, { version: scheduled.version, schedule: soon });
  expect(moved).toMatchObject({ state: "scheduled", version: scheduled.version + 1 });
  for (const row of await deliveries(first.id)) expect(new Date(row.next_check_at).toISOString()).toBe(new Date(soon.at).toISOString());
  // Wait for the new time by moving it again to the nearest future second the server accepts.
  await rescheduleCampaign(fixture.db, people.owner, people.tenant, first.id, { version: moved.version, schedule: { at: new Date(Math.ceil((Date.now() + 2000) / 1000) * 1000).toISOString().replace(/\.000Z$/, "+00:00"), timezone: "UTC" } });
  const run = await deliverWhenDue(provider);
  expect(run).toMatchObject({ claimed: 2, errors: 0 });
  const inbox = submit.mock.calls.map(([message]) => message);
  expect(inbox.map((message) => message.to).sort()).toEqual([ana, ben].sort());
  const toAna = inbox.find((message) => message.to === ana)!;
  expect(toAna.subject).toBe("Ministry news");
  expect(toAna.text).toContain("Hi Ana");
  expect(toAna.html).toContain("/api/newsletter/unsubscribe?token=");
  expect(toAna.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  expect((await getCampaign(fixture.db, people.owner, people.tenant, first.id)).state).toBe("sent");

  // 4. Ana uses the one-click unsubscribe from her message.
  const link = new URL(/<([^>]+)>/.exec(toAna.headers["List-Unsubscribe"])![1]);
  expect(link.pathname).toBe("/api/newsletter/unsubscribe");
  const unsubscribed = await unsubscribePOST(new Request(`${origin}${link.pathname}${link.search}`, { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
  expect(unsubscribed.status).toBe(202);
  expect(await subscription(ana)).toBe("unsubscribed");
  expect(await subscription(ben)).toBe("subscribed");
  const { rows: suppressions } = await fixture.admin.query("select scope, reason from newsletter_suppressions where tenant_id=$1", [people.tenant]);
  expect(suppressions).toEqual([{ scope: list, reason: "unsubscribe" }]);
  expect(JSON.stringify(suppressions)).not.toContain(ana);

  // 5. The next campaign skips her: counted out at review, never handed to the provider.
  expect(await estimateRecipients(fixture.db, people.owner, people.tenant, { listIds: [list] })).toMatchObject({ selected: 2, eligible: 1 });
  const second = await draft("Second");
  const next = await schedule(second.id, second.version, { at: new Date(Math.ceil((Date.now() + 2000) / 1000) * 1000).toISOString().replace(/\.000Z$/, "+00:00"), timezone: "UTC" });
  expect(next.state).toBe("scheduled");
  expect((await deliveries(second.id)).map((row) => row.state).sort()).toEqual(["queued", "skipped"]);
  submit.mockClear();
  expect(await deliverWhenDue(provider)).toMatchObject({ claimed: 1 });
  expect(submit.mock.calls.map(([message]) => message.to)).toEqual([ben]);
  expect(fetchSpy).not.toHaveBeenCalled();
}, 180_000);

it("reschedules only a scheduled, unstarted campaign of the caller's ministry, inside the limits", async () => {
  const campaign = await draft("Limits");
  const queued = await schedule(campaign.id, campaign.version, inSeconds(3600));
  const later = inSeconds(7200);
  // Stale version, past time and beyond 60 days from selection.
  await expect(rescheduleCampaign(fixture.db, people.owner, people.tenant, campaign.id, { version: queued.version - 1, schedule: later })).rejects.toMatchObject({ status: 409, details: { code: "STALE_VERSION" } });
  await expect(rescheduleCampaign(fixture.db, people.owner, people.tenant, campaign.id, { version: queued.version, schedule: { at: "2020-01-01T09:00:00+00:00", timezone: "UTC" } }))
    .rejects.toMatchObject({ status: 409, details: { code: "SCHEDULE_IN_PAST" } });
  await expect(rescheduleCampaign(fixture.db, people.owner, people.tenant, campaign.id, { version: queued.version, schedule: inSeconds(61 * 86_400) }))
    .rejects.toMatchObject({ status: 400, details: { code: "SCHEDULE_TOO_FAR" } });
  // A wall time whose offset does not match the zone is refused by the input check.
  await expect(rescheduleCampaign(fixture.db, people.owner, people.tenant, campaign.id, { version: queued.version, schedule: { at: later.at, timezone: "Asia/Tokyo" } })).rejects.toThrow();
  // Members, viewers and other ministries cannot see or move it.
  for (const actor of [people.member, people.viewer]) {
    await expect(rescheduleCampaign(fixture.db, actor, people.tenant, campaign.id, { version: queued.version, schedule: later })).rejects.toMatchObject({ status: expect.any(Number) });
  }
  await expect(rescheduleCampaign(fixture.db, people.outsider, people.other, campaign.id, { version: queued.version, schedule: later })).rejects.toMatchObject({ status: 404 });
  // The application role cannot move a frozen time directly, even with the definer's marker set.
  await expect(withTenant(fixture.db, people.owner, people.tenant, "newsletter:delivery", async (tx) => {
    await tx.execute(sql`select set_config('app.nl_reschedule', ${people.tenant + ":" + campaign.id}, true)`);
    await tx.execute(sql`update public.newsletter_campaigns set scheduled_at=${later.at}::timestamptz, version=version+1 where id=${campaign.id}::uuid`);
  })).rejects.toHaveProperty("cause.code", "23514");
  // Nor can any other role that sets the marker: only the owner of the reschedule definer passes the guard branch.
  const other = await fixture.admin.connect();
  try {
    await other.query("begin");
    await other.query("select set_config('app.nl_reschedule',$1,true)", [people.tenant + ":" + campaign.id]);
    await expect(other.query("update public.newsletter_campaigns set scheduled_at=$1::timestamptz, version=version+1 where id=$2::uuid", [later.at, campaign.id]))
      .rejects.toHaveProperty("code", "23514");
  } finally { await other.query("rollback"); other.release(); }
  // The definer refuses a direct call for another ministry.
  await expect(withTenant(fixture.db, people.owner, people.tenant, "newsletter:delivery", (tx) =>
    tx.execute(sql`select public.newsletter_reschedule_campaign(${people.other}::uuid, ${campaign.id}::uuid, ${queued.version}, ${later.at}::timestamptz, 'UTC')`))).rejects.toHaveProperty("cause.code", "42501");
  // A valid move leaves no marker behind in the transaction.
  const markers = await withTenant(fixture.db, people.owner, people.tenant, "newsletter:delivery", async (tx) => {
    await tx.execute(sql`select public.newsletter_reschedule_campaign(${people.tenant}::uuid, ${campaign.id}::uuid, ${queued.version}, ${later.at}::timestamptz, 'UTC')`);
    return (await tx.execute<{ marker: string | null; send: string | null }>(sql`select current_setting('app.nl_reschedule', true) as marker, current_setting('app.nl_send_tenant', true) as send`)).rows[0];
  });
  expect(markers.marker ?? "").toBe("");
  expect(markers.send ?? "").toBe("");
  const current = await getCampaign(fixture.db, people.owner, people.tenant, campaign.id);
  expect(current.scheduledAt?.toISOString()).toBe(new Date(later.at).toISOString());
  // After cancelling, the campaign can no longer be moved.
  await cancelCampaign(fixture.db, people.owner, people.tenant, campaign.id, { version: current.version });
  await expect(rescheduleCampaign(fixture.db, people.owner, people.tenant, campaign.id, { version: current.version + 1, schedule: later })).rejects.toMatchObject({ status: 409, details: { code: "STALE_VERSION" } });
  // Ana unsubscribed earlier (skipped at selection); Ben's queued delivery is cancelled. Nothing stays queued.
  expect((await deliveries(campaign.id)).map((row) => row.skip_reason).sort()).toEqual(["cancelled", "list_suppressed"]);
});

it("refuses to move a campaign once the worker has claimed or attempted a delivery", async () => {
  const campaign = await draft("Started");
  const queued = await schedule(campaign.id, campaign.version, inSeconds(3600));
  // Simulate the worker holding one delivery (a lease), then having attempted it: either way the time is final.
  await fixture.admin.query("update newsletter_deliveries set lease=gen_random_uuid(), lease_until=now()+interval '1 minute' where id=(select id from newsletter_deliveries where campaign_id=$1 and state='queued' limit 1)", [campaign.id]);
  await expect(rescheduleCampaign(fixture.db, people.owner, people.tenant, campaign.id, { version: queued.version, schedule: inSeconds(7200) }))
    .rejects.toMatchObject({ status: 409, details: { code: "NOT_RESCHEDULABLE" } });
  await fixture.admin.query("update newsletter_deliveries set lease=null, lease_until=null, attempted_at=now() where campaign_id=$1 and lease is not null", [campaign.id]);
  await expect(rescheduleCampaign(fixture.db, people.owner, people.tenant, campaign.id, { version: queued.version, schedule: inSeconds(7200) }))
    .rejects.toMatchObject({ status: 409, details: { code: "NOT_RESCHEDULABLE" } });
  expect((await getCampaign(fixture.db, people.owner, people.tenant, campaign.id)).version).toBe(queued.version);
});

it("does not move deliveries that a concurrent worker leases while the reschedule waits", async () => {
  const campaign = await draft("Concurrent");
  const queued = await schedule(campaign.id, campaign.version, inSeconds(3600));
  const before = await deliveries(campaign.id);
  // A worker transaction holds one queued delivery (as the claim's FOR UPDATE does) and leases it after the reschedule has started.
  const worker = await fixture.admin.connect();
  try {
    await worker.query("begin");
    const { rows: [held] } = await worker.query("select id from newsletter_deliveries where campaign_id=$1 and state='queued' limit 1 for update", [campaign.id]);
    const pending = rescheduleCampaign(fixture.db, people.owner, people.tenant, campaign.id, { version: queued.version, schedule: inSeconds(7200) });
    const settled = pending.then(() => "resolved", () => "rejected");
    await new Promise((resolve) => setTimeout(resolve, 750));
    // Still waiting on the lock: the definer locks every delivery before it checks them.
    expect(await Promise.race([settled, new Promise((resolve) => setTimeout(() => resolve("waiting"), 50))])).toBe("waiting");
    await worker.query("update newsletter_deliveries set lease=gen_random_uuid(), lease_until=now()+interval '1 minute' where id=$1", [held.id]);
    await worker.query("commit");
    await expect(pending).rejects.toMatchObject({ status: 409, details: { code: "NOT_RESCHEDULABLE" } });
  } finally { worker.release(); }
  // Nothing moved: every delivery keeps its time and the campaign keeps its version.
  expect((await deliveries(campaign.id)).map((row) => new Date(row.next_check_at).toISOString())).toEqual(before.map((row) => new Date(row.next_check_at).toISOString()));
  expect((await getCampaign(fixture.db, people.owner, people.tenant, campaign.id)).version).toBe(queued.version);
});
