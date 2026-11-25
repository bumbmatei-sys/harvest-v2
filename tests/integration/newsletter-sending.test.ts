import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
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
import { purgeNewsletterDeliveries, recheckNewsletterDomains } from "../../src/server/newsletter-campaigns/maintenance";
import { issueNewsletterPreference, unsubscribeNewsletter } from "../../src/server/newsletter-public";
import { newsletterCallback } from "../../src/server/newsletter-campaigns/callback";
import { newsletterAnalytics } from "../../src/server/newsletter-campaigns/analytics";
import { saveMailingAddress } from "../../src/server/newsletter-campaigns/sender-setup";
import { writeTemplate } from "../../src/server/newsletter-campaigns/templates";
import { withTenant } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

const owner = "sending-owner", otherOwner = "sending-other", member = "sending-member";
const pepper = randomBytes(32).toString("hex");
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", HARVEST_NEWSLETTER_WORKER_ENABLED: "1", HARVEST_NEWSLETTER_TOKEN_KEY: "72".repeat(32),
  HARVEST_NEWSLETTER_SUPPRESSION_KEYS: JSON.stringify([pepper]) };
const callbackKey = "54".repeat(32);
const dispatch = { mode: "now" } as const;
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let senderVersion = 2;
let tenant: string, other: string, audience: string, senderId: string, replyToId: string, foreignList: string;

beforeAll(async () => {
  vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", env.HARVEST_NEWSLETTER_SUPPRESSION_KEYS);
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected_network"));
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values([owner, otherOwner, member].map(id => ({ id, name: id, email: id + "@example.test" })));
  tenant = (await createWorkspace(fixture.db, owner, "Sending ministry", "church")).tenantId;
  other = (await createWorkspace(fixture.db, otherOwner, "Other ministry", "church")).tenantId;
  await fixture.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'member')", [tenant, member]);
  await saveMailingAddress(fixture.db, owner, tenant, { address: "1 Main Street, Example City" });
  audience = (await createNewsletterAudience(fixture.db, owner, tenant, { name: "Audience" })).id;
  const foreignAudience = await createNewsletterAudience(fixture.db, otherOwner, other, { name: "Other audience" });
  foreignList = (await createNewsletterList(fixture.db, otherOwner, other, foreignAudience.id, { name: "Other list" })).id;
  const sender = await verifyMailbox("sender@sending.example.test", "sender");
  senderId = sender.identity.id;
  expect(sender.domain?.status).toBe("pending");
  expect(sender.domain?.records.map(record => record.purpose)).toEqual(["ownership", "dkim", "spf", "bounce", "dmarc"]);
  expect(sender.domain).toMatchObject({ dmarc: false });
  expect(sender.domain?.records.at(-1)).toEqual({
    purpose: "dmarc", type: "TXT", name: "_dmarc.sending.example.test", value: "v=DMARC1; p=none",
  });
  replyToId = (await verifyMailbox("external-replies@outlook.com", "reply-to")).identity.id;
  expect(await recheckDomains()).toEqual({ checked: 1 });
}, 60_000);
afterAll(async () => {
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fixture?.close();
});

const recheckDomains = (provider = new FakeNewsletterProvider()) => recheckNewsletterDomains(fixture.workerPool,
  { ...env, HARVEST_NEWSLETTER_DOMAIN_RECHECK_ENABLED: "1" }, provider);

