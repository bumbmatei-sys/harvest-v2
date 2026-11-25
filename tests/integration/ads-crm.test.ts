import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sql } from "drizzle-orm";
import { useKeyProvider } from "../../src/server/connect-key-provider";
import { linkConnection } from "../../src/server/social/service";
import { withTenant } from "../../src/server/tenancy";
import { createContact, eraseContact, getContact, recordConsent } from "../../src/server/contacts";
import { mergeContacts } from "../../src/server/crm-merge";
import { FakeAdsProvider } from "../../src/server/ads/fake-provider";
import type { AdsDeps } from "../../src/server/ads/registry";
import { linkAdAccounts, syncAdAccount } from "../../src/server/ads/accounts";
import { convertLeadToContact, convertNewLeads, createLeadForm, syncLeads } from "../../src/server/ads/leads";
import { computeEligibility, createCustomerAudience, previewAudienceUpload, uploadCrmAudience, hashedIdentity } from "../../src/server/ads/crm-audiences";
import { sendConversionEvents } from "../../src/server/ads/conversions";
import { runAdsResultsSync } from "../../src/server/ads/sync-worker";
import { testDatabase } from "../database";
import { CANARY, depsFor, newFake, noNetwork, seedPeople, useTestKeys } from "./social-layer-fixture";

const ads = new FakeAdsProvider(CANARY);
const off: AdsDeps = { enabled: true, provider: () => ads, now: () => new Date() };
const on: AdsDeps = { ...off, features: { audienceUpload: true, conversionsSend: true, resultsSync: true } };
let f: Awaited<ReturnType<typeof testDatabase>>, p: Awaited<ReturnType<typeof seedPeople>>, acct: string, destination: string;
let network: ReturnType<typeof noNetwork>;
const q = (query: string, values?: unknown[]) => f.admin.query(query, values);
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const remote = () => ads.remotes.get("acc-fb-2\u0000act_1")!;
const lead = async (ref: string, fields: Record<string, string>, formRef: string | null) => (await q(
  "insert into ads_leads(tenant_id,ad_account_id,network,lead_ref,form_ref,fields,consent_text,submitted_at) values ($1,$2,'meta',$3,$4,$5,(select consent_text from ads_lead_forms where ad_account_id=$2 and external_ref=$4),now() - interval '1 hour') returning id", [p.tenant, acct, ref, formRef, fields])).rows[0].id as string;
const grants = async (contact: string) => (await q("select purpose, channel, status, notice_version, source, evidence from contact_consents where contact_id=$1 order by purpose", [contact])).rows;

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  p = await seedPeople(f, "ac");
  useTestKeys(); network = noNetwork();
  const sdeps = depsFor(newFake());
  const conn = (await linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: CANARY, accountRef: "acc-fb-2" }, sdeps)).connection.id;
  ads.addAccount("acc-fb-2", { ref: "act_1", name: "Grace ads" });
  remote().destinations.push({ ref: "px-1", kind: "pixel", name: "Pixel", lastEventAt: null, status: "active" });
  acct = (await linkAdAccounts(f.db, p.owner, p.tenant, { connectionId: conn }, off)).accounts[0].id;
  await syncAdAccount(f.db, p.owner, p.tenant, acct, off);
  destination = (await q("select id from ads_conversion_destinations where ad_account_id=$1", [acct])).rows[0].id;
}, 60_000);
beforeEach(async () => { await q("truncate ads_leads, ads_audience_uploads, ads_conversion_sends"); });
afterAll(async () => { expect(network).not.toHaveBeenCalled(); network?.mockRestore(); useKeyProvider(null); await f?.close(); });

let formRef: string;
it("creates a form whose consent questions are explicit and mapped to purposes only when asked", async () => {
  const k = randomUUID();
  const { form } = await createLeadForm(f.db, p.owner, p.tenant, { adAccountId: acct, name: "Visit", consentText: "We may email you about our newsletter if you tick the box.", privacyUrl: "https://example.test/privacy",
    questions: ["full_name", "email", "phone", "consent_newsletter"] }, k, off);
  formRef = remote().forms[0].ref;
  expect((await q("select consent_questions from ads_lead_forms where id=$1", [form.id])).rows[0].consent_questions).toEqual({ newsletter: "consent_newsletter" });
  const plain = await createLeadForm(f.db, p.owner, p.tenant, { adAccountId: acct, name: "Plain", consentText: "Thanks for your interest.", privacyUrl: "https://example.test/privacy", questions: ["full_name", "email"] }, randomUUID(), off);
  expect((await q("select consent_questions from ads_lead_forms where id=$1", [plain.form.id])).rows[0].consent_questions).toEqual({});
  await expect(createLeadForm(f.db, p.owner, p.tenant, { adAccountId: acct, name: "Bad", consentText: "x", privacyUrl: "https://example.test/p", questions: ["marketing"] }, randomUUID(), off)).rejects.toMatchObject({ status: 422 });
});

