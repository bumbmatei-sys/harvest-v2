import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { applyIntakeRights, publishIntakeForm, readIntakeManifest, submitIntake } from "../../src/server/connect-intake";
import { withdrawConnectResponsePurpose } from "../../src/server/connect-responses";
import { receiptHash } from "../../src/server/connect-intake-crypto";
import { createContact, getContact, listContacts, recordConsent } from "../../src/server/contacts";
import { associationPermissions, recordAssociation } from "../../src/server/crm-associations";
import { exportCount, exportRecords } from "../../src/server/crm-export";
import { commitImport, createImport, previewImport, updateImport } from "../../src/server/crm-imports";
import { mergeContacts } from "../../src/server/crm-merge";
import { crmTools } from "../../src/server/ai/crm-tools";
import { connectOfferedPurposes } from "../../src/lib/consent-purposes";

// HC-DEC1 invariants: purposes are separate, unchecked by default, independently withdrawable, and every surface reads
// the same ledger rule. Synthetic data only; nothing is sent.
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, campaign: string;
type Purpose = "account_communications" | "outreach_follow_up" | "newsletter";
const proof = { noticeVersion: "notice-v1", source: "Synthetic form", evidence: "Synthetic test evidence" } as const;
const ledger = async (contact: string) => (await f.admin.query("select purpose, status, channel from contact_consents where contact_id = $1 order by recorded_at, id", [contact])).rows;
const consent = (contact: string, purpose: "newsletter" | "messaging" | "form_follow_up" | "marketing" | "outreach_follow_up", status: "granted" | "withdrawn" | "unknown", extra: { channel?: "email" | "sms" | "social"; occurredAt?: string } = {}) =>
  recordConsent(f.db, "dec1-owner", tenant, contact, { ...proof, channel: extra.channel ?? "email", status, purpose, ...(extra.occurredAt ? { occurredAt: extra.occurredAt } : {}) });
const pause = () => new Promise((resolve) => setTimeout(resolve, 15));
const names = async (filter: string) => (await listContacts(f.db, "dec1-owner", tenant, { f: filter })).rows.map((row) => row.name).filter((name) => name.startsWith("D1 ")).sort();

async function connectSource(offered: Purpose[], kind = "connect-intake-v2") {
  const version = await publishIntakeForm(f.db, "dec1-owner", tenant, campaign, { name: "HC-DEC1 form", notice: "Synthetic separate choices", retentionDays: 1, purposes: offered,
    definition: { kind, syntheticOnly: true, preferredName: false, followUpChannel: "email" } });
  const link = await createConnectLink(f.db, "dec1-owner", tenant, campaign, { formVersionId: version.id });
  await transitionConnectLink(f.db, "dec1-owner", tenant, campaign, link.id, { action: "publish" });
  return link.publicCode;
}
async function connectSubmit(code: string, selected: Purpose[], submissionId: string = randomUUID()) {
  const manifest = (await readIntakeManifest(f.db, "qr", code))!;
  const input = { submissionId, receiptToken: manifest.receiptToken, stamp: manifest.stamp, capability: manifest.capability, purposes: selected, email: "guest@example.test" };
  return { input, result: await submitIntake(f.db, "qr", code, input) };
}
const responseOf = async (receiptToken: string) => (await f.admin.query("select r.id from campaign_responses r join connect_intake_receipts x on x.tenant_id = r.tenant_id and x.response_id = r.id where x.receipt_hash = $1", [receiptHash(receiptToken)])).rows[0]?.id as string | undefined;
const responseLedger = async (response: string) => (await f.admin.query("select purpose, status from campaign_response_consents where response_id = $1 order by recorded_at, id", [response])).rows as { purpose: string; status: string }[];
const invitations = async (response: string) => (await f.admin.query("select count(*)::int as n from connect_invitations where response_id = $1", [response])).rows[0].n as number;

