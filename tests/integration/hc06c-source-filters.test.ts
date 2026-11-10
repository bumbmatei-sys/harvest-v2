import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { publishIntakeForm, readIntakeManifest, submitIntake } from "../../src/server/connect-intake";
import { consumeInvitation, dispatchInvitation, prepareInvitation } from "../../src/server/connect-invitations";
import { createContact, getContact, listContacts, recordConsent } from "../../src/server/contacts";
import { commitImport, createImport, previewImport, rollbackImport, updateImport } from "../../src/server/crm-imports";
import { exportCount, exportRecords } from "../../src/server/crm-export";
import { createView, listViews, updateView } from "../../src/server/crm-views";
import { resolveListView } from "../../src/server/crm-list-view";
import { listCompanies } from "../../src/server/companies";
import { mergeContacts } from "../../src/server/crm-merge";
import { sourceOptions } from "../../src/server/crm-sources";
import { fullState, serializeSourceRule, sourceRule, stateToParams, type RawParams, type SourceRule } from "../../src/lib/crm-fields";
import { toRawParams } from "../../src/server/crm-list-view";

let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, foreign: string;
const ids: Record<string, string> = {};
const refs: Record<string, string> = {};
const rule = (input: Partial<SourceRule> & { mode: "include" | "exclude" }) => sourceRule.parse(input);
const params = (rules: SourceRule[], extra: Record<string, string> = {}) => ({ s: rules.map(serializeSourceRule), ...extra });
const names = async (rules: SourceRule[], actor = "s-owner") => (await listContacts(f.db, actor, tenant, params(rules))).rows.map((row) => row.name).sort();

/** One verified Connect association: a real published link, submission, invitation and claim. */
async function connectPerson(campaignName: string, user: string, email: string, name: string, route: "qr" | "short", campaignId?: string) {
  const campaign = campaignId ?? (await createCampaign(f.db, "s-owner", tenant, { name: campaignName, type: "conference" }, randomUUID())).id;
  const version = await publishIntakeForm(f.db, "s-owner", tenant, campaign, { name: `${campaignName} form`, notice: "Synthetic separate choices", retentionDays: 1, purposes: ["account_communications"],
    definition: { kind: "connect-intake-v3", syntheticOnly: true, preferredName: true, followUpChannel: "email" } });
  const link = await createConnectLink(f.db, "s-owner", tenant, campaign, { formVersionId: version.id, label: `${campaignName} ${route}` });
  await transitionConnectLink(f.db, "s-owner", tenant, campaign, link.id, { action: "publish" });
  const code = route === "qr" ? link.publicCode : link.shortCode.toLowerCase();
  const manifest = (await readIntakeManifest(f.db, route, code))!;
  await submitIntake(f.db, route, code, { submissionId: randomUUID(), receiptToken: manifest.receiptToken, stamp: manifest.stamp, capability: manifest.capability,
    purposes: ["account_communications"], email, preferredName: name });
  let token = ""; await dispatchInvitation(f.db, async (mail) => { token = mail.token; });
  await f.db.insert(users).values({ id: user, name, email, emailVerified: true });
  await consumeInvitation(f.db, await prepareInvitation(f.db, { token }), { id: user, email, emailVerified: true }, { action: "confirm" });
  const response = (await f.admin.query("select id, contact_id from campaign_responses where link_id=$1", [link.id])).rows[0];
  return { campaign, link: link.id, version: version.id, response: response.id as string, contact: response.contact_id as string };
}
async function imported(email: string, fill = false) {
  let record = await createImport(f.db, "s-owner", tenant, { entity: "person", clientKey: randomUUID(), fileName: "synthetic.csv", csv: `Name,Email\nImported B,${email}` });
  if (fill) record = await updateImport(f.db, "s-owner", tenant, record.id, { version: record.version, onMatch: "fill" });
  await previewImport(f.db, "s-owner", tenant, record.id, { version: record.version });
  await commitImport(f.db, "s-owner", tenant, record.id);
  return record.id;
}

