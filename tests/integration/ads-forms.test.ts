import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { useKeyProvider } from "../../src/server/connect-key-provider";
import { linkConnection } from "../../src/server/social/service";
import { createContact, eraseContact, getContact, listContacts } from "../../src/server/contacts";
import { exportRecords } from "../../src/server/crm-export";
import { getCrmReport } from "../../src/server/crm-reports";
import { getCrmForm, listCrmForms } from "../../src/server/crm-forms";
import { sourceRule, serializeSourceRule } from "../../src/lib/crm-fields";
import { withTenant } from "../../src/server/tenancy";
import { FakeAdsProvider } from "../../src/server/ads/fake-provider";
import type { AdsDeps } from "../../src/server/ads/registry";
import { linkAdAccounts, syncAdAccount } from "../../src/server/ads/accounts";
import { convertLeadToContact, syncLeads } from "../../src/server/ads/leads";
import { createAdLeadForm, getAdLeadForm, listAdLeadFormDrafts, publishAdLeadForm, saveAdLeadForm } from "../../src/server/ads/lead-forms";
import { computeEligibility } from "../../src/server/ads/crm-audiences";
import { AD_CONSENT_IDS } from "../../src/lib/ads/lead-form";
import { setAdConsent } from "../../src/lib/ads/lead-form-builder";
import { testDatabase } from "../database";
import { CANARY, depsFor, newFake, noNetwork, seedPeople, useTestKeys } from "./social-layer-fixture";

const ads = new FakeAdsProvider(CANARY);
const off: AdsDeps = { enabled: true, provider: () => ads, now: () => new Date() };
const on: AdsDeps = { ...off, features: { leadFormPublish: true } };
let f: Awaited<ReturnType<typeof testDatabase>>, p: Awaited<ReturnType<typeof seedPeople>>, acct: string, network: ReturnType<typeof noNetwork>;
const q = (query: string, values?: unknown[]) => f.admin.query(query, values);
const remote = () => ads.remotes.get("acc-fb-2\u0000act_1")!;
const privacy = "https://example.test/privacy";
const grants = async (contact: string) => (await q("select purpose, channel, status, notice_version, source, evidence from contact_consents where contact_id=$1 order by purpose", [contact])).rows;
const sourceRule1 = (kinds: ("ad_lead")[]) => serializeSourceRule(sourceRule.parse({ mode: "include", kinds }));

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  p = await seedPeople(f, "af");
  useTestKeys(); network = noNetwork();
  const conn = (await linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: CANARY, accountRef: "acc-fb-2" }, depsFor(newFake()))).connection.id;
  ads.addAccount("acc-fb-2", { ref: "act_1", name: "Grace ads" });
  acct = (await linkAdAccounts(f.db, p.owner, p.tenant, { connectionId: conn }, off)).accounts[0].id;
  await syncAdAccount(f.db, p.owner, p.tenant, acct, off);
}, 60_000);
afterAll(async () => { expect(network).not.toHaveBeenCalled(); network?.mockRestore(); useKeyProvider(null); await f?.close(); });

let formId: string, versionOne: string, leadFormOne: string, refOne: string;

it("builds a draft in Harvest on the shared forms model, owner and admin only, never visible to hosted-form paths", async () => {
  const created = await createAdLeadForm(f.db, p.owner, p.tenant, { network: "meta", privacyUrl: privacy }, off);
  formId = created.id;
  expect(created.issues).toEqual([]);
  expect(created.definition.ads?.wordings).toEqual({ notice: "ad-notice-v1" });
  for (const user of [p.member, p.viewer, p.outsider]) await expect(createAdLeadForm(f.db, user, p.tenant, { network: "meta", privacyUrl: privacy }, off)).rejects.toMatchObject({ status: 404 });
  await expect(createAdLeadForm(f.db, p.owner, p.tenant, { network: "meta", privacyUrl: "http://example.test/p" }, off)).rejects.toMatchObject({ status: 422 });
  await expect(createAdLeadForm(f.db, p.owner, p.tenant, { network: "meta", privacyUrl: privacy }, { ...off, enabled: false })).rejects.toMatchObject({ status: 404 });
  expect((await listAdLeadFormDrafts(f.db, p.admin, p.tenant, off)).forms).toEqual([expect.objectContaining({ id: formId, network: "meta", versions: 1, publishedVersions: 0 })]);
  // Hosted forms never list, load, publish or duplicate an ad lead form.
  expect(await listCrmForms(f.db, p.owner, p.tenant)).toEqual([]);
  await expect(getCrmForm(f.db, p.owner, p.tenant, formId)).rejects.toMatchObject({ status: 404 });
  const v = (await q("select id from form_versions where form_id=$1", [formId])).rows[0].id;
  await expect(q("insert into crm_form_publications(tenant_id, form_id, version_id, notice_version_id, published_by, definition) select tenant_id, form_id, id, gen_random_uuid(), $2, definition from form_versions where id=$1", [v, p.owner]))
    .rejects.toThrow(/cannot be published as a hosted form|violates/);
});

