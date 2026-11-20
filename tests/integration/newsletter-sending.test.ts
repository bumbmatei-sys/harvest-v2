import { createHmac, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { users } from "../../src/db/schema";
import { createContact, eraseContact, recordConsent } from "../../src/server/contacts";
import { mergeContacts, previewMerge } from "../../src/server/crm-merge";
import { addNewsletterSubscriber, createNewsletterAudience, createNewsletterList, setNewsletterSubscription } from "../../src/server/newsletter";
import { cancelCampaign, dispatchCampaign, duplicateCampaign, getCampaign, reviewCampaign, testCampaign, writeCampaign } from "../../src/server/newsletter-campaigns/campaigns";
import { createIdentity, updateIdentity } from "../../src/server/newsletter-campaigns/identities";
import { estimateRecipients } from "../../src/server/newsletter-campaigns/recipients";
import { FakeNewsletterProvider } from "../../src/server/newsletter-campaigns/fake-provider";
import { runNewsletterWorker } from "../../src/server/newsletter-campaigns/worker";
import { newsletterCallback } from "../../src/server/newsletter-campaigns/callback";
import { newsletterAnalytics } from "../../src/server/newsletter-campaigns/analytics";
import { writeTemplate } from "../../src/server/newsletter-campaigns/templates";
import { withTenant } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

const owner = "sending-owner", otherOwner = "sending-other", member = "sending-member";
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", HARVEST_NEWSLETTER_WORKER_ENABLED: "1", HARVEST_NEWSLETTER_TOKEN_KEY: "72".repeat(32) };
const callbackKey = "54".repeat(32);
const dispatch = { mode: "now" } as const;
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, other: string, audience: string, senderId: string, replyToId: string, foreignList: string;

beforeAll(async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected_network"));
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values([owner, otherOwner, member].map(id => ({ id, name: id, email: id + "@example.test" })));
  tenant = (await createWorkspace(fixture.db, owner, "Sending ministry", "church")).tenantId;
  other = (await createWorkspace(fixture.db, otherOwner, "Other ministry", "church")).tenantId;
  await fixture.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'member')", [tenant, member]);
  audience = (await createNewsletterAudience(fixture.db, owner, tenant, { name: "Audience" })).id;
  const foreignAudience = await createNewsletterAudience(fixture.db, otherOwner, other, { name: "Other audience" });
  foreignList = (await createNewsletterList(fixture.db, otherOwner, other, foreignAudience.id, { name: "Other list" })).id;
  senderId = (await createIdentity(fixture.db, owner, tenant, { address: "sender@example.test" })).identity.id;
  replyToId = (await createIdentity(fixture.db, owner, tenant, { address: "replies@example.test" })).identity.id;
}, 60_000);
afterAll(async () => {
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  await fixture?.close();
});

const makeList = async () => (await createNewsletterList(fixture.db, owner, tenant, audience, { name: "List" })).id;
const content = [{ type: "richText", doc: { type: "doc", content: [
  { type: "paragraph", content: [{ type: "text", text: "Hi {{firstName}}, from {{ministryName}}" }] },
] } }];
const input = (listIds: string[]) => ({ name: "Campaign", subject: "Ministry news", content, senderId, replyToId,
  selection: { listIds, segmentIds: [] } });
const draft = (listIds: string[]) => writeCampaign(fixture.db, owner, tenant, input(listIds));
async function review(id: string, version = 1) {
  return reviewCampaign(fixture.db, owner, tenant, id, { version, dispatch });
}
async function queue(list: string) {
  const campaign = await draft([list]);
  const reviewed = await review(campaign.id);
  await dispatchCampaign(fixture.db, owner, tenant, campaign.id, { dispatch, token: reviewed.token, version: reviewed.version }, "now");
  return campaign.id;
}
const worker = (provider = new FakeNewsletterProvider(), options?: Parameters<typeof runNewsletterWorker>[3]) =>
  runNewsletterWorker(fixture.workerPool, env, provider, options);

function consent(contactId: string, status: "granted" | "withdrawn") {
  return recordConsent(fixture.db, owner, tenant, contactId, { purpose: "newsletter", channel: "email",
    status, source: "test", evidence: "Synthetic consent", noticeVersion: "notice-v1" });
}