beforeAll(async () => {
  f = await testDatabase();
  vi.stubEnv("DATABASE_URL", f.appURL);
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("HARVEST_CONNECT_INTAKE", "synthetic"); vi.stubEnv("HARVEST_CONNECT_TEST_KEY", "a".repeat(64));
  await f.db.insert(users).values(["s-owner", "s-admin", "s-member", "s-viewer", "s-foreign"].map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, "s-owner", "Sources")).tenantId;
  foreign = (await createWorkspace(f.db, "s-foreign", "Foreign")).tenantId;
  await putMember(f.db, "s-owner", tenant, "s-admin@example.test", "admin");
  await putMember(f.db, "s-owner", tenant, "s-member@example.test", "member");
  await putMember(f.db, "s-owner", tenant, "s-viewer@example.test", "viewer");
  ids.manual = (await createContact(f.db, "s-owner", tenant, { name: "Manual A" })).id;
  await imported("imported-b@example.test");
  ids.mixed = (await createContact(f.db, "s-owner", tenant, { name: "Mixed E", email: "mixed-e@example.test" })).id;
  const reverted = await createContact(f.db, "s-owner", tenant, { name: "Reverted R", email: "reverted-r@example.test" });
  await rollbackImport(f.db, "s-owner", tenant, await imported("reverted-r@example.test", true));
  ids.reverted = reverted.id;
  const spring = await connectPerson("Spring", "s-guest-c", "connect-c@example.test", "Connect C", "qr");
  const autumn = await connectPerson("Autumn", "s-guest-d", "connect-d@example.test", "Connect D", "short");
  const second = await connectPerson("Spring", "s-guest-e", "mixed-e@example.test", "Mixed E", "qr", spring.campaign);
  const expired = await connectPerson("Spring", "s-guest-x", "expired-x@example.test", "Expired X", "qr", spring.campaign);
  await f.admin.query("update campaign_responses set expires_at=clock_timestamp()-interval '1 second' where id=$1", [expired.response]);
  Object.assign(refs, { spring: spring.campaign, autumn: autumn.campaign, springLink: spring.link, secondLink: second.link, autumnForm: autumn.version });
  ids.connectC = spring.contact; ids.connectD = autumn.contact; ids.expired = expired.contact;
  expect(second.contact).toBe(ids.mixed);
  // A contact that predates source tracking: no source event at all.
  ids.unknown = (await f.admin.query("insert into contacts(tenant_id,name) values($1,'Unknown U') returning id", [tenant])).rows[0].id;
  await f.admin.query("delete from contact_source_events where contact_id=$1", [ids.unknown]);
  refs.foreignCampaign = (await createCampaign(f.db, "s-foreign", foreign, { name: "Foreign", type: "conference" }, randomUUID())).id;
}, 120_000);
afterAll(async () => { vi.unstubAllEnvs(); await f?.close(); });

it("matches each source type, using only retained, unreverted evidence", async () => {
  expect(await names([rule({ mode: "include", kinds: ["connect"] })])).toEqual(["Connect C", "Connect D", "Mixed E"]);
  expect(await names([rule({ mode: "include", kinds: ["manual"] })])).toEqual(["Manual A", "Mixed E", "Reverted R"]);
  expect(await names([rule({ mode: "include", kinds: ["csv_import"] })])).toEqual(["Imported B"]);
  // The expired response's evidence is hidden, so that person has no known source left.
  expect(await names([rule({ mode: "include", kinds: ["unknown"] })])).toEqual(["Expired X", "Unknown U"]);
});

it("filters by campaign, link, form version and entry route on the same Connect event", async () => {
  expect(await names([rule({ mode: "include", kinds: ["connect"], campaigns: [refs.spring] })])).toEqual(["Connect C", "Mixed E"]);
  expect(await names([rule({ mode: "include", kinds: ["connect"], links: [refs.secondLink] })])).toEqual(["Mixed E"]);
  expect(await names([rule({ mode: "include", kinds: ["connect"], forms: [refs.autumnForm] })])).toEqual(["Connect D"]);
  expect(await names([rule({ mode: "include", kinds: ["connect"], route: "short" })])).toEqual(["Connect D"]);
  // Spring was only ever reached by QR, and the short link belongs to Autumn: no single event has both.
  expect(await names([rule({ mode: "include", kinds: ["connect"], campaigns: [refs.spring], route: "short" })])).toEqual([]);
});