it("converts a lead into a contact with no consent of its own and a grant only where the form asked and the lead said yes", async () => {
  const yes = await lead("l-yes", { full_name: "Anna Visitor", email: "Anna@Example.test", consent_newsletter: "yes" }, formRef);
  const r = await convertLeadToContact(f.db, p.admin, p.tenant, yes, off);
  expect(r).toMatchObject({ outcome: "converted", created: true, granted: ["newsletter"] });
  const [consent] = await grants(r.contactId!);
  expect(consent).toMatchObject({ purpose: "newsletter", channel: "email", status: "granted", notice_version: "ad-lead-form-v1", source: "ad_lead_form" });
  expect(consent.evidence).toContain("We may email you about our newsletter if you tick the box.");
  expect((await getContact(f.db, p.owner, p.tenant, r.contactId!)).name).toBe("Anna Visitor");
  // Idempotent.
  expect(await convertLeadToContact(f.db, p.admin, p.tenant, yes, off)).toMatchObject({ outcome: "already", contactId: r.contactId });
  // No answer, "no", or a purpose the form never asked about: no grant at all, and never a marketing or follow-up grant.
  const no = await lead("l-no", { full_name: "Ben Visitor", email: "ben@example.test", consent_newsletter: "no" }, formRef);
  const silent = await lead("l-silent", { full_name: "Cara Visitor", phone: "+12025550142" }, formRef);
  const unknownForm = await lead("l-unknown", { full_name: "Dan Visitor", email: "dan@example.test", consent_newsletter: "yes" }, null);
  for (const id of [no, silent, unknownForm]) { const out = await convertLeadToContact(f.db, p.admin, p.tenant, id, off); expect(out.granted).toEqual([]); expect(await grants(out.contactId!)).toEqual([]); }
  // A second lead with the same email matches the existing person: nothing is created or overwritten.
  const again = await lead("l-again", { full_name: "Anna Renamed", email: "anna@example.test" }, formRef);
  expect(await convertLeadToContact(f.db, p.admin, p.tenant, again, off)).toMatchObject({ outcome: "converted", created: false, contactId: r.contactId });
  expect((await getContact(f.db, p.owner, p.tenant, r.contactId!)).name).toBe("Anna Visitor");
  expect((await q("select count(*)::int n from contacts where tenant_id=$1", [p.tenant])).rows[0].n).toBe(4);
  expect((await q("select count(*)::int n from audit_logs where action='ads.lead_convert' and tenant_id=$1", [p.tenant])).rows[0].n).toBeGreaterThanOrEqual(5);
});

it("refuses leads that cannot become a contact, non-staff, other ministries and unknown leads", async () => {
  const real = await lead("l-real", { full_name: "Real Person", email: "person@gmail.com" }, formRef);
  const nameless = await lead("l-nameless", { email: "x@example.test" }, formRef);
  const bare = await lead("l-bare", { full_name: "No Contact Details" }, formRef);
  for (const id of [real, nameless, bare]) await expect(convertLeadToContact(f.db, p.owner, p.tenant, id, off)).rejects.toMatchObject({ status: 422, details: { code: "LEAD_NOT_CONVERTIBLE" } });
  const ok = await lead("l-ok", { full_name: "Ok Person", email: "ok@example.test" }, formRef);
  for (const user of [p.member, p.viewer, p.outsider]) await expect(convertLeadToContact(f.db, user, p.tenant, ok, off)).rejects.toMatchObject({ status: 404 });
  await expect(convertLeadToContact(f.db, p.outsider, p.other, ok, off)).rejects.toMatchObject({ status: 404 });
  await expect(convertLeadToContact(f.db, p.owner, p.tenant, randomUUID(), off)).rejects.toMatchObject({ status: 404 });
  const counts = await convertNewLeads(f.db, p.owner, p.tenant, acct, off);
  expect(counts).toEqual({ converted: 1, created: 1, matched: 0, notConvertible: 3, conflict: 0 });
});

