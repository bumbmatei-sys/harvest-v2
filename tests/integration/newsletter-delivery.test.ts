import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { users } from "../../src/db/schema";
import { fullState } from "../../src/lib/crm-fields";
import { createContact, eraseContact, recordConsent } from "../../src/server/contacts";
import { createView, updateView } from "../../src/server/crm-views";
import { addNewsletterSubscriber, createNewsletterAudience, createNewsletterList, createNewsletterSegment,
  setNewsletterSubscription, updateNewsletterSubscriber } from "../../src/server/newsletter";
import { unsubscribeNewsletter } from "../../src/server/newsletter-public";
import { newsletterAnalytics } from "../../src/server/newsletter-delivery/analytics";
import { cancelNewsletterCampaign, createNewsletterSender, disableNewsletterSender, getNewsletterCampaign, listNewsletterDeliveryConfig,
  previewNewsletterCampaign, reviewNewsletterCampaign, saveNewsletterCampaign, saveNewsletterTemplate, testNewsletterCampaign } from "../../src/server/newsletter-delivery/campaigns";
import { newsletterCallbackRoute } from "../../src/server/newsletter-delivery/callback-route";
import { FakeNewsletterProvider, signFakeNewsletterCallback } from "../../src/server/newsletter-delivery/fake-provider";
import type { DeliveryOutcome, NewsletterMessage } from "../../src/server/newsletter-delivery/port";
import { applyNewsletterCallback, drainNewsletter, stageNewsletterAudience, verifySyntheticSender } from "../../src/server/newsletter-delivery/worker";
import { withTenant } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

vi.mock("server-only", () => ({}));
const owner = "sending-owner", admin = "sending-admin", member = "sending-member", viewer = "sending-viewer", outsider = "sending-other";
const key = randomBytes(32);
const credential = { secret: "synthetic-provider" };
const provider = new FakeNewsletterProvider(credential.secret);
const runtime = { provider, credential, callbackSecret: "synthetic-callback", preferenceKey: key, publicOrigin: "https://newsletter.example.test" };
const content = { type: "doc", content: [{ type: "paragraph", content: [
  { type: "text", text: "Read more", marks: [{ type: "link", attrs: { href: "https://example.test/news" } }] },
] }] };
let db: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, other: string, audience: string, sender: string;

const review = { mode: "now", timeZone: "America/New_York", version: 1 };
const run = () => drainNewsletter(db.db, db.workerPool, runtime);
const stage = () => stageNewsletterAudience(db.db, db.workerPool, runtime);

beforeAll(async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected_network"));
  vi.stubEnv("HARVEST_NEWSLETTER_TOKEN_KEY", key.toString("hex"));
  db = await testDatabase({ migrationOwner: true });
  await db.db.insert(users).values([owner, admin, member, viewer, outsider].map(id => ({ id, name: id, email: `${id}@example.test` })));
  tenant = (await createWorkspace(db.db, owner, "Sending Ministry")).tenantId;
  other = (await createWorkspace(db.db, outsider, "Other Ministry")).tenantId;
  await db.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'admin'),($1,$3,'member'),($1,$4,'viewer')",
    [tenant, admin, member, viewer]);
  audience = (await createNewsletterAudience(db.db, owner, tenant, { name: "Ministry audience" })).id;
  sender = (await newSender()).id;
  expect(await verifySyntheticSender(db.workerPool, runtime, tenant, sender, "wrong.example.test")).toBe(false);
  expect(await verifySyntheticSender(db.workerPool, runtime, tenant, sender, "example.test")).toBe(true);
}, 60_000);
afterAll(async () => {
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await db?.close();
});