it("applies first and latest source, unions includes and lets any exclude remove a person", async () => {
  expect(await names([rule({ mode: "include", match: "first", kinds: ["manual"] })])).toEqual(["Manual A", "Mixed E", "Reverted R"]);
  expect(await names([rule({ mode: "include", match: "first", kinds: ["connect"] })])).toEqual(["Connect C", "Connect D"]);
  expect(await names([rule({ mode: "include", match: "latest", kinds: ["connect"] })])).toEqual(["Connect C", "Connect D", "Mixed E"]);
  expect(await names([rule({ mode: "include", kinds: ["manual"] }), rule({ mode: "include", kinds: ["csv_import"] })])).toEqual(["Imported B", "Manual A", "Mixed E", "Reverted R"]);
  expect(await names([rule({ mode: "include", kinds: ["connect"] }), rule({ mode: "exclude", kinds: ["connect"], campaigns: [refs.spring] })])).toEqual(["Connect D"]);
  // Exclude alone keeps everyone else, including people with no known source.
  expect(await names([rule({ mode: "exclude", kinds: ["connect"] })])).toEqual(["Expired X", "Imported B", "Manual A", "Reverted R", "Unknown U"]);
});

it("filters by the UTC date of the source event", async () => {
  const today = new Date().toISOString().slice(0, 10), tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  expect(await names([rule({ mode: "include", kinds: ["connect"], from: today, to: today })])).toEqual(["Connect C", "Connect D", "Mixed E"]);
  expect(await names([rule({ mode: "include", kinds: ["connect"], from: tomorrow })])).toEqual([]);
});

it("keeps list, count and export identical, and adds Sources only when the column is shown", async () => {
  const rules = [rule({ mode: "include", kinds: ["connect", "manual"] }), rule({ mode: "exclude", kinds: ["connect"], route: "short" })];
  const list = await listContacts(f.db, "s-owner", tenant, params(rules));
  const count = await exportCount(f.db, "s-owner", tenant, "person", params(rules));
  const file = await exportRecords(f.db, "s-owner", tenant, "person", params(rules));
  expect(list.total).toBe(4); expect(count).toMatchObject({ total: 4, sources: false }); expect(file.rows).toBe(4);
  expect(file.body).not.toContain("Sources");
  const shown = await exportRecords(f.db, "s-owner", tenant, "person", params(rules, { cols: "email,source" }));
  expect((await exportCount(f.db, "s-owner", tenant, "person", params(rules, { cols: "email,source" }))).sources).toBe(true);
  expect(shown.body.split("\r\n")[0]).toContain("Sources");
  expect(shown.body).toContain("Connect; Manual");
  // A member never gets the column, even when the view shows it.
  const member = await exportRecords(f.db, "s-member", tenant, "person", { cols: "email,source" });
  expect(member.body).not.toContain("Sources");
});