it("deletes converted leads when the person is erased and moves them on a merge", async () => {
  const a = await lead("l-a", { full_name: "Erase Me", email: "erase@example.test" }, formRef);
  const converted = await convertLeadToContact(f.db, p.owner, p.tenant, a, off);
  expect((await q("select count(*)::int n from ads_leads where contact_id=$1", [converted.contactId])).rows[0].n).toBe(1);
  await eraseContact(f.db, p.owner, p.tenant, converted.contactId!);
  expect((await q("select count(*)::int n from ads_leads where lead_ref='l-a'")).rows[0].n).toBe(0);
  const keep = await createContact(f.db, p.owner, p.tenant, { name: "Keeper", email: "keeper@example.test" });
  const dup = await createContact(f.db, p.owner, p.tenant, { name: "Duplicate", phone: "+12025550177" });
  const b = await lead("l-b", { full_name: "Duplicate", phone: "+12025550177" }, formRef);
  expect((await convertLeadToContact(f.db, p.owner, p.tenant, b, off)).contactId).toBe(dup.id);
  await mergeContacts(f.db, p.owner, p.tenant, keep.id, { sourceId: dup.id, targetVersion: (await getContact(f.db, p.owner, p.tenant, keep.id)).version, sourceVersion: (await getContact(f.db, p.owner, p.tenant, dup.id)).version });
  expect((await q("select contact_id from ads_leads where lead_ref='l-b'")).rows[0].contact_id).toBe(keep.id);
});

const marketing = (id: string, status: "granted" | "withdrawn", channel: "email" | "sms" = "email") => recordConsent(f.db, p.owner, p.tenant, id, { channel, status, purpose: "marketing", noticeVersion: "notice-v1", source: "Test form", evidence: "Ticked the box" });
async function person(name: string, email: string | null, phone: string | null = null) { return (await createContact(f.db, p.owner, p.tenant, { name, ...(email ? { email } : {}), ...(phone ? { phone } : {}) })).id; }

it("includes only people with a valid marketing consent in an audience, hashed, and never erased, withdrawn, unknown or newsletter-only people", async () => {
  const yes = await person("Marketing Yes", "yes@example.test"), withdrawn = await person("Marketing Withdrawn", "wd@example.test"), news = await person("Newsletter Only", "news@example.test"), none = await person("No Consent", "none@example.test");
  const sms = await person("Phone Only Yes", null, "+12025550188"), erased = await person("Erased", "erased@example.test"), noId = await createContact(f.db, p.owner, p.tenant, { name: "No Identifier" });
  await marketing(yes, "granted"); await marketing(withdrawn, "granted"); await marketing(withdrawn, "withdrawn"); await marketing(sms, "granted", "sms"); await marketing(erased, "granted");
  await recordConsent(f.db, p.owner, p.tenant, news, { channel: "email", status: "granted", purpose: "newsletter", noticeVersion: "notice-v1", source: "Test", evidence: "Ticked" });
  await eraseContact(f.db, p.owner, p.tenant, erased);
  const seen = await withTenant(f.db, p.owner, p.tenant, "contacts:read", tx => computeEligibility(tx, p.tenant));
  expect(seen.eligible).toBe(2);
  expect(seen.members).toEqual(expect.arrayContaining([hashedIdentity("yes@example.test", null), hashedIdentity(null, "+12025550188")]));
  expect(JSON.stringify(seen.members)).not.toMatch(/example\.test|@|\+1202/);
  expect(Object.keys(seen.excluded).sort()).toEqual(["consent_missing", "consent_withdrawn", "no_identifier"]);
  expect(noId.id).toBeTruthy();
  expect(hashedIdentity("YES@example.test ", null)).toEqual(hashedIdentity("yes@example.test", null));
  expect(none).toBeTruthy();
});