function newSender() {
  return createNewsletterSender(db.db, owner, tenant,
    { name: "Synthetic Ministry", email: "sender@example.test", replyTo: "reply@example.test", postalAddress: "123 Synthetic Street" });
}
async function newList() {
  return (await createNewsletterList(db.db, owner, tenant, audience, { name: "Synthetic list" })).id;
}
function consent(contactId: string, status: "granted" | "withdrawn", purpose: "newsletter" | "marketing" = "newsletter") {
  return recordConsent(db.db, owner, tenant, contactId,
    { noticeVersion: "notice-v1", purpose, channel: "email", status, source: "synthetic", evidence: "Synthetic consent" });
}
async function person(name = "Synthetic reader", list?: string, purpose: "newsletter" | "marketing" = "newsletter") {
  const email = `${randomUUID()}@example.test`;
  const contact = await createContact(db.db, owner, tenant, { name, email });
  await consent(contact.id, "granted", purpose);
  if (!list) return { contactId: contact.id, email };
  const subscriber = await addNewsletterSubscriber(db.db, owner, tenant, { contactId: contact.id });
  await setNewsletterSubscription(db.db, owner, tenant, list, subscriber.id, { state: "subscribed", version: 0 });
  return { contactId: contact.id, email, subscriberId: subscriber.id };
}
const input = (listId: string, senderId = sender) =>
  ({ subject: "First version", previewText: "Preview", senderId, audience: { kind: "list", listId }, content });
const draft = async (list: string, senderId = sender) => (await saveNewsletterCampaign(db.db, owner, tenant, input(list, senderId))).campaign.id;
const approve = (campaign: string) => reviewNewsletterCampaign(db.db, admin, tenant, campaign, review);
const deliveries = async (campaign: string) => (await db.admin.query<{
  id: string; state: string; contact_id: string; provider_id: string; attempts: number; reconciliations: number;
}>("select id,state,contact_id,provider_id,attempts,reconciliations from newsletter_deliveries where campaign_id=$1 order by id", [campaign])).rows;
async function releaseBackoff(id: string) {
  await db.admin.query("update newsletter_deliveries set available_at=clock_timestamp()-interval '1 second' where id=$1", [id]);
}
function signed(delivery: { id: string; provider_id: string }, outcome: DeliveryOutcome, extra: Record<string, unknown> = {}) {
  const raw = Buffer.from(JSON.stringify({ tenantId: tenant, id: randomUUID(), deliveryId: delivery.id,
    providerId: delivery.provider_id, outcome, occurredAt: new Date().toISOString(), note: "private callback canary", ...extra }));
  const signature = signFakeNewsletterCallback(raw, runtime.callbackSecret);
  return { raw, signature, apply: () => applyNewsletterCallback(db.workerPool, runtime, raw, signature) };
}
const range = { from: "2026-11-01", until: "2026-11-02", timeZone: "America/New_York" };

it("scopes direct RLS and API visibility to owners/admins across two ministries", async () => {
  const id = await draft(await newList());
  expect((await listNewsletterDeliveryConfig(db.db, admin, tenant, "campaigns", {})).items).toMatchObject([{ id }]);
  for (const [actor, scope] of [[viewer, tenant], [member, tenant], [outsider, tenant], [outsider, other]]) {
    await expect(getNewsletterCampaign(db.db, actor, scope, id)).rejects.toMatchObject({ status: 404 });
    await expect(newsletterAnalytics(db.db, actor, scope, { campaignId: id }, range)).rejects.toMatchObject({ status: 404 });
    if (actor === outsider && scope === tenant) continue;
    const rows = await withTenant(db.db, actor, scope, "workspace:read", tx => tx.execute(sql`select id from newsletter_campaigns where id=${id}::uuid`));
    expect(rows.rows).toEqual([]);
  }
  const otherAudience = (await createNewsletterAudience(db.db, outsider, other, { name: "Foreign audience" })).id;
  const otherList = (await createNewsletterList(db.db, outsider, other, otherAudience, { name: "Foreign list" })).id;
  await expect(draft(otherList)).rejects.toMatchObject({ status: 404 });
});