it("saves consent questions with the exact versioned wording, whatever the request says", async () => {
  const { definition, revision } = (await getAdLeadForm(f.db, p.owner, p.tenant, formId, off)).definition ? { definition: (await getAdLeadForm(f.db, p.owner, p.tenant, formId, off)).definition, revision: 1 } : (undefined as never);
  let next = definition;
  for (const kind of ["newsletter", "followUp", "marketing"] as const) next = setAdConsent(next, kind, true, "af ministry");
  const forged = { ...next, blocks: next.blocks.map((b) => b.id === AD_CONSENT_IDS.marketing ? { ...b, label: "Forged wording" } : b) };
  const saved = await saveAdLeadForm(f.db, p.admin, p.tenant, formId, { definition: forged, revision }, off);
  expect(saved.revision).toBe(2);
  const stored = (await getAdLeadForm(f.db, p.owner, p.tenant, formId, off)).definition;
  const marketing = stored.blocks.find((b) => b.id === AD_CONSENT_IDS.marketing)!;
  expect(marketing).toMatchObject({ type: "checkbox", required: false, label: "I agree that af ministry may use my details to show me relevant ads and measure them. I can withdraw this at any time." });
  await expect(saveAdLeadForm(f.db, p.owner, p.tenant, formId, { definition: stored, revision: 1 }, off)).rejects.toMatchObject({ status: 409 });
  await expect(saveAdLeadForm(f.db, p.owner, p.tenant, formId, { definition: { ...stored, ads: { ...stored.ads!, network: "tiktok" } }, revision: 2 }, off)).rejects.toMatchObject({ status: 422 });
  await expect(saveAdLeadForm(f.db, p.member, p.tenant, formId, { definition: stored, revision: 2 }, off)).rejects.toMatchObject({ status: 404 });
});

it("publishes to the network form only when the switch is on, with the mapping and wording recorded and the version frozen", async () => {
  const body = { adAccountId: acct, revision: 2 };
  // Hard-off: the literal-false default reaches no network and records nothing.
  await expect(publishAdLeadForm(f.db, p.owner, p.tenant, formId, body, randomUUID(), off)).rejects.toMatchObject({ status: 404 });
  expect(ads.calls.filter((c) => c.method === "createLeadForm")).toHaveLength(0);
  await expect(publishAdLeadForm(f.db, p.member, p.tenant, formId, body, randomUUID(), on)).rejects.toMatchObject({ status: 404 });
  await expect(publishAdLeadForm(f.db, p.owner, p.tenant, formId, { ...body, revision: 1 }, randomUUID(), on)).rejects.toMatchObject({ status: 409 });
  const key = randomUUID();
  const out = await publishAdLeadForm(f.db, p.owner, p.tenant, formId, body, key, on);
  expect(out.outcome).toBe("published");
  leadFormOne = out.leadFormId!;
  expect(ads.calls.filter((c) => c.method === "createLeadForm")).toHaveLength(1);
  refOne = remote().forms[0].ref;
  expect(remote().forms[0].questions).toEqual(["full_name", "email", "phone", "consent_newsletter", "consent_follow_up", "consent_marketing"]);
  const row = (await q("select * from ads_lead_forms where id=$1", [leadFormOne])).rows[0];
  versionOne = row.form_version_id;
  expect(row.form_id).toBe(formId);
  expect(row.consent_questions).toEqual({ newsletter: "consent_newsletter", form_follow_up: "consent_follow_up", marketing: "consent_marketing" });
  expect(row.consent_texts.marketing).toEqual({ key: "consent_marketing", wording: "ad-marketing-v1", text: "I agree that af ministry may use my details to show me relevant ads and measure them. I can withdraw this at any time." });
  expect(row.consent_text).toBe("Your details go to af ministry. You can ask them to delete them.");
  // Same version again: nothing new is sent.
  expect(await publishAdLeadForm(f.db, p.owner, p.tenant, formId, body, randomUUID(), on)).toEqual({ outcome: "already", leadFormId: leadFormOne });
  expect(ads.calls.filter((c) => c.method === "createLeadForm")).toHaveLength(1);
  // Frozen: the database refuses to change or remove the published version, the publication and the recorded wording.
  await expect(q("update form_versions set definition = definition || '{\"title\":\"x\"}'::jsonb where id=$1", [versionOne])).rejects.toThrow(/immutable/);
  await expect(q("delete from form_versions where id=$1", [versionOne])).rejects.toThrow(/immutable/);
  await expect(q("update ads_form_publications set definition = '{}'::jsonb where version_id=$1", [versionOne])).rejects.toThrow(/immutable/);
  await expect(q("delete from ads_form_publications where version_id=$1", [versionOne])).rejects.toThrow(/immutable/);
  await expect(q("update ads_lead_forms set consent_texts = '{}'::jsonb where id=$1", [leadFormOne])).rejects.toThrow(/keeps its consent wording/);
  await expect(q("update ads_lead_forms set consent_text = 'x' where id=$1", [leadFormOne])).rejects.toThrow(/keeps its consent wording/);
  // A provider sync may still rename or archive it.
  await q("update ads_lead_forms set status='active', name='Renamed' where id=$1", [leadFormOne]);
});