it("keeps the audience upload hard-off, then uploads hashes idempotently with an audit and counts only", async () => {
  await expect(previewAudienceUpload(f.db, p.owner, p.tenant, off)).rejects.toMatchObject({ status: 404 });
  await expect(uploadCrmAudience(f.db, p.owner, p.tenant, { adAccountId: acct, audienceId: randomUUID(), idempotencyKey: randomUUID(), confirm: true }, off)).rejects.toMatchObject({ status: 404 });
  expect(ads.calls.filter(c => c.method === "uploadAudienceMembers")).toHaveLength(0);
  await expect(previewAudienceUpload(f.db, p.member, p.tenant, on)).rejects.toMatchObject({ status: 404 });
  expect(await previewAudienceUpload(f.db, p.owner, p.tenant, on)).toMatchObject({ eligible: 2 });
  const { audienceId } = await createCustomerAudience(f.db, p.owner, p.tenant, { adAccountId: acct, name: "Supporters", idempotencyKey: randomUUID() }, on);
  const key = randomUUID();
  await expect(uploadCrmAudience(f.db, p.owner, p.tenant, { adAccountId: acct, audienceId, idempotencyKey: key }, on)).rejects.toMatchObject({ status: 422 });
  // The fake refuses sends unless a test allows them, like the vendor adapter.
  const refused = await uploadCrmAudience(f.db, p.owner, p.tenant, { adAccountId: acct, audienceId, idempotencyKey: key, confirm: true }, on);
  expect(refused.upload).toMatchObject({ status: "failed" });
  ads.allowSends = true;
  const key2 = randomUUID();
  const sent = await uploadCrmAudience(f.db, p.owner, p.tenant, { adAccountId: acct, audienceId, idempotencyKey: key2, confirm: true }, on);
  expect(sent).toMatchObject({ replayed: false, upload: { status: "sent", eligible: 2, sent: 2 } });
  const audienceRef = (await q("select external_ref from ads_audiences where id=$1", [audienceId])).rows[0].external_ref;
  expect(ads.audienceMembers.get(audienceRef)).toHaveLength(2);
  expect((await uploadCrmAudience(f.db, p.owner, p.tenant, { adAccountId: acct, audienceId, idempotencyKey: key2, confirm: true }, on))).toMatchObject({ replayed: true, upload: { status: "sent", sent: 2 } });
  expect(ads.audienceMembers.get(audienceRef)).toHaveLength(2);
  await expect(uploadCrmAudience(f.db, p.owner, p.tenant, { adAccountId: acct, audienceId: randomUUID(), idempotencyKey: key2, confirm: true }, on)).rejects.toMatchObject({ status: 409 });
  // A person who withdraws before the next upload is excluded at dispatch time.
  const contact = (await q("select c.id from contacts c join contact_identifiers i on i.contact_id=c.id where i.normalized_value='yes@example.test'")).rows[0].id;
  await marketing(contact, "withdrawn");
  expect(await previewAudienceUpload(f.db, p.owner, p.tenant, on)).toMatchObject({ eligible: 1 });
  const table = (await q("select * from ads_audience_uploads where status='sent'")).rows[0];
  expect(JSON.stringify(table)).not.toMatch(/example\.test|[0-9a-f]{64}/);
  const audits = (await q("select action, metadata from audit_logs where tenant_id=$1 and action like 'ads.audience_%'", [p.tenant])).rows;
  expect(audits.map(a => a.action)).toEqual(expect.arrayContaining(["ads.audience_create", "ads.audience_upload_requested", "ads.audience_upload_outcome"]));
  expect(JSON.stringify(audits)).not.toMatch(/example\.test|[0-9a-f]{64}/);
  ads.allowSends = false;
});