it("exposes only fixed-path worker functions and forces RLS with a restricted owner", async () => {
  const tables = (await db.admin.query("select relname,relforcerowsecurity from pg_class where relname in ('newsletter_campaigns','newsletter_revisions','newsletter_templates','newsletter_senders','newsletter_deliveries','newsletter_delivery_events','newsletter_audience_bindings')")).rows;
  expect(tables).toHaveLength(7);
  expect(tables.every(row => row.relforcerowsecurity)).toBe(true);
  const roles = (await db.admin.query("select rolsuper,rolbypassrls from pg_roles where rolname=$1", [db.migrationOwner])).rows;
  expect(roles).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  const functions = (await db.admin.query(`select proname,proconfig,has_function_privilege('harvest_app',p.oid,'execute') as app,
    has_function_privilege('harvest_worker',p.oid,'execute') as worker
    from pg_proc p where proname in ('newsletter_due','newsletter_claim','newsletter_callback','newsletter_start','newsletter_report') order by proname`)).rows;
  expect(functions).toHaveLength(5);
  expect(functions.every(row => row.proconfig.includes("search_path=pg_catalog, pg_temp"))).toBe(true);
  expect(functions.map(row => [row.proname, row.app, row.worker])).toEqual([
    ["newsletter_callback", false, true], ["newsletter_claim", false, true], ["newsletter_due", false, true],
    ["newsletter_report", true, false], ["newsletter_start", false, true],
  ]);
  await expect(db.pool.query("select * from public.newsletter_claim(1)")).rejects.toMatchObject({ code: "42501" });
  await expect(db.workerPool.query("select * from public.newsletter_deliveries")).rejects.toMatchObject({ code: "42501" });
  await expect(db.workerPool.query("select * from public.newsletter_claim_internal(1)")).rejects.toMatchObject({ code: "42501" });
  const restricted = await db.admin.connect();
  try {
    await restricted.query(`SET ROLE ${db.migrationOwner}`);
    expect((await restricted.query("select * from newsletter_campaigns")).rows).toEqual([]);
  } finally {
    await restricted.query("reset role");
    restricted.release();
  }
});

it("keeps draft saves inert, freezes revisions and requires review of the current version", async () => {
  const list = await newList();
  await person("Reviewed recipient", list);
  const campaign = await draft(list);
  const before = provider.attempts.length;
  await run();
  expect(provider.attempts).toHaveLength(before);
  await expect(db.pool.query("update newsletter_campaigns set status='scheduled'")).rejects.toMatchObject({ code: "42501" });
  await expect(db.pool.query("update newsletter_revisions set subject='rewritten'")).rejects.toMatchObject({ code: "42501" });
  await expect(db.admin.query("update newsletter_revisions set subject='rewritten' where campaign_id=$1", [campaign])).rejects.toThrow("newsletter_revision_immutable");
  const revision = await saveNewsletterCampaign(db.db, admin, tenant, { ...input(list), subject: "Reviewed second version", expectedVersion: 1 }, campaign);
  expect(revision.revision.version).toBe(2);
  await expect(approve(campaign)).rejects.toMatchObject({ status: 409 });
  let received: NewsletterMessage | undefined;
  const deliver = provider.deliver.bind(provider);
  const capture = vi.spyOn(provider, "deliver").mockImplementationOnce((cred, mail) => { received = mail; return deliver(cred, mail); });
  await reviewNewsletterCampaign(db.db, admin, tenant, campaign, { ...review, version: 2 });
  await expect(saveNewsletterCampaign(db.db, admin, tenant, { ...input(list), expectedVersion: 2 }, campaign)).rejects.toMatchObject({ status: 409 });
  await run();
  capture.mockRestore();
  expect(received).toMatchObject({ subject: "Reviewed second version", trackClicks: false, trackOpens: false });
  expect((await getNewsletterCampaign(db.db, owner, tenant, campaign)).campaign).toMatchObject({ status: "sent", approvedRevision: 2, approvedBy: admin });
  const unverified = await newSender();
  await expect(approve(await draft(list, unverified.id))).rejects.toMatchObject({ status: 409 });
});

it("uses a valid IANA zone and resolves future audience only at dispatch", async () => {
  const list = await newList();
  const campaign = await draft(list);
  const scheduledFor = new Date(Date.now() + 3_600_000).toISOString();
  await expect(reviewNewsletterCampaign(db.db, owner, tenant, campaign, { ...review, timeZone: "+02:00" })).rejects.toThrow();
  await reviewNewsletterCampaign(db.db, owner, tenant, campaign, { ...review, mode: "schedule", scheduledFor });
  await person("Joined after review", list);
  expect(await stage()).toBe(0);
  expect(await deliveries(campaign)).toEqual([]);
  await db.admin.query("update newsletter_campaigns set scheduled_for=clock_timestamp()-interval '1 minute' where id=$1", [campaign]);
  await run();
  expect(await deliveries(campaign)).toMatchObject([{ state: "accepted" }]);
});

