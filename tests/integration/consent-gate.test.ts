import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabase } from "../database";
import { crmAssociations, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createContact, eraseContact, getContact, listContacts, recordConsent } from "../../src/server/contacts";
import { associationPermissions, recordAssociation } from "../../src/server/crm-associations";
import { exportCount, exportRecords } from "../../src/server/crm-export";
import { mayContact } from "../../src/server/consent-gate";
import { withTenant } from "../../src/server/tenancy";
import type { ConsentChannel, ConsentPurpose } from "../../src/lib/consent-purposes";

// HC-DEC1b (engineering defaults, UNAPPROVED pending legal review). Synthetic data only; nothing is sent.
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, other: string;
const proof = { noticeVersion: "notice-v1", source: "Synthetic signed form", evidence: "Synthetic evidence reference" } as const;
const record = (user: string, contact: string, purpose: ConsentPurpose & ("newsletter" | "messaging" | "form_follow_up" | "outreach_follow_up" | "marketing"), status: "granted" | "withdrawn" | "unknown", channel: ConsentChannel, extra: { occurredAt?: string; tenantId?: string } = {}) =>
  recordConsent(f.db, user, extra.tenantId ?? tenant, contact, { ...proof, purpose, status, channel, ...(extra.occurredAt ? { occurredAt: extra.occurredAt } : {}) });
const pause = () => new Promise((resolve) => setTimeout(resolve, 15));
const emailOf = (name: string) => `${name.toLowerCase().replace(/\W+/g, "-")}@example.test`;
const names = async (filter: string) => (await listContacts(f.db, "g-owner", tenant, { f: filter })).rows.map((row) => row.name).filter((name) => name.startsWith("G ")).sort();
const gate = (contact: string, purpose: ConsentPurpose, channel: ConsentChannel) => withTenant(f.db, "g-owner", tenant, "contacts:read", (tx, tenantId) => mayContact(tx, tenantId, contact, purpose, channel));

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(["g-owner", "g-admin", "g-member", "g-viewer", "g-outsider"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  tenant = (await createWorkspace(f.db, "g-owner", "Consent gate")).tenantId;
  other = (await createWorkspace(f.db, "g-outsider", "Consent gate other")).tenantId;
  await putMember(f.db, "g-owner", tenant, "g-admin@example.test", "admin");
  await putMember(f.db, "g-owner", tenant, "g-member@example.test", "member");
  await putMember(f.db, "g-owner", tenant, "g-viewer@example.test", "viewer");
}, 60_000);
afterAll(async () => { await f?.close(); });