it("sends conversion events only for converted leads whose person has a marketing consent, leaves out people without a grant (including EEA, UK and Swiss people) and stays off by default", async () => {
  const mk = async (ref: string, name: string, email: string | null, phone: string | null, country?: string) => {
    const id = await lead(ref, { full_name: name, ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(country ? { country } : {}) }, formRef);
    return { id, contact: (await convertLeadToContact(f.db, p.owner, p.tenant, id, off)).contactId! };
  };
  const ok = await mk("c-ok", "Conv Ok", "convok@example.test", null), gone = await mk("c-gone", "Conv Gone", "convgone@example.test", null), none = await mk("c-none", "Conv None", "convnone@example.test", null);
  const eu = await mk("c-eu", "Conv Europe", "conveu@example.test", null, "DE"), us = await mk("c-us", "Conv Us", "convus@example.test", null, "US");
  const eu2 = await mk("c-eu2", "Conv Europe Two", "conveu2@example.test", null, "FR");
  await marketing(ok.contact, "granted"); await marketing(gone.contact, "granted"); await marketing(gone.contact, "withdrawn"); await marketing(us.contact, "granted"); await marketing(eu2.contact, "granted");
  // The first EU person has no marketing grant at all, so is left out like anyone else; the second has an explicit notice grant and is included. (The extra legacy-history check in the code is
  // defensive: only a migration can write legacy-unversioned rows, and the database refuses them from any application path.)
  const unconverted = await lead("c-raw", { full_name: "Raw", email: "raw@example.test" }, formRef);
  const body = (leadIds: string[], key = randomUUID()) => ({ adAccountId: acct, destinationId: destination, eventName: "Lead", leadIds, idempotencyKey: key, confirm: true });
  const all = [ok.id, gone.id, none.id, eu.id, eu2.id, us.id, unconverted];
  await expect(sendConversionEvents(f.db, p.owner, p.tenant, body(all), off)).rejects.toMatchObject({ status: 404 });
  expect(ads.calls.filter(c => c.method === "sendConversionEvents")).toHaveLength(0);
  await expect(sendConversionEvents(f.db, p.member, p.tenant, body(all), on)).rejects.toMatchObject({ status: 404 });
  await expect(sendConversionEvents(f.db, p.owner, p.tenant, { ...body(all), confirm: undefined }, on)).rejects.toMatchObject({ status: 422 });
  // Without the test allowing sends the provider refuses and nothing is marked sent.
  expect(await sendConversionEvents(f.db, p.owner, p.tenant, body(all), on)).toMatchObject({ sent: 0, status: "failed" });
  expect((await q("select count(*)::int n from ads_conversion_sends where status='sent'")).rows[0].n).toBe(0);
  ads.allowSends = true;
  const key = randomUUID();
  const res = await sendConversionEvents(f.db, p.owner, p.tenant, body(all, key), on);
  expect(res).toMatchObject({ sent: 3, status: "sent", skipped: { not_a_contact: 1, consent_withdrawn: 1, consent_missing: 2 } });
  const batch = ads.conversionSends.at(-1)!;
  expect(batch.events.map(e => e.name)).toEqual(["Lead", "Lead", "Lead"]);
  expect(JSON.stringify(batch)).not.toMatch(/example\.test|Conv /);
  expect(batch.events.every(e => /^[0-9a-f]{64}$/.test(e.userData.email ?? ""))).toBe(true);
  // The same events are never sent twice.
  const again = await sendConversionEvents(f.db, p.owner, p.tenant, body([ok.id, us.id]), on);
  expect(again).toMatchObject({ sent: 0, skipped: { already_sent: 2 } });
  expect(ads.conversionSends).toHaveLength(1);
  const rows = (await q("select * from ads_conversion_sends where status='sent'")).rows;
  expect(rows).toHaveLength(3);
  expect(JSON.stringify(rows)).not.toMatch(/example\.test|contact/);
  ads.allowSends = false;
});

it("syncs results on a schedule through the worker role only, hard-off, newest value per day", async () => {
  await q("update ads_accounts set sync_due_at = now() - interval '1 minute'");
  expect(await runAdsResultsSync(f.workerPool, ads as never)).toMatchObject({ disabled: true });
  await expect(withTenant(f.db, p.owner, p.tenant, "ads:manage", async tx => { await tx.execute(sql`select public.ads_sync_claim(5)`); })).rejects.toThrow();
  await expect(withTenant(f.db, p.owner, p.tenant, "ads:manage", async tx => { await tx.execute(sql`select public.ads_sync_apply(${p.tenant}::uuid, ${acct}::uuid, ${randomUUID()}::uuid, 'ready', 100, '[]'::jsonb)`); })).rejects.toThrow();
  // A campaign with a result row.
  remote().campaigns.length = 0; remote().results.length = 0;
  await q("delete from ads_campaigns");
  const k = randomUUID();
  const { request } = await (await import("../../src/server/ads/launch")).createLaunchRequest(f.db, p.owner, p.tenant, { kind: "campaign", payload: { adAccountId: acct, name: "Sync", goal: "traffic", budgetAmount: 10, creative: { format: "image", mediaRefs: ["m"] } } }, off);
  const L = await import("../../src/server/ads/launch");
  const v = await L.validateLaunchRequest(f.db, p.owner, p.tenant, request.id, off);
  await L.reviewLaunchRequest(f.db, p.owner, p.tenant, request.id, { version: v.request.version }, off);
  await L.launchRequest(f.db, p.owner, p.tenant, request.id, { idempotencyKey: k }, off);
  remote().results.push({ level: "campaign", ref: remote().campaigns[0].ref, day: day(-1), metrics: { spend: 10, impressions: 1000, clicks: 50, results: 5 } });
  await q("update ads_accounts set sync_due_at = now() - interval '1 minute', sync_lease = null, sync_leased_until = null");
  const run = await runAdsResultsSync(f.workerPool, ads as never, { enabled: true });
  expect(run).toMatchObject({ claimed: 1, synced: 1, failed: 0 });
  expect(run.written).toBeGreaterThanOrEqual(1);
  const row = (await q("select metrics, captured_at from ads_results where level='campaign'")).rows[0];
  expect(row.metrics).toMatchObject({ spend: 10, impressions: 1000, clicks: 50, results: 5 });
  expect(row.metrics.ctr).toBeCloseTo(0.05);
  const account = (await q("select sync_state, sync_failures, sync_lease, sync_due_at > now() as later from ads_accounts where id=$1", [acct])).rows[0];
  expect(account).toMatchObject({ sync_state: "ready", sync_failures: 0, sync_lease: null, later: true });
  // Not due again until its time; a failing provider backs off.
  expect(await runAdsResultsSync(f.workerPool, ads as never, { enabled: true })).toMatchObject({ claimed: 0 });
  await q("update ads_accounts set sync_due_at = now() - interval '1 minute'");
  ads.fail("readResults", "RATE_LIMITED", 1);
  expect(await runAdsResultsSync(f.workerPool, ads as never, { enabled: true })).toMatchObject({ claimed: 1, synced: 0, failed: 1 });
  expect((await q("select sync_state, sync_failures from ads_accounts where id=$1", [acct])).rows[0]).toEqual({ sync_state: "delayed", sync_failures: 1 });
  // A disabled or revoked connection is never claimed.
  await q("update ads_accounts set sync_due_at = now() - interval '1 minute'");
  await q("update social_connections set status='disabled'");
  expect(await runAdsResultsSync(f.workerPool, ads as never, { enabled: true })).toMatchObject({ claimed: 0 });
  await q("update social_connections set status='active'");
});