async function subscribe(listIds: string[], grant = true) {
  const email = randomUUID() + "@example.test";
  const contact = await createContact(fixture.db, owner, tenant, { name: "Taylor Example", email });
  if (grant) await consent(contact.id, "granted");
  const subscriber = await addNewsletterSubscriber(fixture.db, owner, tenant, { contactId: contact.id });
  for (const listId of listIds) await setNewsletterSubscription(fixture.db, owner, tenant, listId, subscriber.id,
    { state: grant ? "subscribed" : "unsubscribed", version: 0 });
  return { contactId: contact.id, subscriberId: subscriber.id, email };
}

async function rows(campaign: string) {
  return (await fixture.admin.query("select * from newsletter_deliveries where campaign_id=$1 order by id", [campaign])).rows;
}
const status = async (campaign: string) => (await getCampaign(fixture.db, owner, tenant, campaign)).state;

it("uses scoped immutable revisions, synthetic sender identities and independently copied templates", async () => {
  const list = await makeList();
  const person = await subscribe([list]);
  const template = await writeTemplate(fixture.db, owner, tenant, { name: "Template", content });
  const campaign = await writeCampaign(fixture.db, owner, tenant, { ...input([list]), content: undefined, templateId: template.id });
  await writeTemplate(fixture.db, owner, tenant, { name: "Changed", version: 1, content: [{ type: "divider" }] }, template.id);
  expect((await getCampaign(fixture.db, owner, tenant, campaign.id)).content).toEqual(content);
  await expect(writeCampaign(fixture.db, owner, tenant, input([foreignList]))).rejects.toMatchObject({ status: 404 });
  await expect(getCampaign(fixture.db, member, tenant, campaign.id)).rejects.toMatchObject({ status: 404 });
  await expect(getCampaign(fixture.db, otherOwner, other, campaign.id)).rejects.toMatchObject({ status: 404 });
  expect(await withTenant(fixture.db, member, tenant, "workspace:read", async tx =>
    (await tx.execute(sql`select id from newsletter_campaigns`)).rows)).toEqual([]);
  expect(await withTenant(fixture.db, otherOwner, other, "newsletter:campaigns", async tx =>
    (await tx.execute(sql`select id from newsletter_campaigns`)).rows)).toEqual([]);
  await expect(withTenant(fixture.db, owner, tenant, "newsletter:campaigns", tx =>
    tx.execute(sql`update newsletter_campaign_revisions set subject='changed'`))).rejects.toMatchObject({ cause: { code: "42501" } });
  for (const pool of [fixture.pool, fixture.admin]) {
    await expect(pool.query("select public.newsletter_delivery_claim(1,10)")).rejects.toHaveProperty("code", "42501");
  }
  await expect(fixture.workerPool.query("select * from newsletter_deliveries")).rejects.toHaveProperty("code", "42501");
  expect(await testCampaign(fixture.db, owner, tenant, campaign.id, "sending-owner@example.test")).toEqual({
    test: true, mailbox: "synthetic", state: "accepted",
  });
  expect(await rows(campaign.id)).toEqual([]);
  const old = await review(campaign.id);
  expect(JSON.stringify(old)).not.toContain(person.email);
  const updated = await writeCampaign(fixture.db, owner, tenant, { ...input([list]), version: old.version,
    subject: "Changed" }, campaign.id);
  expect(updated).toMatchObject({ revision: 2, state: "draft", subject: "Changed" });
  await expect(dispatchCampaign(fixture.db, owner, tenant, campaign.id, { version: old.version, token: old.token, dispatch },
    "now")).rejects.toHaveProperty("status", 409);
  expect((await duplicateCampaign(fixture.db, owner, tenant, campaign.id, { name: "Copy" })).revision).toBe(1);
  const current = await review(campaign.id, updated.version);
  await dispatchCampaign(fixture.db, owner, tenant, campaign.id, { version: current.version, token: current.token, dispatch }, "now");
  await expect(writeCampaign(fixture.db, owner, tenant, { ...input([list]), version: current.version + 1 }, campaign.id)).rejects.toHaveProperty("status", 409);
  await cancelCampaign(fixture.db, owner, tenant, campaign.id, { version: current.version + 1 });
  expect(await status(campaign.id)).toBe("cancelled");
});