it("refuses source rules to members, viewers, revoked admins and foreign or missing references", async () => {
  const rules = [rule({ mode: "include", kinds: ["connect"] })];
  for (const actor of ["s-member", "s-viewer"]) {
    const list = await listContacts(f.db, actor, tenant, params(rules));
    expect(list).toMatchObject({ rows: [], total: 0, locked: "source_access" });
  }
  await expect(exportCount(f.db, "s-member", tenant, "person", params(rules))).rejects.toMatchObject({ status: 403 });
  await expect(exportRecords(f.db, "s-member", tenant, "person", params(rules))).rejects.toMatchObject({ status: 403 });
  await expect(exportCount(f.db, "s-viewer", tenant, "person", params(rules))).rejects.toMatchObject({ status: 403 });
  await expect(sourceOptions(f.db, "s-member", tenant)).rejects.toMatchObject({ status: 403 });
  expect((await listContacts(f.db, "s-admin", tenant, params(rules))).total).toBe(3);
  await putMember(f.db, "s-owner", tenant, "s-admin@example.test", "member");
  expect(await listContacts(f.db, "s-admin", tenant, params(rules))).toMatchObject({ rows: [], locked: "source_access" });
  await putMember(f.db, "s-owner", tenant, "s-admin@example.test", "admin");
  const foreignRule = [rule({ mode: "exclude", kinds: ["connect"], campaigns: [refs.foreignCampaign] })];
  expect(await listContacts(f.db, "s-owner", tenant, params(foreignRule))).toMatchObject({ rows: [], total: 0, locked: "invalid_source" });
  await expect(exportCount(f.db, "s-owner", tenant, "person", params(foreignRule))).rejects.toMatchObject({ status: 400 });
  const missing = [rule({ mode: "include", kinds: ["connect"], links: [randomUUID()] })];
  expect(await listContacts(f.db, "s-owner", tenant, params(missing))).toMatchObject({ locked: "invalid_source" });
  // Organizations never take source rules.
  await expect(Promise.resolve().then(() => listCompanies(f.db, "s-owner", tenant, params(rules)))).rejects.toMatchObject({ status: 400 });
});

it("hides shared source views from members and shows a direct link as an empty locked list", async () => {
  const state = fullState({ sources: [rule({ mode: "include", kinds: ["connect"] })] });
  await expect(createView(f.db, "s-member", tenant, { objectType: "person", name: "Mine", shared: false, state })).rejects.toMatchObject({ status: 403 });
  const view = await createView(f.db, "s-owner", tenant, { objectType: "person", name: "Connect people", shared: true, state });
  expect((await listViews(f.db, "s-member", tenant, "person")).some((item) => item.id === view.id)).toBe(false);
  expect((await listViews(f.db, "s-admin", tenant, "person")).some((item) => item.id === view.id)).toBe(true);
  await expect(updateView(f.db, "s-member", tenant, "person", view.id, { version: view.version, state: fullState({}) })).rejects.toMatchObject({ status: 404 });
  const load = (actor: string) => (raw: RawParams) => listContacts(f.db, actor, tenant, raw);
  const member = await resolveListView(f.db, "s-member", tenant, "person", { view: view.id }, true, load("s-member"));
  expect(member).toMatchObject({ notice: "sourceLocked", viewId: null });
  expect(member.list.rows).toEqual([]);
  // The locked view's name and rules never reach the member: the default view stands in.
  expect(member.current.id).not.toBe(view.id);
  expect(JSON.stringify(member)).not.toContain("Connect people");
  expect(member.list.state.sources).toEqual([]);
  expect(member.views.some((item) => item.id === view.id)).toBe(false);
  expect(member.query).not.toContain("s=");
  const owner = await resolveListView(f.db, "s-owner", tenant, "person", { view: view.id }, true, load("s-owner"));
  expect(owner.notice).toBeNull(); expect(owner.list.total).toBe(3);
  // Old views without source rules keep their meaning.
  expect(fullState({ q: "x" }).sources).toEqual([]);
  expect(toRawParams(stateToParams(state)).s).toBe(serializeSourceRule(state.sources[0]));
});

it("never exposes a public short code: an unlabeled link is named from its campaign", async () => {
  const campaign = (await createCampaign(f.db, "s-owner", tenant, { name: "Unlabeled link campaign", type: "conference" }, randomUUID())).id;
  const version = await publishIntakeForm(f.db, "s-owner", tenant, campaign, { name: "Unlabeled form", notice: "Synthetic separate choices", retentionDays: 1, purposes: ["account_communications"],
    definition: { kind: "connect-intake-v3", syntheticOnly: true, preferredName: true, followUpChannel: "email" } });
  const link = await createConnectLink(f.db, "s-owner", tenant, campaign, { formVersionId: version.id });
  const options = await sourceOptions(f.db, "s-owner", tenant);
  const option = options.links.find((item) => item.id === link.id)!;
  expect(option.name).toBe("Untitled link · Unlabeled link campaign");
  expect(JSON.stringify(options)).not.toContain(link.shortCode);
  expect(JSON.stringify(options)).not.toContain(link.publicCode);
  // Chips resolve through the same naming.
  const listed = await listContacts(f.db, "s-owner", tenant, params([rule({ mode: "include", kinds: ["connect"], links: [link.id] })]));
  expect(listed.related[link.id]).toBe("Untitled link · Unlabeled link campaign");
  expect(JSON.stringify(listed.related)).not.toContain(link.shortCode);
});