it("starts a new version when a published form is edited and keeps the old one for its leads", async () => {
  const current = await getAdLeadForm(f.db, p.owner, p.tenant, formId, off);
  expect(current.frozen).toBe(true);
  const edited = setAdConsent(current.definition, "marketing", false, "af ministry");
  const saved = await saveAdLeadForm(f.db, p.owner, p.tenant, formId, { definition: edited, revision: current.definition.revision }, off);
  expect(saved.revision).toBe(3);
  expect((await q("select count(*)::int n from form_versions where form_id=$1", [formId])).rows[0].n).toBe(2);
  const second = await publishAdLeadForm(f.db, p.owner, p.tenant, formId, { adAccountId: acct, revision: 3 }, randomUUID(), on);
  expect(second.outcome).toBe("published");
  expect(second.leadFormId).not.toBe(leadFormOne);
  const rows = (await q("select form_version_id, consent_questions from ads_lead_forms where form_id=$1 order by created_at", [formId])).rows;
  expect(rows).toHaveLength(2);
  expect(rows[0].form_version_id).toBe(versionOne);
  expect(rows[1].consent_questions).toEqual({ newsletter: "consent_newsletter", form_follow_up: "consent_follow_up" });
  expect((await q("select count(*)::int n from ads_form_publications where form_id=$1", [formId])).rows[0].n).toBe(2);
});

it("refuses to publish a form that is not ready, or to an account on another network", async () => {
  const other = await createAdLeadForm(f.db, p.owner, p.tenant, { network: "tiktok", privacyUrl: privacy }, on);
  await expect(publishAdLeadForm(f.db, p.owner, p.tenant, other.id, { adAccountId: acct, revision: 1 }, randomUUID(), on)).rejects.toMatchObject({ status: 422, details: { code: "NETWORK_MISMATCH" } });
  const def = (await getAdLeadForm(f.db, p.owner, p.tenant, other.id, on)).definition;
  const bare = { ...def, ads: { ...def.ads!, fields: { [def.blocks[0].id]: "full_name" as const } } };
  await saveAdLeadForm(f.db, p.owner, p.tenant, other.id, { definition: bare, revision: 1 }, on);
  await expect(publishAdLeadForm(f.db, p.owner, p.tenant, other.id, { adAccountId: acct, revision: 2 }, randomUUID(), on)).rejects.toMatchObject({ status: 422, details: { code: "FORM_NOT_READY" } });
  expect(ads.calls.filter((c) => c.method === "createLeadForm")).toHaveLength(2);
});

const lead = async (ref: string, fields: Record<string, string>, formRef: string | null = refOne, campaign: string | null = "camp-77") => {
  remote().leads.push({ ref, network: "meta", formRef, campaignRef: campaign, adRef: null, fields, submittedAt: new Date(Date.now() - 3_600_000) });
};
const idOf = async (ref: string) => (await q("select id, form_version_id from ads_leads where lead_ref=$1", [ref])).rows[0] as { id: string; form_version_id: string | null };