it("checks consent and sticky suppression again after staging and leasing", async () => {
  const list = await newList();
  const refused = await person("Withdrawn", list);
  const blocked = await person("Suppressed", list);
  const campaign = await draft(list);
  await approve(campaign);
  await stage();
  const { rows: leases } = await db.workerPool.query("select * from public.newsletter_claim(10)");
  expect(leases).toHaveLength(2);
  await consent(refused.contactId, "withdrawn");
  await updateNewsletterSubscriber(db.db, owner, tenant, blocked.subscriberId!, { version: 1, suppressed: true });
  for (const lease of leases) {
    const result = await db.workerPool.query("select * from public.newsletter_start($1,$2,$3,$4)",
      [tenant, lease.delivery_id, lease.lease_id, randomBytes(32).toString("base64url")]);
    expect(result.rows).toEqual([]);
  }
  expect(await deliveries(campaign)).toMatchObject([{ state: "cancelled", attempts: 0 }, { state: "cancelled", attempts: 0 }]);
  await run();
});

it("resolves shared views and list-backed segments with the CRM predicate, consent and pinning", async () => {
  const list = await newList();
  const matched = await person("Narrow newsletter selection", list);
  await person("Outside this selection", list);
  const crmOnly = await person("Narrow newsletter CRM reader");
  const otherPurpose = await person("Narrow newsletter marketing only", undefined, "marketing");
  const state = fullState({ filters: [{ field: "name", op: "contains", value: "Narrow newsletter" }] });
  const view = await createView(db.db, owner, tenant, { name: "Selection", objectType: "person", shared: true, state });
  const segment = await createNewsletterSegment(db.db, owner, tenant, audience, { name: "List segment", savedViewId: view.id });
  const segmentCampaign = (await saveNewsletterCampaign(db.db, owner, tenant,
    { ...input(list), audience: { kind: "segment", listId: list, segmentId: segment.id } })).campaign.id;
  await approve(segmentCampaign);
  await run();
  expect(await deliveries(segmentCampaign)).toMatchObject([{ contact_id: matched.contactId, state: "accepted" }]);
  const viewInput = { ...input(list), audience: { kind: "view", viewId: view.id } };
  const viewCampaign = (await saveNewsletterCampaign(db.db, owner, tenant, viewInput)).campaign.id;
  await approve(viewCampaign);
  await run();
  expect(await deliveries(viewCampaign)).toEqual(expect.arrayContaining([
    expect.objectContaining({ contact_id: matched.contactId, state: "accepted" }),
    expect.objectContaining({ contact_id: crmOnly.contactId, state: "accepted" }),
  ]));
  expect((await deliveries(viewCampaign)).some(job => job.contact_id === otherPurpose.contactId)).toBe(false);
  const staleCampaign = (await saveNewsletterCampaign(db.db, owner, tenant, viewInput)).campaign.id;
  await approve(staleCampaign);
  await updateView(db.db, owner, tenant, "person", view.id, { version: view.version, name: "Changed", state: fullState({ q: "Different" }) });
  await run();
  expect((await getNewsletterCampaign(db.db, owner, tenant, staleCampaign)).campaign.status).toBe("cancelled");
  expect(await deliveries(staleCampaign)).toEqual([]);
});

it("cancels queued and leased jobs on campaign cancellation or sender disable", async () => {
  const list = await newList();
  await person("Cancelled recipient", list);
  const alternate = await newSender();
  await verifySyntheticSender(db.workerPool, runtime, tenant, alternate.id, "example.test");
  const cancelled = await draft(list), disabled = await draft(list, alternate.id);
  await approve(cancelled);
  await approve(disabled);
  await stage();
  expect((await db.workerPool.query("select * from public.newsletter_claim(10)")).rows).toHaveLength(2);
  await cancelNewsletterCampaign(db.db, owner, tenant, cancelled, { version: 1 });
  await disableNewsletterSender(db.db, admin, tenant, alternate.id);
  expect((await getNewsletterCampaign(db.db, owner, tenant, disabled)).campaign.status).toBe("cancelled");
  for (const campaign of [cancelled, disabled]) expect(await deliveries(campaign)).toMatchObject([{ state: "cancelled", attempts: 0 }]);
  expect(await run()).toEqual({ claimed: 0 });
});