it("filters newsletter and follow-up permissions per channel with the ledger's own rule", async () => {
  const proof = { noticeVersion: "notice-v1", source: "Form", evidence: "Synthetic" } as const;
  const person = await createContact(f.db, "s-owner", tenant, { name: "Consent P" });
  const sms = await createContact(f.db, "s-owner", tenant, { name: "Consent Q" });
  const query = async (field: string, value: string, op = "any_of") => (await listContacts(f.db, "s-owner", tenant, { f: `${field}~${op}~${value}` })).rows.map((row) => row.name).filter((name) => name.startsWith("Consent")).sort();
  await recordConsent(f.db, "s-owner", tenant, person.id, { ...proof, channel: "email", status: "granted", purpose: "newsletter" });
  expect(await query("newsletter", "granted")).toEqual(["Consent P"]);
  await recordConsent(f.db, "s-owner", tenant, person.id, { ...proof, channel: "email", status: "withdrawn", purpose: "newsletter" });
  expect(await query("newsletter", "withdrawn")).toEqual(["Consent P"]);
  await recordConsent(f.db, "s-owner", tenant, person.id, { ...proof, channel: "email", status: "granted", purpose: "newsletter" });
  expect(await query("newsletter", "granted")).toEqual(["Consent P"]);
  // SMS follow-up permission says nothing about email follow-up.
  await recordConsent(f.db, "s-owner", tenant, sms.id, { ...proof, channel: "sms", status: "granted", purpose: "outreach_follow_up" });
  expect(await query("followup_sms", "granted")).toEqual(["Consent Q"]);
  expect(await query("followup_email", "none")).toEqual(["Consent P", "Consent Q"]);
  // Members can use permission filters (they are not source data).
  expect((await listContacts(f.db, "s-member", tenant, { f: "followup_sms~any_of~granted" })).rows.map((row) => row.name)).toEqual(["Consent Q"]);
  // Redacted evidence never counts.
  await f.admin.query("begin");
  try {
    await f.admin.query("alter table contact_consents disable trigger user");
    await f.admin.query("update contact_consents set redacted_at=now(), channel=null, source=null, evidence=null, recorded_by=null where contact_id=$1", [sms.id]);
    await f.admin.query("alter table contact_consents enable trigger user");
    await f.admin.query("commit");
  } catch (error) { await f.admin.query("rollback"); throw error; }
  expect(await query("followup_sms", "none")).toContain("Consent Q");
});

it("keeps a merged contact's newsletter opt-out (fail-safe suppression)", async () => {
  const proof = { channel: "email", purpose: "newsletter", noticeVersion: "notice-v1", source: "Form", evidence: "Synthetic" } as const;
  const target = await createContact(f.db, "s-owner", tenant, { name: "Merge target" });
  const source = await createContact(f.db, "s-owner", tenant, { name: "Merge source" });
  await recordConsent(f.db, "s-owner", tenant, target.id, { ...proof, status: "granted" });
  await recordConsent(f.db, "s-owner", tenant, source.id, { ...proof, status: "withdrawn" });
  const [t, s] = [await getContact(f.db, "s-owner", tenant, target.id), await getContact(f.db, "s-owner", tenant, source.id)];
  await mergeContacts(f.db, "s-owner", tenant, target.id, { sourceId: source.id, targetVersion: t.version, sourceVersion: s.version });
  const merged = (await listContacts(f.db, "s-owner", tenant, { f: "newsletter~any_of~withdrawn" })).rows.map((row) => row.name);
  expect(merged).toContain("Merge target");
});