describe("F4: newsletter grants count on the email channel only; a withdrawal on any channel blocks", () => {
  type Shape = { name: string; build: (id: string) => Promise<void>; granted: boolean; withdrawn: boolean };
  const shapes: Shape[] = [
    { name: "none", build: async () => undefined, granted: false, withdrawn: false },
    { name: "email grant", build: async (id) => { await record("g-owner", id, "newsletter", "granted", "email"); }, granted: true, withdrawn: false },
    { name: "sms grant", build: async (id) => { await record("g-owner", id, "newsletter", "granted", "sms"); }, granted: false, withdrawn: false },
    { name: "social grant", build: async (id) => { await record("g-owner", id, "newsletter", "granted", "social"); }, granted: false, withdrawn: false },
    { name: "email grant and sms withdrawal", build: async (id) => { await record("g-owner", id, "newsletter", "granted", "email"); await pause(); await record("g-owner", id, "newsletter", "withdrawn", "sms"); }, granted: false, withdrawn: true },
    { name: "sms grant and email withdrawal", build: async (id) => { await record("g-owner", id, "newsletter", "granted", "sms"); await pause(); await record("g-owner", id, "newsletter", "withdrawn", "email"); }, granted: false, withdrawn: true },
    { name: "email grant, email withdrawal, email re-grant", build: async (id) => { await record("g-owner", id, "newsletter", "granted", "email"); await pause(); await record("g-owner", id, "newsletter", "withdrawn", "email"); await pause(); await record("g-owner", id, "newsletter", "granted", "email"); }, granted: true, withdrawn: false },
  ];
  it("list, count, export, association gate, permission card and mayContact agree on every ledger shape", async () => {
    const ids = new Map<string, string>();
    for (const shape of shapes) {
      const name = `G Shape ${shape.name}`;
      const id = (await createContact(f.db, "g-owner", tenant, { name, email: emailOf(name) })).id;
      ids.set(shape.name, id); await shape.build(id); await pause();
    }
    const grantedList = new Set(await names("newsletter~any_of~granted")), withdrawnList = new Set(await names("newsletter~any_of~withdrawn"));
    const grantedFile = await exportRecords(f.db, "g-owner", tenant, "person", { f: "newsletter~any_of~granted" });
    const withdrawnFile = await exportRecords(f.db, "g-owner", tenant, "person", { f: "newsletter~any_of~withdrawn" });
    const counted = await exportCount(f.db, "g-owner", tenant, "person", { f: "newsletter~any_of~granted" });
    expect(counted.total).toBe(grantedFile.rows);
    for (const shape of shapes) {
      const id = ids.get(shape.name)!, name = `G Shape ${shape.name}`;
      const association = await recordAssociation(f.db, "g-owner", tenant, { source: "form", kind: "form_submission", purpose: "newsletter", contactId: id, externalId: `g-shape-${shape.name}` });
      const card = (await associationPermissions(f.db, "g-owner", tenant, id)).purposes.find((item) => item.purpose === "newsletter")!.status;
      const email = await gate(id, "newsletter", "email");
      const observed = { inList: grantedList.has(name), inFile: grantedFile.body.includes(emailOf(name)), stored: association.stored, card, mayContact: email.allowed,
        withdrawnList: withdrawnList.has(name), withdrawnFile: withdrawnFile.body.includes(emailOf(name)) };
      expect({ shape: shape.name, ...observed }, shape.name).toEqual({ shape: shape.name, inList: shape.granted, inFile: shape.granted, stored: shape.granted,
        card: shape.granted ? "granted" : shape.withdrawn ? "withdrawn" : "none", mayContact: shape.granted, withdrawnList: shape.withdrawn, withdrawnFile: shape.withdrawn });
      if (!email.allowed) expect(email.reason).toBe(shape.withdrawn ? "consent_withdrawn" : "consent_missing");
      // The newsletter is never contactable on a non-email channel, whatever the ledger says.
      expect(await gate(id, "newsletter", "sms")).toMatchObject({ allowed: false, reason: "channel_not_permitted" });
    }
  });
  it("the database insert guard refuses an association backed by a non-email newsletter grant, even if the service is bypassed", async () => {
    const id = (await createContact(f.db, "g-owner", tenant, { name: "G Guard sms", email: emailOf("G Guard sms") })).id;
    await record("g-owner", id, "newsletter", "granted", "sms");
    const consentId = (await getContact(f.db, "g-owner", tenant, id)).consents.find((row) => row.purpose === "newsletter")!.id;
    await expect(withTenant(f.db, "g-owner", tenant, "contacts:write", (tx, tenantId) => tx.insert(crmAssociations).values({ tenantId, contactId: id, source: "form", kind: "signup", purpose: "newsletter", consentId, occurredAt: new Date(), createdBy: "g-owner" }))).rejects.toThrow();
    // The same insert backed by an email grant is accepted.
    await pause(); await record("g-owner", id, "newsletter", "granted", "email");
    const emailGrant = (await getContact(f.db, "g-owner", tenant, id)).consents.find((row) => row.purpose === "newsletter" && row.channel === "email")!.id;
    await withTenant(f.db, "g-owner", tenant, "contacts:write", (tx, tenantId) => tx.insert(crmAssociations).values({ tenantId, contactId: id, source: "form", kind: "signup", purpose: "newsletter", consentId: emailGrant, occurredAt: new Date(), createdBy: "g-owner" }));
  });
  it("messaging, form_follow_up and outreach follow-up keep their any-channel / per-channel behaviour", async () => {
    const id = (await createContact(f.db, "g-owner", tenant, { name: "G Other purposes", email: emailOf("G Other purposes") })).id;
    await record("g-owner", id, "messaging", "granted", "sms");
    await record("g-owner", id, "form_follow_up", "granted", "social");
    await record("g-owner", id, "outreach_follow_up", "granted", "sms");
    expect(await recordAssociation(f.db, "g-owner", tenant, { source: "form", kind: "form_submission", purpose: "messaging", contactId: id, externalId: "g-msg" })).toMatchObject({ stored: true });
    expect(await recordAssociation(f.db, "g-owner", tenant, { source: "form", kind: "form_submission", purpose: "form_follow_up", contactId: id, externalId: "g-ffu" })).toMatchObject({ stored: true });
    expect(await names("followup_sms~any_of~granted")).toContain("G Other purposes");
    expect(await names("followup_email~any_of~granted")).not.toContain("G Other purposes");
    expect(await gate(id, "outreach_follow_up", "sms")).toMatchObject({ allowed: true });
    expect(await gate(id, "outreach_follow_up", "email")).toMatchObject({ allowed: false, reason: "consent_missing" });
    expect(await gate(id, "messaging", "sms")).toMatchObject({ allowed: true });
  });
});

describe("mayContact", () => {
  it("fails closed for erased, unknown and other-tenant people, and for legacy_unspecified, with a reason code and no personal data", async () => {
    const erased = (await createContact(f.db, "g-owner", tenant, { name: "G Erased", email: emailOf("G Erased") })).id;
    await record("g-owner", erased, "messaging", "granted", "email");
    expect(await gate(erased, "messaging", "email")).toMatchObject({ allowed: true });
    await eraseContact(f.db, "g-owner", tenant, erased);
    expect(await gate(erased, "messaging", "email")).toEqual({ allowed: false, reason: "person_unavailable", event: null });
    expect(await gate("00000000-0000-4000-8000-000000000001", "messaging", "email")).toMatchObject({ allowed: false, reason: "person_unavailable" });
    const foreign = (await createContact(f.db, "g-outsider", other, { name: "G Foreign", email: emailOf("G Foreign") })).id;
    expect(await gate(foreign, "messaging", "email")).toMatchObject({ allowed: false, reason: "person_unavailable" });
    expect(await gate((await createContact(f.db, "g-owner", tenant, { name: "G Legacy", email: emailOf("G Legacy") })).id, "legacy_unspecified", "email")).toMatchObject({ allowed: false, reason: "purpose_not_contactable" });
    expect(JSON.stringify(await gate(foreign, "messaging", "email"))).not.toContain("@");
  });
});