it("reconciles an ambiguous accepted handoff using its immutable key without sending again", async () => {
  const list = await newList();
  await person("Ambiguous recipient", list);
  const campaign = await draft(list);
  await approve(campaign);
  provider.nextDelivery = "accepted_unknown";
  await run();
  const [job] = await deliveries(campaign);
  expect(job).toMatchObject({ state: "ambiguous", attempts: 1 });
  await releaseBackoff(job.id);
  await run();
  expect(await deliveries(campaign)).toMatchObject([{ id: job.id, state: "accepted", attempts: 1, reconciliations: 1 }]);
  expect(provider.attempts.filter(key => key === job.id)).toHaveLength(1);
});

it("reuses the key for definitive retries and bounds failed attempts", async () => {
  const list = await newList();
  await person("Retry recipient", list);
  const campaign = await draft(list);
  await approve(campaign);
  for (let attempt = 1; attempt <= 3; attempt++) {
    provider.nextDelivery = "retry";
    await run();
    const [job] = await deliveries(campaign);
    expect(job).toMatchObject({ state: attempt === 3 ? "failed" : "queued", attempts: attempt });
    if (attempt < 3) await releaseBackoff(job.id);
  }
  const [job] = await deliveries(campaign);
  expect(provider.attempts.filter(key => key === job.id)).toHaveLength(3);
});

it("never retries an unknown outcome after the reconciliation budget", async () => {
  const list = await newList();
  await person("Unavailable lookup", list);
  const campaign = await draft(list);
  await approve(campaign);
  provider.nextDelivery = "unknown";
  await run();
  const [job] = await deliveries(campaign);
  provider.reconciliationUnavailable = true;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await releaseBackoff(job.id);
      await run();
    }
  } finally {
    provider.reconciliationUnavailable = false;
  }
  expect(await deliveries(campaign)).toMatchObject([{ id: job.id, state: "unconfirmed", attempts: 1, reconciliations: 3 }]);
  expect(provider.attempts.filter(key => key === job.id)).toHaveLength(1);
});

it("verifies callbacks, deduplicates replay and applies bounce, complaint and unsubscribe", async () => {
  for (const outcome of ["bounced", "complained", "unsubscribed"] as const) {
    const list = await newList();
    const reader = await person(`Callback ${outcome}`, list);
    const campaign = await draft(list);
    await approve(campaign);
    await run();
    const [job] = await deliveries(campaign);
    const { raw, signature } = signed(job, outcome);
    expect(await applyNewsletterCallback(db.workerPool, runtime, raw, "bad-signature")).toBeNull();
    expect(await signed(job, outcome, { tenantId: other }).apply()).toBe(false);
    const callback = newsletterCallbackRoute({ worker: db.workerPool, runtime });
    const replies = await Promise.all([1, 2].map(() => callback(new Request(runtime.publicOrigin, {
      method: "POST", body: new Uint8Array(raw), headers: { "x-newsletter-signature": signature },
    }))));
    expect(replies.map(reply => reply.status)).toEqual([202, 202]);
    const event = (await db.admin.query("select * from newsletter_delivery_events where delivery_id=$1", [job.id])).rows;
    expect(event).toHaveLength(1);
    expect(event[0].outcome).toBe(outcome);
    expect(JSON.stringify(event)).not.toMatch(/private callback canary|example\.test/);
    const result = await db.admin.query("select s.suppressed,l.state from newsletter_subscribers s join newsletter_subscriptions l on (s.tenant_id,s.id)=(l.tenant_id,l.subscriber_id) where s.id=$1 and l.list_id=$2",
      [reader.subscriberId, list]);
    expect(result.rows).toEqual([outcome === "unsubscribed" ? { state: "unsubscribed", suppressed: false } : { state: "subscribed", suppressed: true }]);
    const second = await draft(list);
    await approve(second);
    await run();
    expect((await deliveries(second)).some(delivery => delivery.state === "accepted")).toBe(false);
  }
});