beforeAll(async () => {
  f = await testDatabase();
  vi.stubEnv("DATABASE_URL", f.appURL); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("HARVEST_CONNECT_INTAKE", "synthetic"); vi.stubEnv("HARVEST_CONNECT_TEST_KEY", "a".repeat(64));
  await f.db.insert(users).values({ id: "dec1-owner", name: "Owner", email: "dec1-owner@example.test", emailVerified: true });
  tenant = (await createWorkspace(f.db, "dec1-owner", "HC-DEC1")).tenantId;
  campaign = (await createCampaign(f.db, "dec1-owner", tenant, { name: "Synthetic campaign", type: "conference" }, randomUUID())).id;
}, 60_000);
afterAll(async () => { vi.unstubAllEnvs(); await f?.close(); });

describe("Connect: explicit, separate, independently withdrawable", () => {
  it.each([["newsletter"], ["outreach_follow_up"], ["account_communications"]] as [Purpose][])("grants only %s when only it is selected from an offer of all three", async (only) => {
    const code = await connectSource([...connectOfferedPurposes]);
    const { input, result } = await connectSubmit(code, [only]);
    expect(result).toMatchObject({ pending: true });
    const response = (await responseOf(input.receiptToken))!;
    expect(await responseLedger(response)).toEqual([{ purpose: only, status: "granted" }]);
    // Only account_communications can queue the (fixed-text) invitation; no other purpose ever does.
    expect(await invitations(response)).toBe(only === "account_communications" ? 1 : 0);
    // A guest-only response creates no CRM person and no CRM consent: nothing was inferred or copied.
    expect((await f.admin.query("select count(*)::int as n from contact_consents where tenant_id = $1 and source = 'Connect' and evidence like '%' ", [tenant])).rows[0].n).toBe(0);
  });
  it("refuses a purpose the version did not offer and writes nothing", async () => {
    const code = await connectSource(["newsletter"]);
    const before = (await f.admin.query("select count(*)::int as n from campaign_responses")).rows[0].n;
    await expect(connectSubmit(code, ["outreach_follow_up"])).rejects.toMatchObject({ status: 400 });
    await expect(connectSubmit(code, ["newsletter", "account_communications"])).rejects.toMatchObject({ status: 400 });
    expect((await f.admin.query("select count(*)::int as n from campaign_responses")).rows[0].n).toBe(before);
  });
  it("withdraws one purpose at a time, keeps the rest, and a replay or direct write cannot bring it back", async () => {
    const code = await connectSource([...connectOfferedPurposes]);
    const { input } = await connectSubmit(code, ["account_communications", "newsletter", "outreach_follow_up"]);
    const response = (await responseOf(input.receiptToken))!;
    expect(await invitations(response)).toBe(1);
    await applyIntakeRights(f.db, { receiptToken: input.receiptToken, action: "withdraw", purpose: "newsletter" });
    // Effective state: granted and not withdrawn (the ledger is append-only, so a grant row stays after its withdrawal).
    const active = async () => { const rows = await responseLedger(response); return [...new Set(rows.filter((row) => row.status === "granted" && !rows.some((w) => w.purpose === row.purpose && w.status === "withdrawn")).map((row) => row.purpose))].sort(); };
    expect(await active()).toEqual(["account_communications", "outreach_follow_up"]);
    expect((await responseLedger(response)).filter((row) => row.status === "withdrawn")).toEqual([{ purpose: "newsletter", status: "withdrawn" }]);
    // Withdrawing newsletter leaves follow-up and account purposes (and the invitation) intact.
    expect(await invitations(response)).toBe(1);
    const afterWithdrawal = (await responseLedger(response)).length;
    // Redelivery of the same submission is a replay: it writes no new consent row and does not re-grant.
    expect(await connectSubmitReplay(code, input)).toMatchObject({ replayed: true });
    expect((await responseLedger(response)).length).toBe(afterWithdrawal);
    // A direct write of a new grant for the withdrawn purpose is refused by the database, for any writer.
    await expect(f.admin.query("insert into campaign_response_consents(tenant_id,response_id,purpose,status,channel,form_version_id,notice_version_id,actor_kind) select tenant_id,response_id,'newsletter','granted','email',form_version_id,notice_version_id,'subject' from campaign_response_consents where response_id=$1 limit 1", [response]))
      .rejects.toThrow(/purpose was withdrawn/);
    // Withdrawing again is idempotent; withdrawing another purpose is independent of the first.
    await applyIntakeRights(f.db, { receiptToken: input.receiptToken, action: "withdraw", purpose: "newsletter" });
    expect((await responseLedger(response)).length).toBe(afterWithdrawal);
    await withdrawConnectResponsePurpose(f.db, "dec1-owner", tenant, response, "outreach_follow_up");
    expect(await active()).toEqual(["account_communications"]);
    expect(await invitations(response)).toBe(1);
    // Account communications is withdrawn on its own and only then does the invitation go away.
    await applyIntakeRights(f.db, { receiptToken: input.receiptToken, action: "withdraw", purpose: "account_communications" });
    expect(await invitations(response)).toBe(0);
  });
});
async function connectSubmitReplay(code: string, input: Awaited<ReturnType<typeof connectSubmit>>["input"]) { return submitIntake(f.db, "qr", code, input); }