it("deduplicates lists, refuses changed membership and binds the reviewed schedule and timezone", async () => {
  const list = await makeList(), second = await makeList();
  await subscribe([list, second]);
  await subscribe([second], false);
  expect(await estimateRecipients(fixture.db, owner, tenant, { listIds: [list, second, list] })).toEqual({
    kind: "estimate", selected: 2, eligible: 1, skipped: { not_subscribed: 1 },
  });
  const campaign = await draft([list, second]);
  const scheduled = { mode: "schedule", schedule: { at: "2032-11-07T01:30:00-05:00", timezone: "America/New_York" } };
  const first = await reviewCampaign(fixture.db, owner, tenant, campaign.id, { version: 1, dispatch: scheduled });
  await subscribe([list]);
  await expect(dispatchCampaign(fixture.db, owner, tenant, campaign.id, { version: first.version, token: first.token, dispatch: scheduled },
    "schedule")).rejects.toHaveProperty("status", 409);
  const fresh = await reviewCampaign(fixture.db, owner, tenant, campaign.id, { version: first.version, dispatch: scheduled });
  await expect(dispatchCampaign(fixture.db, owner, tenant, campaign.id, { version: fresh.version, token: fresh.token,
    dispatch: { ...scheduled, schedule: { ...scheduled.schedule, at: "2032-11-07T01:30:00-04:00" } } }, "schedule")).rejects.toHaveProperty("status", 409);
  const queued = await dispatchCampaign(fixture.db, owner, tenant, campaign.id, { version: fresh.version, token: fresh.token, dispatch: scheduled }, "schedule");
  expect(queued.scheduledAt.toISOString()).toBe("2032-11-07T06:30:00.000Z");
  expect((await worker())?.claimed).toBe(0);
  await cancelCampaign(fixture.db, owner, tenant, campaign.id, { version: queued.version });
  expect((await rows(campaign.id)).every(row => row.state === "skipped")).toBe(true);
});

it.each(["withdraw", "erase", "disable", "merge"] as const)("lets %s win after claim and before authorization", async action => {
  const list = await makeList(), person = await subscribe([list]);
  const campaign = await queue(list);
  const provider = new FakeNewsletterProvider(), submit = vi.spyOn(provider, "submit");
  const result = await worker(provider, { beforeAuthorize: async () => {
    if (action === "withdraw") await consent(person.contactId, "withdrawn");
    if (action === "erase") await eraseContact(fixture.db, owner, tenant, person.contactId);
    if (action === "merge") {
      const target = await createContact(fixture.db, owner, tenant, { name: "Target" });
      const preview = await previewMerge(fixture.db, owner, tenant, target.id, person.contactId);
      await mergeContacts(fixture.db, owner, tenant, target.id, { sourceId: person.contactId,
        targetVersion: preview.kept.version, sourceVersion: preview.merged.version });
    }
    if (action === "disable") await updateIdentity(fixture.db, owner, tenant, senderId, { enabled: false, version: 1 });
  } });
  expect(result).toMatchObject({ claimed: 1, errors: 0 });
  expect(submit).not.toHaveBeenCalled();
  expect((await rows(campaign))[0]).toMatchObject({ state: "skipped", attempted_at: null });
  if (action === "erase" || action === "merge") expect((await rows(campaign))[0].subscriber_id).toBeNull();
  expect(await status(campaign)).toBe("failed");
  if (action === "disable") await updateIdentity(fixture.db, owner, tenant, senderId, { enabled: true, version: 2 });
});