async function verifyMailbox(address: string, purpose: "sender" | "reply-to") {
  const confirmMailbox = vi.fn<FakeNewsletterProvider["confirmMailbox"]>();
  const created = await createIdentity(fixture.db, owner, tenant, { address, purpose }, { confirmMailbox });
  expect(created.identity).toMatchObject({ ownershipVerified: false, confirmationPending: true });
  expect(confirmMailbox.mock.calls[0][0].to).toBe(address);
  const code = confirmMailbox.mock.calls[0][0].text.split(" ").at(-1);
  expect(JSON.stringify(created)).not.toContain(code);
  return updateIdentity(fixture.db, owner, tenant, created.identity.id, { action: "confirm", code, version: 1 });
}

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
  const at = new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const scheduled = { mode: "schedule", schedule: { at, timezone: "UTC" } };
  const first = await reviewCampaign(fixture.db, owner, tenant, campaign.id, { version: 1, dispatch: scheduled });
  await subscribe([list]);
  await expect(dispatchCampaign(fixture.db, owner, tenant, campaign.id, { version: first.version, token: first.token, dispatch: scheduled },
    "schedule")).rejects.toHaveProperty("status", 409);
  const fresh = await reviewCampaign(fixture.db, owner, tenant, campaign.id, { version: first.version, dispatch: scheduled });
  await expect(dispatchCampaign(fixture.db, owner, tenant, campaign.id, { version: fresh.version, token: fresh.token,
    dispatch: { ...scheduled, schedule: { at: new Date(Date.parse(at) + 3600_000).toISOString().replace(".000Z", "Z"), timezone: "Etc/UTC" } } }, "schedule")).rejects.toHaveProperty("status", 409);
  const queued = await dispatchCampaign(fixture.db, owner, tenant, campaign.id, { version: fresh.version, token: fresh.token, dispatch: scheduled }, "schedule");
  expect(queued.scheduledAt.getTime()).toBe(Date.parse(at));
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
    if (action === "disable") await updateIdentity(fixture.db, owner, tenant, senderId, { enabled: false, version: senderVersion++ });
  } });
  expect(result).toMatchObject({ claimed: 1, errors: 0 });
  expect(submit).not.toHaveBeenCalled();
  expect((await rows(campaign))[0]).toMatchObject({ state: "skipped", attempted_at: null });
  if (action === "erase" || action === "merge") expect((await rows(campaign))[0].subscriber_id).toBeNull();
  expect(await status(campaign)).toBe("failed");
  if (action === "disable") await updateIdentity(fixture.db, owner, tenant, senderId, { enabled: true, version: senderVersion++ });
});

it("puts the sender's display name in the From header, quoted or encoded as the standard requires", async () => {
  for (const [name, expected] of [["Smith, Anna", '"Smith, Anna" <sender@sending.example.test>'], ["Grace Church", "Grace Church <sender@sending.example.test>"],
    ["Église", "=?UTF-8?B?w4lnbGlzZQ==?= <sender@sending.example.test>"], [null, "sender@sending.example.test"]] as const) {
    await updateIdentity(fixture.db, owner, tenant, senderId, { displayName: name, version: senderVersion++ });
    const list = await makeList();
    const person = await subscribe([list]);
    await queue(list);
    const provider = new FakeNewsletterProvider(), submit = vi.spyOn(provider, "submit");
    await worker(provider);
    expect(submit.mock.calls.find(([message]) => message.to === person.email)?.[0].from).toBe(expected);
  }
  await updateIdentity(fixture.db, owner, tenant, senderId, { displayName: null, version: senderVersion++ });
});