it("keeps a converted lead out of the 90-day retention only until its lead row expires, and the contact stays", async () => {
  const id = await lead("l-ret", { full_name: "Retained Person", email: "ret@example.test" }, formRef);
  const out = await convertLeadToContact(f.db, p.owner, p.tenant, id, off);
  await q("update ads_leads set created_at = now() - interval '91 days' where id=$1", [id]);
  expect(await (await import("../../src/server/ads/prune")).pruneAdsLeads(f.workerPool, 10)).toBe(1);
  expect((await q("select count(*)::int n from contacts where id=$1 and erased_at is null", [out.contactId])).rows[0].n).toBe(1);
  void syncLeads;
});

it("grants consent only while the form still carries the exact text the lead was received with, and cites the lead's own text", async () => {
  const shown = (await q("select consent_text from ads_lead_forms where external_ref=$1", [formRef])).rows[0].consent_text as string;
  const before = await lead("l-frozen", { full_name: "Frozen Text", email: "frozen@example.test", consent_newsletter: "yes" }, formRef);
  await q("update ads_lead_forms set consent_text='We may now do anything with your details.' where external_ref=$1", [formRef]);
  try {
    // The wording changed after this lead was received: nothing is granted and the new wording is never cited.
    const out = await convertLeadToContact(f.db, p.admin, p.tenant, before, off);
    expect(out).toMatchObject({ outcome: "converted", granted: [] });
    expect(await grants(out.contactId!)).toEqual([]);
    // A lead received with no stored text (form unknown at receipt) grants nothing either.
    await q("update ads_lead_forms set consent_text=$2 where external_ref=$1", [formRef, shown]);
    const bare = await lead("l-bare-text", { full_name: "No Stored Text", email: "nostore@example.test", consent_newsletter: "yes" }, formRef);
    await q("update ads_leads set consent_text=null where id=$1", [bare]);
    expect((await convertLeadToContact(f.db, p.admin, p.tenant, bare, off)).granted).toEqual([]);
    // Unchanged wording: granted, citing the text stored on the lead.
    const ok = await lead("l-ok-text", { full_name: "Same Text", email: "same@example.test", consent_newsletter: "yes" }, formRef);
    const granted = await convertLeadToContact(f.db, p.admin, p.tenant, ok, off);
    expect(granted.granted).toEqual(["newsletter"]);
    expect((await grants(granted.contactId!))[0].evidence).toContain(shown);
  } finally { await q("update ads_lead_forms set consent_text=$2 where external_ref=$1", [formRef, shown]); }
});

it("refuses to erase a contact if one of its leads would survive", async () => {
  const id = await lead("l-erase-guard", { full_name: "Guard Person", email: "guard@example.test" }, formRef);
  const r = await convertLeadToContact(f.db, p.admin, p.tenant, id, off);
  await eraseContact(f.db, p.owner, p.tenant, r.contactId!);
  expect((await q("select count(*)::int n from ads_leads where lead_ref='l-erase-guard'")).rows[0].n).toBe(0);
});