it("recovers a lost lease and unknown receipt using the same idempotency key and accepts replay-safe out-of-order callbacks", async () => {
  const list = await makeList();
  const person = await subscribe([list]);
  const campaign = await queue(list);
  const provider = new FakeNewsletterProvider(undefined, true);
  const submit = vi.spyOn(provider, "submit");
  const queryStatus = vi.spyOn(provider, "status");
  const { rows: [{ claimed: [lease] }] } = await fixture.workerPool.query("select public.newsletter_delivery_claim(1,2) as claimed");
  expect((await worker(provider))?.claimed).toBe(0);
  await fixture.admin.query("update newsletter_deliveries set lease_until=now()-interval '1 second' where id=$1", [lease.key]);
  expect((await worker(provider))?.claimed).toBe(1);
  const [unknown] = await rows(campaign);
  expect(unknown.state).toBe("unknown");
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit.mock.calls[0][0]).toMatchObject({ idempotencyKey: unknown.id, to: person.email });
  expect(submit.mock.calls[0][0].headers["List-Unsubscribe"]).toMatch(/token=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  expect((await fixture.workerPool.query("select public.newsletter_delivery_complete($1,$2,$3,'accepted',$2) as completed",
    [tenant, unknown.id, lease.lease])).rows[0].completed).toBe(false);
  await fixture.admin.query("update newsletter_deliveries set next_check_at=now() where id=$1", [unknown.id]);
  expect((await worker(provider))?.claimed).toBe(1);
  expect(queryStatus).toHaveBeenCalledWith(unknown.id);
  expect(submit).toHaveBeenCalledTimes(1);

  const received = new Date(Date.now() + 1000);
  const incoming = async (type: string, delay: number, authentic = true) => {
    const body = JSON.stringify({ reference: unknown.id, type, at: new Date(received.getTime() + delay).toISOString(),
      email: person.email, raw: "secret raw text" });
    const timestamp = received.getTime().toString();
    const signature = createHmac("sha256", Buffer.from(callbackKey, "hex")).update(timestamp + "." + body).digest("hex");
    const request = new Request("https://example.test/callback", { method: "POST", body,
      headers: { "x-newsletter-timestamp": timestamp, "x-newsletter-signature": authentic ? signature : "0".repeat(64) } });
    return newsletterCallback(request, { ...env, HARVEST_NEWSLETTER_CALLBACK_ENABLED: "1",
      HARVEST_NEWSLETTER_CALLBACK_KEY: callbackKey, WORKER_DATABASE_URL: fixture.workerURL },
    url => new Pool({ connectionString: url }), received);
  };
  expect((await incoming("complained", 3, false)).status).toBe(202);
  expect((await rows(campaign))[0].complained_at).toBeNull();
  for (const [type, delay] of [["complained", 30], ["delivered", -10], ["complained", 30]] as const) {
    expect((await incoming(type, delay)).status).toBe(202);
  }
  const [outcome] = await rows(campaign);
  expect(outcome).toMatchObject({ state: "accepted", delivered_at: expect.any(Date), complained_at: expect.any(Date) });
  expect(JSON.stringify(outcome)).not.toMatch(/secret raw text|@example\.test/);
  expect((await estimateRecipients(fixture.db, owner, tenant, { listIds: [list] })).skipped).toEqual({ global_suppressed: 1 });
  const logs = await fixture.admin.query("select * from audit_logs where action like 'newsletter.%'");
  expect(JSON.stringify(logs.rows)).not.toContain(person.email);
});

it("cancels in-flight pending work and reports aggregate denominators and missing evidence", async () => {
  const list = await makeList();
  for (let index = 0; index < 5; index++) await subscribe([list]);
  await subscribe([list], false);
  const campaign = await queue(list);
  const before = await newsletterAnalytics(fixture.db, owner, tenant, {}, campaign);
  expect(before.totals).toMatchObject({ selected: 6, currentlyEligible: 5, queued: 5,
    providerAccepted: { state: "unavailable", count: null } });
  const provider = new FakeNewsletterProvider();
  const original = provider.submit.bind(provider);
  vi.spyOn(provider, "submit").mockImplementationOnce(async message => {
    const current = await getCampaign(fixture.db, owner, tenant, campaign);
    await cancelCampaign(fixture.db, owner, tenant, campaign, { version: current.version });
    return original(message);
  });
  await worker(provider);
  expect(provider.submit).toHaveBeenCalledTimes(1);
  expect(await status(campaign)).toBe("cancelled");
  const report = await newsletterAnalytics(fixture.db, owner, tenant, {}, campaign);
  expect(report.totals).toMatchObject({ selected: 6, currentlyEligible: 5, skipped: 5, queued: 0, attempted: 1,
    providerAccepted: { state: "recorded", count: 1 }, outcomes: { delivered: { state: "pending", count: null } },
    denominators: { attempt: 6, accept: 1, delivery: 1 } });
  await expect(newsletterAnalytics(fixture.db, member, tenant, {}, campaign)).rejects.toHaveProperty("status", 404);
});