it("produces a canonical signed unsubscribe and detaches erased contacts without losing accepted totals", async () => {
  const list = await newList();
  const reader = await person("Pref footer", list);
  const campaign = await draft(list);
  const delegate = provider.deliver.bind(provider);
  let url = "";
  const capture = vi.spyOn(provider, "deliver").mockImplementationOnce((cred, mail) => {
    url = mail.unsubscribe;
    return delegate(cred, mail);
  });
  await approve(campaign);
  await run();
  capture.mockRestore();
  expect(new URL(url).searchParams.get("scope")).toBe("list");
  await unsubscribeNewsletter(db.db, "list", new URL(url).searchParams.get("token"));
  expect((await db.admin.query("select state from newsletter_subscriptions where tenant_id=$1 and subscriber_id=$2 and list_id=$3",
    [tenant, reader.subscriberId, list])).rows).toEqual([{ state: "unsubscribed" }]);
  await eraseContact(db.db, owner, tenant, reader.contactId);
  expect(await deliveries(campaign)).toMatchObject([{ contact_id: null, state: "accepted" }]);
});

it("returns numeric aggregates, scoped link counts and separate hours for the repeated fall-back hour", async () => {
  const list = await newList();
  await person("Metrics reader", list);
  const first = await draft(list), second = await draft(list);
  await approve(first);
  await approve(second);
  await run();
  const [a] = await deliveries(first), [b] = await deliveries(second);
  await db.admin.query("update newsletter_deliveries set accepted_at=case when id=$1 then $3::timestamptz else $4::timestamptz end where id in ($1,$2)",
    [a.id, b.id, "2026-11-01T05:10:00Z", "2026-11-01T06:10:00Z"]);
  expect(await signed(a, "delivered", { occurredAt: "2026-11-01T05:15:00Z" }).apply()).toBe(true);
  expect(await signed(a, "clicked", { occurredAt: "2026-11-01T05:21:00Z", linkId: 1 }).apply()).toBe(true);
  expect(await signed(a, "clicked", { occurredAt: "2026-11-01T05:25:00Z", linkId: 1 }).apply()).toBe(true);
  expect(await signed(b, "clicked", { occurredAt: "2026-11-01T06:15:00Z", linkId: 1 }).apply()).toBe(true);
  expect(await signed(b, "clicked", { linkId: 2 }).apply()).toBe(false);
  expect(await signed(b, "opened", { occurredAt: "2026-11-02T05:00:00Z" }).apply()).toBe(true);
  const report = await newsletterAnalytics(db.db, owner, tenant, { listId: list }, range);
  expect(report.counts).toEqual({ sent: 2, delivered: 1, clicked: 2, opened: null, bounced: null, complained: null, unsubscribed: null });
  expect(report.rates).toMatchObject({ clicked: 1, delivered: 0.5, opened: null });
  expect(report.openCountsApproximate).toBe(true);
  expect(report.freshness.callbacksThrough).not.toBeNull();
  expect(report.hourly.filter(bucket => bucket.outcome === "sent").map(bucket => new Date(bucket.hour).toISOString()))
    .toEqual(["2026-11-01T05:00:00.000Z", "2026-11-01T06:00:00.000Z"]);
  expect(report.links).toEqual(expect.arrayContaining([
    { campaignId: first, revision: 1, linkId: 1, count: 2 }, { campaignId: second, revision: 1, linkId: 1, count: 1 },
  ]));
  const campaign = await newsletterAnalytics(db.db, owner, tenant, { campaignId: first }, range);
  expect(campaign.counts).toMatchObject({ sent: 1, clicked: 1 });
  const spring = await newsletterAnalytics(db.db, owner, tenant, { listId: list },
    { from: "2026-03-08", until: "2026-03-09", timeZone: "America/New_York" });
  expect(spring.counts).toMatchObject({ sent: 0, delivered: null, opened: null });
  expect(spring.links).toBeNull();
});

it("provides reusable versioned templates and synthetic preview/test send with metadata-only audit", async () => {
  const template = await saveNewsletterTemplate(db.db, admin, tenant, { name: "Reusable", content });
  expect((await saveNewsletterTemplate(db.db, admin, tenant, { name: "Updated", content, expectedVersion: 1 }, template.id)).version).toBe(2);
  await expect(saveNewsletterTemplate(db.db, admin, tenant, { name: "Stale", content, expectedVersion: 1 }, template.id)).rejects.toMatchObject({ status: 409 });
  const campaign = await draft(await newList());
  const preview = await previewNewsletterCampaign(db.db, admin, tenant, campaign);
  expect(preview.html).toContain("123 Synthetic Street");
  expect(preview.text).toContain("Unsubscribe");
  expect(await testNewsletterCampaign(db.db, admin, tenant, campaign, runtime)).toEqual({ outcome: "accepted" });
  expect(await deliveries(campaign)).toEqual([]);
  expect((await db.admin.query("select metadata from audit_logs where target_id=$1 order by created_at", [campaign])).rows)
    .toEqual([{ metadata: { version: "1" } }, { metadata: { version: "1" } }]);
});