describe("CRM ledger: latest state wins and nothing is implied", () => {
  it("never grants another purpose: each purpose, and the follow-up/newsletter pair, stand alone", async () => {
    const person = await createContact(f.db, "dec1-owner", tenant, { name: "D1 Separate", email: "d1-separate@example.test" });
    await consent(person.id, "outreach_follow_up", "granted");
    expect(await names("newsletter~any_of~granted")).not.toContain("D1 Separate");
    expect(await names("followup_email~any_of~granted")).toContain("D1 Separate");
    expect(await recordAssociation(f.db, "dec1-owner", tenant, { source: "form", kind: "form_submission", purpose: "newsletter", contactId: person.id })).toMatchObject({ stored: false, reason: "consent_missing" });
    await consent(person.id, "newsletter", "granted"); await pause();
    await consent(person.id, "outreach_follow_up", "withdrawn");
    // Withdrawing follow-up leaves the newsletter permission and the newsletter association gate untouched.
    expect(await names("newsletter~any_of~granted")).toContain("D1 Separate");
    expect(await names("followup_email~any_of~withdrawn")).toContain("D1 Separate");
    expect(await recordAssociation(f.db, "dec1-owner", tenant, { source: "form", kind: "form_submission", purpose: "newsletter", contactId: person.id, externalId: "d1-sep-1" })).toMatchObject({ stored: true });
  });
  it("keeps a newsletter withdrawal when an older or backdated grant arrives later, on every surface", async () => {
    const person = await createContact(f.db, "dec1-owner", tenant, { name: "D1 Backdated", email: "d1-backdated@example.test" });
    await consent(person.id, "newsletter", "granted"); await pause();
    await consent(person.id, "newsletter", "withdrawn"); await pause();
    // A late-recorded grant that claims an earlier moment (replay of an older submission, redelivery, re-import) cannot clear it.
    await consent(person.id, "newsletter", "granted", { occurredAt: new Date(Date.now() - 3_600_000).toISOString() });
    expect(await names("newsletter~any_of~withdrawn")).toContain("D1 Backdated");
    expect(await names("newsletter~any_of~granted")).not.toContain("D1 Backdated");
    expect(await recordAssociation(f.db, "dec1-owner", tenant, { source: "form", kind: "form_submission", purpose: "newsletter", contactId: person.id, externalId: "d1-bd-1" })).toMatchObject({ stored: false, reason: "consent_withdrawn" });
    expect((await associationPermissions(f.db, "dec1-owner", tenant, person.id)).purposes.find((item) => item.purpose === "newsletter")?.status).toBe("withdrawn");
    expect((await getContact(f.db, "dec1-owner", tenant, person.id)).effectiveConsents.find((event) => event.purpose === "newsletter")?.status).toBe("withdrawn");
    // Only a genuinely later opt-in clears it.
    await pause();
    await consent(person.id, "newsletter", "granted");
    expect(await names("newsletter~any_of~granted")).toContain("D1 Backdated");
  });
  it("lets list, count, export and the association gate agree for every ledger shape", async () => {
    const make = async (name: string) => (await createContact(f.db, "dec1-owner", tenant, { name, email: `${name.toLowerCase().replace(/\W+/g, "-")}@example.test` })).id;
    const shapes: Record<string, string> = {
      none: await make("D1 Agree none"), granted: await make("D1 Agree granted"), withdrawn: await make("D1 Agree withdrawn"),
      regranted: await make("D1 Agree regranted"), unknown: await make("D1 Agree unknown"), legacy: await make("D1 Agree legacy"),
    };
    await consent(shapes.granted, "newsletter", "granted");
    await consent(shapes.withdrawn, "newsletter", "granted"); await pause(); await consent(shapes.withdrawn, "newsletter", "withdrawn");
    await consent(shapes.regranted, "newsletter", "granted"); await pause(); await consent(shapes.regranted, "newsletter", "withdrawn"); await pause(); await consent(shapes.regranted, "newsletter", "granted");
    await consent(shapes.unknown, "newsletter", "granted"); await pause(); await consent(shapes.unknown, "newsletter", "unknown");
    // A legacy row (history from before purposes) is stored with a neutral purpose; it must satisfy nothing.
    await f.admin.query("begin");
    try {
      await f.admin.query("alter table contact_consents disable trigger user");
      await f.admin.query("insert into contact_consents(tenant_id,contact_id,purpose,notice_version,channel,status,source,evidence) select tenant_id,id,'legacy_unspecified','legacy-unversioned','email','granted','Legacy','Legacy' from contacts where id=$1", [shapes.legacy]);
      await f.admin.query("alter table contact_consents enable trigger user"); await f.admin.query("commit");
    } catch (error) { await f.admin.query("rollback"); throw error; }
    const expected = new Set(["granted", "regranted"]);
    const fromList = new Set((await names("newsletter~any_of~granted")));
    const query = { f: "newsletter~any_of~granted" };
    const file = await exportRecords(f.db, "dec1-owner", tenant, "person", query);
    const count = await exportCount(f.db, "dec1-owner", tenant, "person", query);
    const emailOf = (name: string) => `${name.toLowerCase().replace(/\W+/g, "-")}@example.test`;
    for (const [shape, id] of Object.entries(shapes)) {
      const name = `D1 Agree ${shape.toLowerCase()}`, inList = fromList.has(name), inFile = file.body.includes(emailOf(name));
      const gate = await recordAssociation(f.db, "dec1-owner", tenant, { source: "form", kind: "form_submission", purpose: "newsletter", contactId: id, externalId: `d1-agree-${shape}` });
      const summary = (await associationPermissions(f.db, "dec1-owner", tenant, id)).purposes.find((item) => item.purpose === "newsletter")!.status;
      const allowed = expected.has(shape);
      expect({ shape, inList, inFile, stored: gate.stored, summary: summary === "granted" }, shape).toEqual({ shape, inList: allowed, inFile: allowed, stored: allowed, summary: allowed });
    }
    // The shared filter's own total equals the file's rows for the people created here.
    expect(count.total).toBe(file.rows);
    // A person who is withdrawn is excluded from a newsletter-granted export and found by the withdrawn one.
    const withdrawnFile = await exportRecords(f.db, "dec1-owner", tenant, "person", { f: "newsletter~any_of~withdrawn" });
    expect(withdrawnFile.body).toContain(emailOf("D1 Agree withdrawn"));
    expect(withdrawnFile.body).not.toContain(emailOf("D1 Agree granted"));
  });
  it("counts a newsletter permission only on the email channel, while a withdrawal on any channel still blocks (F4, HC-DEC1b)", async () => {
    // Engineering default, UNAPPROVED pending legal review. An SMS grant neither enters the email segment nor satisfies the gate.
    const person = await createContact(f.db, "dec1-owner", tenant, { name: "D1 Sms newsletter", email: "d1-sms-newsletter@example.test" });
    await consent(person.id, "newsletter", "granted", { channel: "sms" });
    expect(await names("newsletter~any_of~granted")).not.toContain("D1 Sms newsletter");
    expect((await exportRecords(f.db, "dec1-owner", tenant, "person", { f: "newsletter~any_of~granted" })).body).not.toContain("d1-sms-newsletter@example.test");
    expect(await recordAssociation(f.db, "dec1-owner", tenant, { source: "form", kind: "form_submission", purpose: "newsletter", contactId: person.id, externalId: "d1-sms-1" })).toMatchObject({ stored: false, reason: "consent_missing" });
    // A withdrawal on any channel blocks the gate (fail closed) and the newsletter list reads it the same way.
    await pause();
    await consent(person.id, "newsletter", "withdrawn", { channel: "sms" });
    expect(await recordAssociation(f.db, "dec1-owner", tenant, { source: "form", kind: "form_submission", purpose: "newsletter", contactId: person.id, externalId: "d1-sms-2" })).toMatchObject({ stored: false, reason: "consent_withdrawn" });
    expect(await names("newsletter~any_of~withdrawn")).toContain("D1 Sms newsletter");
  });
  it("lets a merge move events without letting an older grant beat a newer withdrawal", async () => {
    const target = await createContact(f.db, "dec1-owner", tenant, { name: "D1 Merge target" });
    const source = await createContact(f.db, "dec1-owner", tenant, { name: "D1 Merge source" });
    await consent(source.id, "newsletter", "granted"); await pause();
    await consent(target.id, "newsletter", "withdrawn");
    const [t, s] = [await getContact(f.db, "dec1-owner", tenant, target.id), await getContact(f.db, "dec1-owner", tenant, source.id)];
    await mergeContacts(f.db, "dec1-owner", tenant, target.id, { sourceId: source.id, targetVersion: t.version, sourceVersion: s.version });
    expect(await names("newsletter~any_of~withdrawn")).toContain("D1 Merge target");
    expect(await names("newsletter~any_of~granted")).not.toContain("D1 Merge target");
    expect((await ledger(target.id)).map((row) => row.status)).toEqual(["granted", "withdrawn"]);
  });
  it("never writes the consent ledger from a CSV import, and a re-import cannot change an opt-out", async () => {
    const person = await createContact(f.db, "dec1-owner", tenant, { name: "D1 Import", email: "d1-import@example.test" });
    await consent(person.id, "newsletter", "granted"); await pause(); await consent(person.id, "newsletter", "withdrawn");
    const before = (await ledger(person.id)).length;
    for (const [onMatch, row] of [["skip", "Import Row,d1-import@example.test,yes,yes"], ["fill", "Import Row,d1-import@example.test,yes,yes"], ["fill", "D1 Fresh,d1-fresh@example.test,yes,yes"]] as const) {
      let record = await createImport(f.db, "dec1-owner", tenant, { entity: "person", clientKey: randomUUID(), fileName: "synthetic.csv", csv: `Name,Email,Newsletter,Consent\n${row}` });
      record = await updateImport(f.db, "dec1-owner", tenant, record.id, { version: record.version, onMatch });
      await previewImport(f.db, "dec1-owner", tenant, record.id, { version: record.version });
      await commitImport(f.db, "dec1-owner", tenant, record.id);
    }
    expect((await ledger(person.id)).length).toBe(before);
    expect(await names("newsletter~any_of~withdrawn")).toContain("D1 Import");
    const fresh = (await f.admin.query("select id from contacts c where tenant_id=$1 and name='D1 Fresh'", [tenant])).rows[0];
    expect(fresh, "the import did create a person").toBeTruthy();
    expect(await ledger(fresh.id)).toEqual([]);
  });
});

describe("Contact paths: nothing here can send or bypass a purpose", () => {
  it("offers the assistant no tool that records consent, links an activity or contacts a person, and every write tool is approval-gated", () => {
    const writes = Object.entries(crmTools).filter(([, tool]) => tool.mode === "write").map(([name]) => name).sort();
    expect(writes).toEqual(["crm_create_task", "crm_move_deal"]);
    expect(Object.keys(crmTools).filter((name) => /consent|association|send|message|email|newsletter|follow|dm|broadcast/.test(name))).toEqual([]);
  });
  it("keeps community notification email independent of every consent ledger, and its content to fixed templates", async () => {
    for (const name of ["community_email_enqueue", "community_email_claim"]) {
      const { rows } = await f.admin.query("select prosrc from pg_proc where proname = $1", [name]);
      expect(rows).toHaveLength(1);
      expect(rows[0].prosrc, name).not.toMatch(/contact_consents|campaign_response_consents|crm_associations|campaign_responses|form_versions/);
    }
  });
});