describe("F9: staff attestation is owner/admin only, with evidence, audited", () => {
  const input = { ...proof, purpose: "messaging", status: "granted", channel: "email" } as const;
  const ledgerCount = async () => Number((await f.admin.query("select count(*)::int as n from contact_consents where tenant_id = $1", [tenant])).rows[0].n);
  const auditCount = async () => Number((await f.admin.query("select count(*)::int as n from audit_logs where tenant_id = $1 and action = 'contact.consent_record'", [tenant])).rows[0].n);
  let person: string;
  beforeAll(async () => { person = (await createContact(f.db, "g-owner", tenant, { name: "G Attest", email: emailOf("G Attest") })).id; });
  it.each(["g-owner", "g-admin"])("%s may record a grant and a withdrawal", async (user) => {
    await expect(recordConsent(f.db, user, tenant, person, input)).resolves.toMatchObject({ status: "granted" });
    await pause();
    await expect(recordConsent(f.db, user, tenant, person, { ...input, status: "withdrawn" })).resolves.toMatchObject({ status: "withdrawn" });
  });
  it("members, viewers and people outside the ministry are denied with the same semantics and write nothing", async () => {
    const before = [await ledgerCount(), await auditCount()];
    const denials = [];
    for (const user of ["g-member", "g-viewer", "g-outsider"]) {
      for (const status of ["granted", "withdrawn", "unknown"] as const) {
        const error = await recordConsent(f.db, user, tenant, person, { ...input, status }).then(() => null, (caught) => caught);
        denials.push({ user, status, code: error?.status, message: error?.message });
      }
    }
    expect(denials.every((denial) => denial.code === 403)).toBe(true);
    // Members and viewers get the same role denial for every status; a non-member gets the existing workspace denial (same status).
    expect(new Set(denials.filter((denial) => denial.user !== "g-outsider").map((denial) => denial.message)).size).toBe(1);
    expect(new Set(denials.filter((denial) => denial.user === "g-outsider").map((denial) => denial.message)).size).toBe(1);
    expect([await ledgerCount(), await auditCount()]).toEqual(before);
  });
  it("requires evidence: a method, an explanation and a plausible, non-future date; nothing is written otherwise", async () => {
    const before = [await ledgerCount(), await auditCount()];
    const bad = [{ source: " " }, { evidence: "" }, { occurredAt: new Date(Date.now() + 86_400_000).toISOString() }, { occurredAt: "1970-01-02T00:00:00Z" }, { purpose: "legacy_unspecified" }, { occurredAt: "not a date" }];
    // Validation runs before any database work, so it throws synchronously.
    for (const override of bad) expect(() => recordConsent(f.db, "g-owner", tenant, person, { ...input, ...override } as never), JSON.stringify(override)).toThrow();
    expect([await ledgerCount(), await auditCount()]).toEqual(before);
    // A date supplied in the past is kept; omitted means the time of recording. Either way a date is stored.
    const dated = await recordConsent(f.db, "g-owner", tenant, person, { ...input, occurredAt: "2025-06-01T12:00:00Z" });
    expect(new Date(dated.occurredAt).toISOString()).toBe("2025-06-01T12:00:00.000Z");
    expect((await recordConsent(f.db, "g-owner", tenant, person, input)).occurredAt).toBeInstanceOf(Date);
  });
  it("writes an audit row with ids and categories only", async () => {
    const secret = await createContact(f.db, "g-owner", tenant, { name: "G Audit Person", email: "g-audit-person@example.test", phone: "+49123456781" });
    const row = await recordConsent(f.db, "g-admin", tenant, secret.id, { ...input, source: "Signed paper form SOURCE-MARK", evidence: "Evidence text EVIDENCE-MARK" });
    const audit = (await f.admin.query("select actor_id, target_id, metadata from audit_logs where tenant_id = $1 and action = 'contact.consent_record' and metadata->>'consentId' = $2", [tenant, row.id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: "g-admin", target_id: secret.id, metadata: { consentId: row.id, purpose: "messaging", channel: "email", status: "granted", attested: "staff" } });
    expect(Object.keys(audit[0].metadata).sort()).toEqual(["attested", "channel", "consentId", "purpose", "status"]);
    const text = JSON.stringify(audit[0]);
    for (const leaked of ["SOURCE-MARK", "EVIDENCE-MARK", "g-audit-person@example.test", "+49123456781", "G Audit Person"]) expect(text).not.toContain(leaked);
  });
});