it("keeps the exact form version on every lead", async () => {
  await lead("al-yes", { full_name: "Mia Yes", email: "mia@example.test", consent_newsletter: "yes", consent_follow_up: "no", consent_marketing: "yes" });
  await lead("al-no", { full_name: "Noah No", email: "noah@example.test", consent_marketing: "no" });
  await lead("al-plain", { full_name: "Pia Plain", phone: "+12025550133", consent_marketing: "yes" });
  await lead("al-old", { full_name: "Old Form", email: "oldform@example.test" }, "unknown-ref", null);
  expect((await syncLeads(f.db, p.owner, p.tenant, acct, off)).added).toBe(4);
  expect((await idOf("al-yes")).form_version_id).toBe(versionOne);
  expect((await idOf("al-old")).form_version_id).toBeNull();
});

it("grants marketing only for a lead that answered yes to that separate question, with the exact wording as evidence", async () => {
  const yes = await convertLeadToContact(f.db, p.admin, p.tenant, (await idOf("al-yes")).id, off);
  expect(yes).toMatchObject({ outcome: "converted", created: true });
  expect(yes.granted.sort()).toEqual(["marketing", "newsletter"]);
  const rows = await grants(yes.contactId!);
  expect(rows.map((r) => `${r.purpose}:${r.channel}:${r.status}`)).toEqual(["marketing:email:granted", "newsletter:email:granted"]);
  expect(rows[0]).toMatchObject({ source: "ad_lead_form", notice_version: "ad-lead-form-v1" });
  expect(rows[0].evidence).toBe("[ad-marketing-v1] I agree that af ministry may use my details to show me relevant ads and measure them. I can withdraw this at any time. [lead answered yes: consent_marketing]");
  expect(rows[1].evidence).toContain("[ad-newsletter-v1] I agree to receive the af ministry newsletter by email.");
  // The follow-up answer was no: no follow-up grant.
  expect(rows.some((r) => r.purpose === "form_follow_up")).toBe(false);
  // No answer or "no": nothing granted. A question the version never asked (the second version has no marketing) grants nothing even if the answer says yes.
  const no = await convertLeadToContact(f.db, p.admin, p.tenant, (await idOf("al-no")).id, off);
  expect(no.granted).toEqual([]); expect(await grants(no.contactId!)).toEqual([]);
  const plain = await convertLeadToContact(f.db, p.admin, p.tenant, (await idOf("al-plain")).id, off);
  expect(plain.granted).toEqual(["marketing"]);
  expect((await grants(plain.contactId!))[0]).toMatchObject({ purpose: "marketing", channel: "sms" });
  const old = await convertLeadToContact(f.db, p.admin, p.tenant, (await idOf("al-old")).id, off);
  expect(old.granted).toEqual([]);
  // The consent is real for the single consent gate: the marketing audience includes exactly the two people who said yes.
  const seen = await withTenant(f.db, p.owner, p.tenant, "contacts:read", (tx) => computeEligibility(tx, p.tenant));
  expect(seen.eligible).toBe(2);
});

it("makes ad_lead the first source with network, form and campaign as detail, through lists, filters, exports and reports", async () => {
  const mia = (await q("select contact_id from ads_leads where lead_ref='al-yes'")).rows[0].contact_id as string;
  expect((await q("select kind from contact_first_sources where contact_id=$1", [mia])).rows).toEqual([{ kind: "ad_lead" }]);
  const events = (await q("select kind, outcome, ad_network, ad_form_id, ad_campaign_ref from contact_source_events where contact_id=$1", [mia])).rows;
  expect(events).toEqual([{ kind: "ad_lead", outcome: "created", ad_network: "meta", ad_form_id: leadFormOne, ad_campaign_ref: "camp-77" }]);
  expect(JSON.stringify(events)).not.toMatch(/mia@|Mia/);
  const detail = await getContact(f.db, p.owner, p.tenant, mia);
  expect(detail.sourceHistory?.[0]).toMatchObject({ kind: "ad_lead", outcome: "created", adNetwork: "meta", sourceLabel: "Renamed · camp-77" });
  await expect(getContact(f.db, p.member, p.tenant, mia)).resolves.not.toHaveProperty("sourceHistory");
  const list = await listContacts(f.db, p.owner, p.tenant, {});
  expect(list.rows.find((r) => r.id === mia)?.sourceKinds).toEqual(["ad_lead"]);
  expect((await listContacts(f.db, p.owner, p.tenant, { s: [sourceRule1(["ad_lead"])] })).rows.map((r) => r.name).sort()).toEqual(["Mia Yes", "Noah No", "Old Form", "Pia Plain"]);
  const excluded = serializeSourceRule(sourceRule.parse({ mode: "exclude", kinds: ["ad_lead"] }));
  expect((await listContacts(f.db, p.owner, p.tenant, { s: [excluded] })).rows).toHaveLength(0);
  const file = await exportRecords(f.db, p.owner, p.tenant, "person", { s: [sourceRule1(["ad_lead"])], cols: "email,source" });
  expect(file.rows).toBe(4); expect(file.body).toContain("Ad lead");
  const report = await getCrmReport(f.db, p.owner, p.tenant, "last30");
  expect(report.contacts?.sources.map((s) => s.source)).toContain("ad_lead");
  expect(rowAdLead(report)).toBeDefined();
});
const rowAdLead = (report: Awaited<ReturnType<typeof getCrmReport>>) => report.contacts?.sources.find((s) => s.source === "ad_lead");