it("allows all-newsletters one-click opt-out from a saved CRM view", async () => {
  const reader = await person("All preference probe");
  const view = await createView(db.db, owner, tenant, { name: "All preference", objectType: "person", shared: true,
    state: fullState({ q: "All preference probe" }) });
  const campaign = (await saveNewsletterCampaign(db.db, owner, tenant, { ...input(await newList()),
    audience: { kind: "view", viewId: view.id } })).campaign.id;
  const delegate = provider.deliver.bind(provider);
  let unsubscribe = "";
  const capture = vi.spyOn(provider, "deliver").mockImplementationOnce((cred, mail) => {
    unsubscribe = mail.unsubscribe;
    return delegate(cred, mail);
  });
  await approve(campaign);
  await run();
  capture.mockRestore();
  expect(new URL(unsubscribe).searchParams.get("scope")).toBe("all");
  await unsubscribeNewsletter(db.db, "all", new URL(unsubscribe).searchParams.get("token"));
  const rows = (await db.admin.query("select status from contact_consents where tenant_id=$1 and contact_id=$2 and purpose='newsletter' order by recorded_at",
    [tenant, reader.contactId])).rows;
  expect(rows).toEqual([{ status: "granted" }, { status: "withdrawn" }]);
});

it("keeps accepted deliveries while cancelling pending retries and reconciles an expired lease", async () => {
  const list = await newList();
  await person("First cancellable", list);
  await person("Second cancellable", list);
  const campaign = await draft(list);
  const delegate = provider.deliver.bind(provider);
  const capture = vi.spyOn(provider, "deliver")
    .mockImplementationOnce((cred, mail) => delegate(cred, mail))
    .mockResolvedValueOnce({ outcome: "retry" });
  await approve(campaign);
  await run();
  capture.mockRestore();
  await cancelNewsletterCampaign(db.db, owner, tenant, campaign, { version: 1 });
  expect((await deliveries(campaign)).map(job => job.state).sort()).toEqual(["accepted", "cancelled"]);

  const expiring = await draft(list);
  await approve(expiring);
  await stage();
  const { rows: [lease] } = await db.workerPool.query("select * from public.newsletter_claim(1)");
  const started = await db.workerPool.query("select * from public.newsletter_start($1,$2,$3,$4)",
    [tenant, lease.delivery_id, lease.lease_id, randomBytes(32).toString("base64url")]);
  expect(started.rows).toHaveLength(1);
  await db.admin.query("update newsletter_deliveries set lease_until=clock_timestamp()-interval '1 second' where id=$1", [lease.delivery_id]);
  await run();
  expect(await deliveries(expiring)).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: lease.delivery_id, state: "queued", attempts: 1, reconciliations: 1 }),
  ]));
  await cancelNewsletterCampaign(db.db, owner, tenant, expiring, { version: 1 });
});

it("throttles handoff before attempting a send", async () => {
  const list = await newList();
  await person("Throttled subscriber", list);
  const campaign = await draft(list);
  await approve(campaign);
  const rateKey = `newsletter-dispatch:${tenant}`;
  await db.admin.query(`insert into newsletter_intake_limits(key,window_start,expires_at,count)
    values($1,date_trunc('minute',clock_timestamp())+interval '1 minute',clock_timestamp()+interval '2 minutes',30)
    on conflict(key) do update set window_start=excluded.window_start,expires_at=excluded.expires_at,count=excluded.count`, [rateKey]);
  try {
    await run();
    expect(await deliveries(campaign)).toMatchObject([{ state: "queued", attempts: 0 }]);
  } finally {
    await db.admin.query("delete from newsletter_intake_limits where key=$1", [rateKey]);
    await cancelNewsletterCampaign(db.db, owner, tenant, campaign, { version: 1 });
  }
});