it("recovers a lost lease and reconciles a lost receipt by delivery tag and accepts replay-safe out-of-order callbacks", async () => {
  const list = await makeList();
  const person = await subscribe([list]);
  const campaign = await queue(list);
  const provider = new FakeNewsletterProvider(undefined, true);
  const submit = vi.spyOn(provider, "submit");
  const { rows: [{ claimed: [lease] }] } = await fixture.workerPool.query("select public.newsletter_delivery_claim(1,2) as claimed");
  expect((await worker(provider))?.claimed).toBe(0);
  await fixture.admin.query("update newsletter_deliveries set lease_until=now()-interval '1 second' where id=$1", [lease.key]);
  expect((await worker(provider))?.claimed).toBe(1);
  const [unknown] = await rows(campaign);
  expect(unknown.state).toBe("unknown");
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit.mock.calls[0][0]).toMatchObject({ deliveryId: unknown.id, to: person.email, from: "sender@sending.example.test", replyTo: "external-replies@outlook.com" });
  expect(submit.mock.calls[0][0].headers["List-Unsubscribe"]).toMatch(/token=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  expect((await fixture.workerPool.query("select public.newsletter_delivery_complete($1,$2,$3,'accepted',$4) as completed",
    [tenant, unknown.id, lease.lease, "stale-receipt"])).rows[0].completed).toBe(false);
  await fixture.admin.query("update newsletter_deliveries set next_check_at=now() where id=$1", [unknown.id]);
  expect((await worker(provider))?.claimed).toBe(0);
  expect((await rows(campaign))[0].provider_ref).toBeNull();
  expect(provider.receiptForTest(unknown.id)).not.toBe(unknown.id);
  expect(submit).toHaveBeenCalledTimes(1);

  const received = new Date(Date.now() + 1000);
  const incoming = async (type: string, delay: number, authentic = true, reference = provider.receiptForTest(unknown.id),
    messageId = randomUUID(), validBody = true) => {
    const body = JSON.stringify({ messageId: validBody ? messageId : "invalid", deliveryId: unknown.id, reference, type, at: new Date(received.getTime() + delay).toISOString(),
      email: person.email, raw: "secret raw text" });
    const timestamp = received.getTime().toString();
    const signature = createHmac("sha256", Buffer.from(callbackKey, "hex")).update(timestamp + "." + body).digest("hex");
    const request = new Request("https://example.test/callback", { method: "POST", body,
      headers: { "x-newsletter-timestamp": timestamp, "x-newsletter-signature": authentic ? signature : "0".repeat(64) } });
    return newsletterCallback(request, { ...env, HARVEST_NEWSLETTER_CALLBACK_ENABLED: "1",
      HARVEST_NEWSLETTER_CALLBACK_KEY: callbackKey, WORKER_DATABASE_URL: fixture.workerURL },
    url => new Pool({ connectionString: url }), received);
  };
  const unverifiedResponse = await incoming("complained", 3, false);
  const malformedResponse = await incoming("complained", 3, true, undefined, undefined, false);
  expect([unverifiedResponse.status, malformedResponse.status]).toEqual([202, 202]);
  expect([...malformedResponse.headers]).toEqual([...unverifiedResponse.headers]);
  expect(await malformedResponse.text()).toBe(await unverifiedResponse.text());
  expect((await rows(campaign))[0].complained_at).toBeNull();
  const carrierList = await makeList();
  await subscribe([carrierList]);
  const carrier = await queue(carrierList);
  await worker();
  const [otherAttempt] = await rows(carrier);
  const messageId = randomUUID();
  await fixture.admin.query("update newsletter_deliveries set provider_ref=$1 where id=$2",
    [provider.receiptForTest(unknown.id), otherAttempt.id]);
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect((await incoming("complained", 30, true, undefined, messageId)).status).toBe(503);
  } finally { quiet.mockRestore(); }
  expect((await fixture.admin.query("select 1 from newsletter_callback_receipts where message_id=$1", [messageId])).rowCount).toBe(0);
  await fixture.admin.query("update newsletter_deliveries set provider_ref=$1 where id=$2", [otherAttempt.provider_ref, otherAttempt.id]);
  expect((await incoming("complained", 30, true, undefined, messageId)).status).toBe(202);
  expect((await incoming("complained", 30, true, undefined, messageId)).status).toBe(202);
  expect((await incoming("bounced", 35, true, undefined, messageId)).status).toBe(202);
  expect((await incoming("delivered", -10)).status).toBe(202);
  await incoming("bounced", 35, true, "foreign-receipt");
  expect((await fixture.admin.query("select 1 from newsletter_callback_receipts where message_id=$1", [messageId])).rowCount).toBe(1);
  const [outcome] = await rows(campaign);
  expect(outcome).toMatchObject({ state: "accepted", provider_ref: provider.receiptForTest(unknown.id), delivered_at: expect.any(Date), complained_at: expect.any(Date), bounced_at: null });
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

it("runs the delivery wrapper, preference wrapper and core CRM merge in one transaction", async () => {
  const list = await makeList();
  const first = await subscribe([list]), second = await subscribe([list]);
  const campaign = await queue(list);
  const provider = new FakeNewsletterProvider();
  const submit = vi.spyOn(provider, "submit");
  await worker(provider, { limit: 1 });
  const accepted = (await rows(campaign)).find(row => row.state === "accepted");
  expect(accepted).toBeTruthy();
  const [source, target] = accepted.subscriber_id === first.subscriberId ? [first, second] : [second, first];
  const preferences = await makeList();
  await setNewsletterSubscription(fixture.db, owner, tenant, preferences, source.subscriberId, { state: "unsubscribed", version: 0 });
  const preview = await previewMerge(fixture.db, owner, tenant, target.contactId, source.contactId);
  await mergeContacts(fixture.db, owner, tenant, target.contactId, { sourceId: source.contactId,
    sourceVersion: preview.merged.version, targetVersion: preview.kept.version });
  await worker(provider);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(await status(campaign)).toBe("partial");
  expect((await fixture.admin.query("select state from newsletter_subscriptions where list_id=$1 and subscriber_id=$2",
    [preferences, target.subscriberId])).rows).toEqual([{ state: "unsubscribed" }]);
  expect((await fixture.admin.query("select id from contacts where id=$1 and erased_at is null", [source.contactId])).rows)
    .toEqual([]);
  expect((await fixture.admin.query("select count(*)::int as n from contact_consents where contact_id=$1 and status='granted'",
    [target.contactId])).rows[0].n).toBe(2);
  await fixture.workerPool.query("select public.newsletter_delivery_event($1,$2,'bounced',now())", [accepted.id, accepted.provider_ref]);
  const after = await rows(campaign);
  expect(after.find(row => row.id === accepted.id)).toMatchObject({ subscriber_id: null, address_binding: null,
    suppression_subscriber_id: target.subscriberId, bounced_at: expect.any(Date) });
  expect((await estimateRecipients(fixture.db, owner, tenant, { listIds: [list] })).skipped).toEqual({ global_suppressed: 1 });
  expect((await newsletterAnalytics(fixture.db, owner, tenant, {}, campaign)).totals).toEqual({ visibility: "suppressed" });
  await expect(fixture.pool.query("select attempted_at from newsletter_deliveries")).rejects.toHaveProperty("code", "42501");
});

it("rejects expired and reused review tokens at the ten-minute boundary", async () => {
  const list = await makeList();
  await subscribe([list]);
  const campaign = await draft([list]);
  const reviewed = await review(campaign.id);
  const clock = vi.spyOn(Date, "now").mockReturnValue(reviewed.expiresAt.getTime());
  try {
    await expect(dispatchCampaign(fixture.db, owner, tenant, campaign.id, { version: reviewed.version,
      token: reviewed.token, dispatch }, "now")).rejects.toMatchObject({ status: 409 });
  } finally { clock.mockRestore(); }
  expect(await rows(campaign.id)).toEqual([]);
  const fresh = await review(campaign.id, reviewed.version);
  const send = { version: fresh.version, token: fresh.token, dispatch };
  await dispatchCampaign(fixture.db, owner, tenant, campaign.id, send, "now");
  await expect(dispatchCampaign(fixture.db, owner, tenant, campaign.id, send, "now")).rejects.toHaveProperty("status", 409);
  await cancelCampaign(fixture.db, owner, tenant, campaign.id, { version: fresh.version + 1 });
});

it("requires independent mailbox proof and blocks a domain that fails and later passes its recheck", async () => {
  const list = await makeList();
  await subscribe([list]);
  const localSender = await verifyMailbox("updates@alternate.example.test", "sender");
  const mailbox = { confirmMailbox: vi.fn<FakeNewsletterProvider["confirmMailbox"]>() };
  const unverified = await createIdentity(fixture.db, owner, tenant, { address: localSender.identity.address, purpose: "reply-to" }, mailbox);
  expect(unverified.domain).toBeNull();
  expect(unverified.identity.ownershipVerified).toBe(false);
  const current = await writeCampaign(fixture.db, owner, tenant, { ...input([list]), senderId: localSender.identity.id });
  const tryReview = () => review(current.id);
  await expect(tryReview()).rejects.toHaveProperty("status", 409);
  const dns = new FakeNewsletterProvider();
  const goodDns = dns.domain.bind(dns);
  vi.spyOn(dns, "domain").mockImplementationOnce(async (domain, records) => ({
    ...(await goodDns(domain, records))!, dmarc: false,
  }));
  expect(await recheckDomains(dns)).toEqual({ checked: 1 });
  await expect(tryReview()).rejects.toHaveProperty("status", 409);
  const makeDue = () => fixture.admin.query("update newsletter_connections set checked_at=now()-interval '25 hours' where id=$1",
    [localSender.domain?.id]);
  await makeDue();
  expect(await recheckDomains(dns)).toEqual({ checked: 1 });
  const wrongReply = await writeCampaign(fixture.db, owner, tenant, { ...input([list]), replyToId: unverified.identity.id });
  await expect(review(wrongReply.id)).rejects.toHaveProperty("status", 409);
  await expect(updateIdentity(fixture.db, owner, tenant, unverified.identity.id, { action: "confirm",
    code: "x".repeat(43), version: 1 })).rejects.toHaveProperty("status", 409);

  const reviewed = await tryReview();
  await dispatchCampaign(fixture.db, owner, tenant, current.id, { version: reviewed.version, token: reviewed.token, dispatch }, "now");
  await makeDue();
  vi.mocked(dns.domain).mockImplementationOnce(async (domain, records) => ({
    ...(await goodDns(domain, records))!, dmarc: false,
  }));
  expect(await recheckDomains(dns)).toEqual({ checked: 1 });
  // The authorization check must still enforce DMARC even when the version matches the reviewed pin.
  await fixture.admin.query("update newsletter_connections set version=version-1 where id=$1", [localSender.domain?.id]);
  const provider = new FakeNewsletterProvider(), submit = vi.spyOn(provider, "submit");
  await worker(provider);
  expect(submit).not.toHaveBeenCalled();
  expect((await rows(current.id))[0]).toMatchObject({ skip_reason: "review_invalidated", attempted_at: null });
});

it("purges bounded aged batches once and preserves anonymous analytics and address-only blocks", async () => {
  const list = await makeList();
  const recipient = await subscribe([list]);
  for (let index = 0; index < 4; index++) await subscribe([list]);
  const campaign = await queue(list);
  await worker();
  const attempt = (await rows(campaign)).find(row => row.subscriber_id === recipient.subscriberId)!;
  await fixture.workerPool.query("select public.newsletter_delivery_event($1,$2,'bounced',now())", [attempt.id, attempt.provider_ref]);
  await fixture.workerPool.query("select public.newsletter_delivery_event($1,$2,'complained',now())", [attempt.id, attempt.provider_ref]);
  const { rows: [{ day, until }] } = await fixture.admin.query(`update newsletter_deliveries set selected_at=now()-interval '91 days'
    where campaign_id=$1 returning (selected_at at time zone 'UTC')::date::text as day,
    ((selected_at at time zone 'UTC')::date+1)::text as until`, [campaign]);
  const report = () => newsletterAnalytics(fixture.db, owner, tenant, { from: day, until }, campaign);
  const before = await report();
  expect(before.totals).toMatchObject({ selected: 5, attempted: 5, currentlyEligible: 4,
    outcomes: { bounced: { state: "recorded", count: 1 } } });
  const retention = { ...env, HARVEST_NEWSLETTER_RETENTION_ENABLED: "1" };
  expect(await purgeNewsletterDeliveries(fixture.workerPool, env)).toBeNull();
  expect(await purgeNewsletterDeliveries(fixture.workerPool, { ...retention, NODE_ENV: "production" })).toBeNull();
  await expect(purgeNewsletterDeliveries(fixture.pool, retention)).rejects.toThrow("WORKER_ROLE_REQUIRED");
  await expect(purgeNewsletterDeliveries(fixture.workerPool, retention, 501)).rejects.toHaveProperty("code", "22023");
  expect(await purgeNewsletterDeliveries(fixture.workerPool, retention, 2)).toEqual({ purged: 2 });
  expect(await rows(campaign)).toHaveLength(3);
  expect((await report()).totals).toEqual({ ...before.totals, currentlyEligible: null });
  expect(await purgeNewsletterDeliveries(fixture.workerPool, retention)).toEqual({ purged: 3 });
  expect(await purgeNewsletterDeliveries(fixture.workerPool, retention)).toEqual({ purged: 0 });
  expect(await rows(campaign)).toEqual([]);
  await fixture.workerPool.query("select public.newsletter_delivery_event($1,$2,'bounced',now())", [attempt.id, attempt.provider_ref]);
  expect((await report()).totals).toEqual({ ...before.totals, currentlyEligible: null });
  const archive = (await fixture.admin.query("select * from newsletter_archived_counts where campaign_id=$1", [campaign])).rows;
  expect(archive.every(row => Object.keys(row).sort().join() === "campaign_id,count,day,metric,tenant_id")).toBe(true);
  const audit = (await fixture.admin.query("select purged from newsletter_retention_runs order by ran_at")).rows;
  expect(audit).toEqual([{ purged: 2 }, { purged: 3 }, { purged: 0 }]);

  await eraseContact(fixture.db, owner, tenant, recipient.contactId);
  const recreated = await createContact(fixture.db, owner, tenant, { name: "New contact", email: recipient.email });
  await consent(recreated.id, "granted");
  const subscriber = await addNewsletterSubscriber(fixture.db, owner, tenant, { contactId: recreated.id });
  await setNewsletterSubscription(fixture.db, owner, tenant, list, subscriber.id, { state: "subscribed", version: 0 });
  expect((await estimateRecipients(fixture.db, owner, tenant, { listIds: [list] })).skipped).toEqual({ global_suppressed: 1 });
  const blocks = (await fixture.admin.query("select * from newsletter_suppressions where reason='complaint'")).rows;
  expect(blocks.some(row => row.scope === "00000000-0000-0000-0000-000000000000" && /^[a-f0-9]{64}$/.test(row.address_hash))).toBe(true);
  expect(JSON.stringify(blocks)).not.toContain(recipient.email);
});

it("retains a list unsubscribe through erasure without widening it to other lists", async () => {
  const list = await makeList(), second = await makeList();
  const recipient = await subscribe([list]);
  vi.stubEnv("HARVEST_NEWSLETTER_TOKEN_KEY", env.HARVEST_NEWSLETTER_TOKEN_KEY);
  try {
    const token = await issueNewsletterPreference(fixture.db, owner, tenant, recipient.subscriberId, { scope: "list", listId: list });
    await unsubscribeNewsletter(fixture.db, "list", token);
  } finally { vi.stubEnv("HARVEST_NEWSLETTER_TOKEN_KEY", undefined); }
  await eraseContact(fixture.db, owner, tenant, recipient.contactId);
  const recreated = await createContact(fixture.db, owner, tenant, { name: "New contact", email: recipient.email });
  await consent(recreated.id, "granted");
  const subscriber = await addNewsletterSubscriber(fixture.db, owner, tenant, { contactId: recreated.id });
  for (const listId of [list, second]) {
    await setNewsletterSubscription(fixture.db, owner, tenant, listId, subscriber.id, { state: "subscribed", version: 0 });
  }
  expect(await estimateRecipients(fixture.db, owner, tenant, { listIds: [list] })).toMatchObject({ skipped: { list_suppressed: 1 } });
  expect(await estimateRecipients(fixture.db, owner, tenant, { listIds: [list, second] })).toMatchObject({ eligible: 1, skipped: {} });
});

it("rejects schedules beyond the review horizon at the service and database boundaries", async () => {
  const list = await makeList();
  await subscribe([list]);
  const campaign = await draft([list]);
  const at = new Date(Date.now() + 61 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  await expect(reviewCampaign(fixture.db, owner, tenant, campaign.id, { version: 1,
    dispatch: { mode: "schedule", schedule: { at, timezone: "UTC" } } })).rejects.toMatchObject({
    status: 400, details: { code: "SCHEDULE_TOO_FAR" },
  });
  const reviewed = await review(campaign.id);
  await expect(withTenant(fixture.db, owner, tenant, "newsletter:delivery", tx => tx.execute(sql`
    update public.newsletter_campaigns set state='scheduled',scheduled_at=${at}::timestamptz,
      frozen_at=now(),timezone='UTC',review_digest=null,review_expires_at=null,version=version+1
    where id=${campaign.id}::uuid`))).rejects.toHaveProperty("cause.code", "23514");
  await cancelCampaign(fixture.db, owner, tenant, campaign.id, { version: reviewed.version });
});

it("keeps address blocks under rotation and fails closed on omitted peppers", async () => {
  const list = await makeList();
  const old = await subscribe([list]);
  const campaign = await queue(list);
  await worker();
  const [attempt] = await rows(campaign);
  await fixture.workerPool.query("select public.newsletter_delivery_event($1,$2,'complained',now())", [attempt.id, attempt.provider_ref]);
  const message = "newsletter-suppression:" + tenant + ":" + old.email;
  expect(attempt.attempted_address_hash).toBe(createHmac("sha256", Buffer.from(pepper, "hex")).update(message).digest("hex"));
  expect(attempt.attempted_address_hash).not.toBe(createHash("sha256").update(message).digest("hex"));
  await eraseContact(fixture.db, owner, tenant, old.contactId);
  expect((await rows(campaign))[0]).toMatchObject({ attempted_address_hash: null, attempted_key_version: null });
  const recreated = await createContact(fixture.db, owner, tenant, { name: "New contact", email: old.email });
  await consent(recreated.id, "granted");
  const subscriber = await addNewsletterSubscriber(fixture.db, owner, tenant, { contactId: recreated.id });
  await setNewsletterSubscription(fixture.db, owner, tenant, list, subscriber.id, { state: "subscribed", version: 0 });

  const replacement = randomBytes(32).toString("hex");
  try {
    vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", JSON.stringify([replacement, pepper]));
    expect((await estimateRecipients(fixture.db, owner, tenant, { listIds: [list] })).skipped).toEqual({ global_suppressed: 1 });
    const nextList = await makeList();
    await subscribe([nextList]);
    const next = await queue(nextList);
    const dualKeys = { ...env, HARVEST_NEWSLETTER_SUPPRESSION_KEYS: JSON.stringify([replacement, pepper]) };
    await runNewsletterWorker(fixture.workerPool, dualKeys, new FakeNewsletterProvider());
    expect((await rows(next))[0].attempted_key_version).toBe(createHash("sha256").update(Buffer.from(replacement, "hex")).digest("hex"));

    vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", JSON.stringify([replacement]));
    await expect(estimateRecipients(fixture.db, owner, tenant, { listIds: [list] })).rejects.toHaveProperty("cause.code", "42501");
    vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", undefined);
    await expect(estimateRecipients(fixture.db, owner, tenant, { listIds: [list] })).rejects.toThrow("NEWSLETTER_SUPPRESSION_KEYS_UNAVAILABLE");
    await expect(runNewsletterWorker(fixture.workerPool, { ...env, HARVEST_NEWSLETTER_SUPPRESSION_KEYS: undefined },
      new FakeNewsletterProvider())).rejects.toThrow("NEWSLETTER_SUPPRESSION_KEYS_UNAVAILABLE");
  } finally { vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", env.HARVEST_NEWSLETTER_SUPPRESSION_KEYS); }
});

it("alerts on aged uncertainty, marks it for review without sending again, and archives both unresolved states", async () => {
  const list = await makeList();
  for (let index = 0; index < 5; index++) await subscribe([list]);
  const campaign = await queue(list);
  const provider = new FakeNewsletterProvider(undefined, true);
  const submit = vi.spyOn(provider, "submit");
  expect((await worker(provider))?.unknown).toBe(5);
  const [oldest, ...rest] = await rows(campaign);
  await fixture.admin.query("update newsletter_deliveries set attempted_at=now()-interval '49 hours' where id=$1", [oldest.id]);
  const alert = vi.fn();
  const health = await worker(provider, { log: alert });
  expect(health).toMatchObject({ claimed: 0, unknown: 4, operatorReview: 1, markedForReview: 1,
    unresolvedByMinistry: [{ ministryId: tenant, unknown: 4, operatorReview: 1, oldestUnknownAgeSeconds: expect.any(Number) }] });
  expect(health!.unresolvedByMinistry[0].oldestUnknownAgeSeconds).toBeGreaterThanOrEqual(49 * 3600);
  expect(JSON.parse(alert.mock.calls[0][0])).toMatchObject({ operatorReview: 1, unresolvedByMinistry: health!.unresolvedByMinistry });
  expect((await rows(campaign))[0]).toMatchObject({ state: "operator_review", operator_review_at: expect.any(Date) });
  expect(submit).toHaveBeenCalledTimes(5);

  // Late authenticated evidence can still reconcile an escalated attempt.
  const late = rest[0];
  await fixture.admin.query("update newsletter_deliveries set attempted_at=now()-interval '49 hours' where id=$1", [late.id]);
  await worker(provider);
  await fixture.workerPool.query("select public.newsletter_delivery_event($1,$2,'delivered',now())", [late.id, provider.receiptForTest(late.id)]);
  expect((await rows(campaign)).find(row => row.id === late.id).state).toBe("accepted");

  const { rows: [{ day, until }] } = await fixture.admin.query(`update newsletter_deliveries set selected_at=now()-interval '91 days'
    where campaign_id=$1 returning (selected_at at time zone 'UTC')::date::text as day,
    ((selected_at at time zone 'UTC')::date+1)::text as until`, [campaign]);
  expect(await purgeNewsletterDeliveries(fixture.workerPool, { ...env, HARVEST_NEWSLETTER_RETENTION_ENABLED: "1" }))
    .toEqual({ purged: 5 });
  expect(await rows(campaign)).toEqual([]);
  expect((await newsletterAnalytics(fixture.db, owner, tenant, { from: day, until }, campaign)).totals)
    .toMatchObject({ selected: 5, unknown: 3, operatorReview: 1 });
});