it("keeps an earlier first source when a lead matches an existing person, and replaces the provisional manual one", async () => {
  const manual = await createContact(f.db, p.owner, p.tenant, { name: "Existing Person", email: "existing@example.test" });
  await q("update contact_first_sources set first_seen_at = now() - interval '30 days' where contact_id=$1", [manual.id]);
  await lead("al-existing", { full_name: "Existing Renamed", email: "existing@example.test" });
  await syncLeads(f.db, p.owner, p.tenant, acct, off);
  const r = await convertLeadToContact(f.db, p.owner, p.tenant, (await idOf("al-existing")).id, off);
  expect(r).toMatchObject({ created: false, contactId: manual.id });
  expect((await q("select kind from contact_first_sources where contact_id=$1", [manual.id])).rows).toEqual([{ kind: "manual" }]);
  expect((await q("select outcome from contact_source_events where contact_id=$1 and kind='ad_lead'", [manual.id])).rows).toEqual([{ outcome: "updated" }]);
  // A person created by the conversion has no leftover manual source.
  const mia = (await q("select contact_id from ads_leads where lead_ref='al-yes'")).rows[0].contact_id as string;
  expect((await q("select count(*)::int n from contact_source_events where contact_id=$1 and kind='manual'", [mia])).rows[0].n).toBe(0);
});

it("removes the source detail, leads and consent with the person on erasure, and refuses malformed ad detail", async () => {
  const mia = (await q("select contact_id from ads_leads where lead_ref='al-yes'")).rows[0].contact_id as string;
  await eraseContact(f.db, p.owner, p.tenant, mia);
  expect((await q("select count(*)::int n from contact_source_events where contact_id=$1", [mia])).rows[0].n).toBe(0);
  expect((await q("select count(*)::int n from contact_first_sources where contact_id=$1", [mia])).rows[0].n).toBe(0);
  expect((await q("select count(*)::int n from ads_leads where lead_ref='al-yes'")).rows[0].n).toBe(0);
  const keep = (await q("select contact_id from ads_leads where lead_ref='al-no'")).rows[0].contact_id as string;
  await expect(q("insert into contact_source_events(tenant_id, contact_id, kind, outcome) values ($1,$2,'ad_lead','created')", [p.tenant, keep])).rejects.toThrow(/contact_sources/);
  await expect(q("insert into contact_source_events(tenant_id, contact_id, kind, outcome, ad_network, ad_campaign_ref) values ($1,$2,'manual','created','meta','x')", [p.tenant, keep])).rejects.toThrow(/contact_sources/);
});

it("grants nothing when the lead's frozen form version or notice text is not the one the form carries now", async () => {
  await lead("al-mismatch", { full_name: "Mismatch Person", email: "mismatch@example.test", consent_marketing: "yes" });
  await lead("al-notext", { full_name: "No Text Person", email: "notext@example.test", consent_marketing: "yes" });
  await syncLeads(f.db, p.owner, p.tenant, acct, off);
  const other = (await q("select form_version_id v from ads_lead_forms where id <> $1 and form_id=$2", [leadFormOne, formId])).rows[0].v as string;
  await q("update ads_leads set form_version_id=$1 where lead_ref='al-mismatch'", [other]);
  await q("update ads_leads set consent_text=null where lead_ref='al-notext'");
  for (const ref of ["al-mismatch", "al-notext"]) expect((await convertLeadToContact(f.db, p.admin, p.tenant, (await idOf(ref)).id, off)).granted).toEqual([]);
});