it("invalidates list and saved segment reviews and preserves shared view deletion", async () => {
  const list = await makeList();
  await subscribe([list]);
  const { createNewsletterSegment } = await import("../../src/server/newsletter");
  const { createView, updateView, deleteView } = await import("../../src/server/crm-views");
  const { fullState } = await import("../../src/lib/crm-fields");
  const view = await createView(fixture.db, owner, tenant, { objectType: "person", name: "Shared",
    shared: true, state: fullState({}) });
  const segment = await createNewsletterSegment(fixture.db, owner, tenant, audience, { name: "Pinned", savedViewId: view.id });
  const campaign = await writeCampaign(fixture.db, owner, tenant, { ...input([list]), selection: { listIds: [list], segmentIds: [segment.id] } });
  const reviewed = await review(campaign.id);
  await updateView(fixture.db, owner, tenant, "person", view.id, { name: "Renamed", version: view.version });
  await expect(dispatchCampaign(fixture.db, owner, tenant, campaign.id, { dispatch, token: reviewed.token,
    version: reviewed.version }, "now")).rejects.toHaveProperty("status", 404);
  await expect(deleteView(fixture.db, owner, tenant, "person", view.id)).resolves.toBeTruthy();
  expect((await getCampaign(fixture.db, owner, tenant, campaign.id)).selectionNeedsReview).toBe(true);

  const live = await queue(list);
  const provider = new FakeNewsletterProvider();
  const submit = vi.spyOn(provider, "submit");
  await worker(provider, { beforeAuthorize: async () => {
    await withTenant(fixture.db, owner, tenant, "newsletter:manage", tx =>
      tx.execute(sql`update newsletter_lists set name='Changed' where id=${list}::uuid`));
  } });
  expect(submit).not.toHaveBeenCalled();
  expect((await rows(live))[0]).toMatchObject({ state: "skipped", skip_reason: "review_invalidated" });
});

it("blocks duplicate target delivery after an accepted source merges and suppresses the erased source's cohort", async () => {
  const list = await makeList();
  const first = await subscribe([list]), second = await subscribe([list]);
  const campaign = await queue(list);
  const provider = new FakeNewsletterProvider();
  const submit = vi.spyOn(provider, "submit");
  await worker(provider, { limit: 1 });
  const accepted = (await rows(campaign)).find(row => row.state === "accepted");
  expect(accepted).toBeTruthy();
  const [source, target] = accepted.subscriber_id === first.subscriberId ? [first, second] : [second, first];
  const preview = await previewMerge(fixture.db, owner, tenant, target.contactId, source.contactId);
  await mergeContacts(fixture.db, owner, tenant, target.contactId, { sourceId: source.contactId,
    sourceVersion: preview.merged.version, targetVersion: preview.kept.version });
  await worker(provider);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(await status(campaign)).toBe("partial");
  await fixture.workerPool.query("select public.newsletter_delivery_event($1,'bounced',now())", [accepted.id]);
  const after = await rows(campaign);
  expect(after.find(row => row.id === accepted.id)).toMatchObject({ subscriber_id: null, address_binding: null,
    suppression_subscriber_id: target.subscriberId, bounced_at: expect.any(Date) });
  expect((await estimateRecipients(fixture.db, owner, tenant, { listIds: [list] })).skipped).toEqual({ global_suppressed: 1 });
  expect((await newsletterAnalytics(fixture.db, owner, tenant, {}, campaign)).totals).toEqual({ visibility: "suppressed" });
  await expect(fixture.pool.query("select attempted_at from newsletter_deliveries")).rejects.toHaveProperty("code", "42501");
});
