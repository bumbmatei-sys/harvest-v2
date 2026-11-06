import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { testDatabase } from "../database";
import * as schema from "../../src/db/schema";
import { crmAssociations, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createContact, eraseContact, getContact, recordConsent } from "../../src/server/contacts";
import { createCompany } from "../../src/server/companies";
import { createNote } from "../../src/server/crm-tasks";
import { getTimeline, loadAssociations } from "../../src/server/activity";
import { associationPermissions, recordAssociation, type AssociationInput } from "../../src/server/crm-associations";
import { withTenant } from "../../src/server/tenancy";
import { mergeContacts, previewMerge } from "../../src/server/crm-merge";
import { commitImport, createImport, previewImport, rollbackImport } from "../../src/server/crm-imports";
import { randomUUID } from "node:crypto";

let fixture: Awaited<ReturnType<typeof testDatabase>>, tenantA: string, tenantB: string, ana: string, companyA: string;
const later = (fn: () => unknown) => Promise.resolve().then(fn);
const grant = (user: string, tenant: string, contact: string, purpose: "messaging" | "form_follow_up" | "newsletter", status: "granted" | "withdrawn" = "granted", channel: "email" | "social" | "sms" = "social") =>
  recordConsent(fixture.db, user, tenant, contact, { channel, status, purpose, noticeVersion: "notice-v1", source: `Synthetic ${purpose} ${status}`, evidence: "Synthetic test evidence" });
const message = (overrides: Partial<AssociationInput> = {}): AssociationInput => ({ source: "zernio", kind: "message", purpose: "messaging", contactId: ana, summary: "Synthetic: asked about the youth trip", ...overrides });
const count = async (table = "crm_associations", tenant = tenantA) => (await fixture.admin.query(`select count(*)::int as n from ${table} where tenant_id = $1`, [tenant])).rows[0].n as number;

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "member-a", "viewer-a", "owner-b"].map((id) => ({ id, name: `Synthetic ${id}`, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "Associations A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "Associations B")).tenantId;
  await putMember(fixture.db, "owner-a", tenantA, "member-a@example.test", "member");
  await putMember(fixture.db, "owner-a", tenantA, "viewer-a@example.test", "viewer");
  ana = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Ana", email: "ana@example.test", social: "@ana_s" })).id;
  companyA = (await createCompany(fixture.db, "owner-a", tenantA, { name: "Synthetic Grace Chapel", domain: "grace.example" })).id;
});
afterAll(async () => { await fixture?.close(); });

describe("CRM-07 table security", () => {
  it("forces RLS, grants the app only SELECT and INSERT, and with app.tenant_id = '' reads nothing and refuses inserts (required test 1)", async () => {
    await grant("owner-a", tenantA, ana, "messaging");
    expect(await recordAssociation(fixture.db, "member-a", tenantA, message())).toMatchObject({ stored: true });
    expect(await count()).toBeGreaterThan(0);
    const { rows } = await fixture.admin.query("select relforcerowsecurity from pg_class where relname = 'crm_associations'");
    expect(rows).toEqual([{ relforcerowsecurity: true }]);
    const grants = await fixture.admin.query("select privilege_type from information_schema.role_table_grants where grantee = 'harvest_app' and table_name = 'crm_associations' order by 1");
    expect(grants.rows.map((row) => row.privilege_type)).toEqual(["INSERT", "SELECT"]);
    const consentId = (await getContact(fixture.db, "owner-a", tenantA, ana)).consents[0].id;
    await fixture.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', '', true), set_config('app.user_id', 'owner-a', true)`);
      expect(await tx.select().from(crmAssociations)).toEqual([]);
      await expect(tx.execute(sql`savepoint s`).then(() => tx.insert(crmAssociations).values({ tenantId: tenantA, contactId: ana, source: "zernio", kind: "message", purpose: "messaging", consentId, occurredAt: new Date(), createdBy: "owner-a" })))
        .rejects.toThrow();
      await tx.execute(sql`rollback to savepoint s`);
    });
    // Without any context at all, nothing either.
    expect(await fixture.db.select().from(crmAssociations)).toEqual([]);
  });

  it("keeps each workspace's associations to itself, both ways, in the service and in SQL (required test 2)", async () => {
    const bob = (await createContact(fixture.db, "owner-b", tenantB, { name: "Synthetic Bob", email: "bob@example.test" })).id;
    await grant("owner-b", tenantB, bob, "messaging");
    expect(await recordAssociation(fixture.db, "owner-b", tenantB, message({ contactId: bob, summary: "B only" }))).toMatchObject({ stored: true });
    // A person id from the other workspace is "not found"; the other workspace itself is "forbidden".
    await expect(recordAssociation(fixture.db, "owner-b", tenantB, message())).rejects.toMatchObject({ status: 404 });
    await expect(recordAssociation(fixture.db, "owner-b", tenantA, message())).rejects.toMatchObject({ status: 403 });
    await expect(recordAssociation(fixture.db, "owner-a", tenantA, message({ contactId: bob }))).rejects.toMatchObject({ status: 404 });
    // Identifiers never reach across workspaces either.
    expect(await recordAssociation(fixture.db, "owner-b", tenantB, message({ contactId: undefined, identifiers: { email: "ana@example.test" } }))).toEqual({ stored: false, reason: "no_match", contactId: null });
    await expect(getTimeline(fixture.db, "owner-b", tenantB, "person", ana)).rejects.toMatchObject({ status: 404 });
    await expect(getTimeline(fixture.db, "owner-b", tenantA, "person", ana)).rejects.toMatchObject({ status: 403 });
    await withTenant(fixture.db, "owner-b", tenantB, "contacts:read", async (tx, tenantId) => {
      const rows = await tx.select().from(crmAssociations);
      expect(rows.length).toBe(1);
      expect(rows.every((row) => row.tenantId === tenantId)).toBe(true);
      const consentId = (await tx.execute<{ id: string }>(sql`select id from contact_consents where contact_id = ${bob}::uuid`)).rows[0].id;
      await expect(tx.execute(sql`savepoint s`).then(() => tx.insert(crmAssociations).values({ tenantId: tenantA, contactId: ana, source: "zernio", kind: "message", purpose: "messaging", consentId, occurredAt: new Date(), createdBy: "owner-b" }))).rejects.toThrow();
      await tx.execute(sql`rollback to savepoint s`);
      await expect(tx.execute(sql`savepoint t`).then(() => tx.insert(crmAssociations).values({ tenantId, contactId: ana, source: "zernio", kind: "message", purpose: "messaging", consentId, occurredAt: new Date(), createdBy: "owner-b" }))).rejects.toThrow();
      await tx.execute(sql`rollback to savepoint t`);
    });
  });

  it("filters by tenant in the service query itself, even with RLS bypassed (guards against a missing tenant filter)", async () => {
    const all = (await fixture.admin.query("select id, tenant_id from crm_associations")).rows as { id: string; tenant_id: string }[];
    expect(new Set(all.map((row) => row.tenant_id)).size).toBe(2);
    // A superuser connection bypasses RLS, so only the service's own tenant predicate can narrow this.
    const unprotected = drizzle(fixture.admin, { schema });
    const rows = await unprotected.transaction((tx) => loadAssociations(tx as never, tenantA, all.map((row) => row.id)));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.tenantId === tenantA)).toBe(true);
  });

  it("refuses viewers and keeps the app from changing or deleting rows", async () => {
    await expect(recordAssociation(fixture.db, "viewer-a", tenantA, message())).rejects.toMatchObject({ status: 403 });
    await expect(withTenant(fixture.db, "owner-a", tenantA, "contacts:write", (tx) => tx.update(crmAssociations).set({ summary: "changed" }))).rejects.toThrow();
    await expect(withTenant(fixture.db, "owner-a", tenantA, "contacts:write", (tx) => tx.delete(crmAssociations))).rejects.toThrow();
  });
});

describe("consent per purpose (required test 3)", () => {
  it("stores nothing without consent for the purpose, stops after a withdrawal and resumes only after a later opt-in", async () => {
    const eve = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Eve", email: "eve@example.test", phone: "+4915100000042" })).id;
    const before = { rows: await count(), audit: await count("audit_logs"), outbox: (await fixture.admin.query("select count(*)::int as n from outbox_events where kind = 'crm.association.recorded'")).rows[0].n };
    const form = { source: "form", kind: "form_submission", purpose: "form_follow_up", contactId: eve, summary: "Synthetic form" } as const;
    expect(await recordAssociation(fixture.db, "member-a", tenantA, form)).toEqual({ stored: false, reason: "consent_missing", contactId: eve });
    // A messaging opt-in does not cover form follow-up: purposes are never bundled.
    await grant("owner-a", tenantA, eve, "messaging");
    expect(await recordAssociation(fixture.db, "member-a", tenantA, form)).toMatchObject({ stored: false, reason: "consent_missing" });
    expect({ rows: await count(), audit: await count("audit_logs") - 1, outbox: (await fixture.admin.query("select count(*)::int as n from outbox_events where kind = 'crm.association.recorded'")).rows[0].n })
      .toEqual(before); // only the consent ledger row was added
    await grant("owner-a", tenantA, eve, "form_follow_up", "granted", "email");
    const stored = await recordAssociation(fixture.db, "member-a", tenantA, { ...form, externalId: "form-1" });
    expect(stored).toMatchObject({ stored: true, duplicate: false, contactId: eve });
    // Redelivery is idempotent.
    expect(await recordAssociation(fixture.db, "member-a", tenantA, { ...form, externalId: "form-1" })).toMatchObject({ stored: true, duplicate: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await grant("owner-a", tenantA, eve, "form_follow_up", "withdrawn", "email");
    expect(await recordAssociation(fixture.db, "member-a", tenantA, { ...form, externalId: "form-2" })).toMatchObject({ stored: false, reason: "consent_withdrawn" });
    // The database refuses it too, even with a valid grant id (the withdrawal is outstanding).
    const grantId = (await fixture.admin.query("select id from contact_consents where contact_id = $1 and purpose = 'form_follow_up' and status = 'granted'", [eve])).rows[0].id;
    await expect(withTenant(fixture.db, "member-a", tenantA, "contacts:write", (tx, tenantId) => tx.insert(crmAssociations).values({ tenantId, contactId: eve, source: "form", kind: "form_submission", purpose: "form_follow_up", consentId: grantId, occurredAt: new Date(), createdBy: "member-a" })))
      .rejects.toThrow();
    // A grant id for another purpose is refused as well.
    const messagingId = (await fixture.admin.query("select id from contact_consents where contact_id = $1 and purpose = 'messaging'", [eve])).rows[0].id;
    await expect(withTenant(fixture.db, "member-a", tenantA, "contacts:write", (tx, tenantId) => tx.insert(crmAssociations).values({ tenantId, contactId: eve, source: "form", kind: "form_submission", purpose: "form_follow_up", consentId: messagingId, occurredAt: new Date(), createdBy: "member-a" })))
      .rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await grant("owner-a", tenantA, eve, "form_follow_up", "granted", "email");
    expect(await recordAssociation(fixture.db, "member-a", tenantA, { ...form, externalId: "form-3" })).toMatchObject({ stored: true });
    const permissions = await associationPermissions(fixture.db, "viewer-a", tenantA, eve);
    expect(permissions.purposes.map((item) => [item.purpose, item.status])).toEqual([["messaging", "granted"], ["form_follow_up", "granted"], ["newsletter", "none"]]);
    expect(permissions.purposes[1].source).toBe("Synthetic form_follow_up granted");
  });

  it("links by tenant-unique identifiers only, refuses ambiguity, and writes a redacted outbox event and a ledger row", async () => {
    const zoe = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Zoe", phone: "+4915100000077" })).id;
    await grant("owner-a", tenantA, zoe, "messaging");
    const linked = await recordAssociation(fixture.db, "member-a", tenantA, { source: "zernio", kind: "comment", purpose: "messaging", identifiers: { phone: "+49 151 00000077" }, companyDomain: "https://www.grace.example", summary: "Private comment text", externalId: "zernio-comment-1", payload: { text: "Private comment text" } });
    expect(linked).toMatchObject({ stored: true, contactId: zoe });
    await expect(recordAssociation(fixture.db, "member-a", tenantA, { source: "zernio", kind: "message", purpose: "messaging", identifiers: { phone: "+4915100000077", email: "ana@example.test" } })).rejects.toMatchObject({ status: 409 });
    expect(await recordAssociation(fixture.db, "member-a", tenantA, { source: "zernio", kind: "message", purpose: "messaging", identifiers: { email: "nobody@example.test" } })).toMatchObject({ stored: false, reason: "no_match" });
    await expect(later(() => recordAssociation(fixture.db, "member-a", tenantA, { source: "zernio", kind: "message", purpose: "messaging" } as AssociationInput))).rejects.toMatchObject({ status: 400 });
    const row = (await fixture.admin.query("select company_id from crm_associations where external_id = 'zernio-comment-1'")).rows[0];
    expect(row.company_id).toBe(companyA);
    const ledger = (await fixture.admin.query("select metadata from audit_logs where action = 'association.record' and target_id = $1", [linked.stored ? linked.id : ""])).rows[0].metadata;
    expect(ledger).toEqual({ contactId: zoe, companyId: companyA, source: "zernio", kind: "comment", purpose: "messaging" });
    const outbox = (await fixture.admin.query("select payload from outbox_events where idempotency_key = $1", [`crm:association:${linked.stored ? linked.id : ""}:recorded`])).rows;
    expect(outbox).toMatchObject([{ payload: { contactId: zoe, companyId: companyA, summary: { redacted: true, length: 20 }, payload: { redacted: true } } }]);
    expect(JSON.stringify(outbox)).not.toContain("Private comment");
  });
});

describe("consent edge cases (review S2, S3)", () => {
  it("treats a later \"unknown\" on the granted channel like the record page does: no new association, in the service and in SQL", async () => {
    const una = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Una", email: "una@example.test" })).id;
    await grant("owner-a", tenantA, una, "newsletter", "granted", "email");
    const before = await recordAssociation(fixture.db, "member-a", tenantA, { source: "form", kind: "signup", purpose: "newsletter", contactId: una, summary: "Before" });
    expect(before).toMatchObject({ stored: true });
    const grantId = (await getContact(fixture.db, "owner-a", tenantA, una)).consents.find((consent) => consent.purpose === "newsletter")!.id;
    await recordConsent(fixture.db, "owner-a", tenantA, una, { channel: "email", status: "unknown", purpose: "newsletter", noticeVersion: "notice-v1", source: "Synthetic unknown", evidence: "Synthetic test evidence" });
    expect((await getContact(fixture.db, "owner-a", tenantA, una)).effectiveConsents.filter((consent) => consent.purpose === "newsletter").map((consent) => consent.status)).toEqual(["unknown"]);
    expect(await recordAssociation(fixture.db, "member-a", tenantA, { source: "form", kind: "signup", purpose: "newsletter", contactId: una, summary: "After" })).toMatchObject({ stored: false, reason: "consent_missing" });
    expect((await associationPermissions(fixture.db, "viewer-a", tenantA, una)).purposes.find((item) => item.purpose === "newsletter")).toMatchObject({ status: "none" });
    // The SQL guard refuses the superseded grant even when the service is bypassed.
    await expect(withTenant(fixture.db, "member-a", tenantA, "contacts:write", (tx, tenantId) => tx.insert(crmAssociations).values({ tenantId, contactId: una, source: "form", kind: "signup", purpose: "newsletter", consentId: grantId, occurredAt: new Date(), createdBy: "member-a" })))
      .rejects.toThrow();
    // A grant on another channel still allows; the earlier association is kept.
    await grant("owner-a", tenantA, una, "newsletter", "granted", "social");
    expect(await recordAssociation(fixture.db, "member-a", tenantA, { source: "form", kind: "signup", purpose: "newsletter", contactId: una, summary: "Social" })).toMatchObject({ stored: true });
    expect((await fixture.admin.query("select count(*)::int as n from crm_associations where contact_id = $1", [una])).rows[0].n).toBe(2);
  });

  it("reports the channel of an outstanding withdrawal, so an opt-in from the card can clear it", async () => {
    const wen = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Wen" })).id;
    await grant("owner-a", tenantA, wen, "messaging", "granted", "social");
    await grant("owner-a", tenantA, wen, "messaging", "withdrawn", "email");
    expect((await associationPermissions(fixture.db, "viewer-a", tenantA, wen)).purposes.find((item) => item.purpose === "messaging")).toMatchObject({ status: "withdrawn", channel: "email" });
    // A new grant on social (the usual messaging channel) does not clear an email withdrawal; one on email does.
    await grant("owner-a", tenantA, wen, "messaging", "granted", "social");
    expect(await recordAssociation(fixture.db, "member-a", tenantA, message({ contactId: wen }))).toMatchObject({ stored: false, reason: "consent_withdrawn" });
    await grant("owner-a", tenantA, wen, "messaging", "granted", "email");
    expect(await recordAssociation(fixture.db, "member-a", tenantA, message({ contactId: wen }))).toMatchObject({ stored: true });
  });
});

describe("import rollback with linked activity (review B1)", () => {
  it("keeps an imported organization that activity links to instead of failing the rollback", async () => {
    const current = await createImport(fixture.db, "owner-a", tenantA, { entity: "company", clientKey: randomUUID(), fileName: "orgs.csv", csv: "Name,Domain\nSynthetic Rollback Org,rollback-org.example\nSynthetic Spare Org,spare-org.example" });
    await previewImport(fixture.db, "owner-a", tenantA, current.id, { version: current.version });
    let result = await commitImport(fixture.db, "owner-a", tenantA, current.id);
    while (result.remaining > 0) result = await commitImport(fixture.db, "owner-a", tenantA, current.id);
    const org = (await fixture.admin.query("select id from companies where tenant_id = $1 and domain = 'rollback-org.example'", [tenantA])).rows[0].id as string;
    const ivy = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Ivy" })).id;
    await grant("owner-a", tenantA, ivy, "form_follow_up", "granted", "email");
    expect(await recordAssociation(fixture.db, "member-a", tenantA, { source: "form", kind: "form_submission", purpose: "form_follow_up", contactId: ivy, companyDomain: "rollback-org.example", summary: "Synthetic" })).toMatchObject({ stored: true });
    expect((await rollbackImport(fixture.db, "owner-a", tenantA, current.id)).result).toEqual({ removed: 1, reverted: 0, kept: 1 });
    expect((await fixture.admin.query("select domain from companies where tenant_id = $1 and domain in ('rollback-org.example', 'spare-org.example')", [tenantA])).rows).toEqual([{ domain: "rollback-org.example" }]);
    expect((await fixture.admin.query("select count(*)::int as n from crm_associations where company_id = $1", [org])).rows[0].n).toBe(1);
  });
});

describe("erasure (required test 4)", () => {
  it("deletes the person's associations and scrubs other associations that contain their email or phone", async () => {
    const lia = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Lia", email: "Lia.Private@Example.test", phone: "+4915123456789" })).id;
    const tom = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Tom" })).id;
    await grant("owner-a", tenantA, lia, "messaging");
    await grant("owner-a", tenantA, tom, "messaging");
    const own = await recordAssociation(fixture.db, "member-a", tenantA, message({ contactId: lia, summary: "Lia's own message", payload: { from: "lia.private@example.test" } }));
    const byEmail = await recordAssociation(fixture.db, "member-a", tenantA, message({ contactId: tom, summary: "Tom forwarded LIA.PRIVATE@example.TEST", companyId: companyA }));
    const byPhone = await recordAssociation(fixture.db, "member-a", tenantA, message({ contactId: tom, summary: "Call back", payload: { note: "her mobile is 0049 (151) 2345-6789" } }));
    const unrelated = await recordAssociation(fixture.db, "member-a", tenantA, message({ contactId: tom, summary: "Nothing private here", payload: { at: "2026-11-06" } }));
    const ids = [own, byEmail, byPhone, unrelated].map((result) => (result.stored ? result.id : ""));
    await eraseContact(fixture.db, "owner-a", tenantA, lia);
    const rows = (await fixture.admin.query("select id, contact_id, summary, payload, redacted_at is not null as redacted from crm_associations where id = any($1::uuid[]) order by created_at", [ids])).rows;
    expect(rows.map((row) => row.id)).toEqual(ids.slice(1));
    expect(rows.map((row) => [row.summary, row.payload, row.redacted])).toEqual([["", {}, true], ["", {}, true], ["Nothing private here", { at: "2026-11-06" }, false]]);
    const dump = JSON.stringify((await fixture.admin.query("select * from crm_associations where tenant_id = $1", [tenantA])).rows)
      + JSON.stringify((await fixture.admin.query("select metadata from audit_logs where tenant_id = $1 and action = 'association.record'", [tenantA])).rows)
      + JSON.stringify((await fixture.admin.query("select payload from outbox_events where tenant_id = $1 and kind = 'crm.association.recorded'", [tenantA])).rows);
    expect(dump.toLowerCase()).not.toContain("lia.private@example.test");
    expect(dump.replace(/\D/g, "")).not.toContain("4915123456789");
    expect(dump).not.toContain(lia);
    // The scrubbed association still shows on Tom's timeline, without the text.
    const timeline = (await getTimeline(fixture.db, "owner-a", tenantA, "person", tom)).items;
    expect(timeline.find((item) => item.kind === "association" && item.associationId === ids[1])).toMatchObject({ redacted: true, summary: "" });
  });

  it("also scrubs other associations that name the person's social handle as a whole token (review S1)", async () => {
    const ali = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Ali", social: "@Alice_Handle" })).id;
    const ben = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Ben" })).id;
    await grant("owner-a", tenantA, ben, "messaging");
    const stored = await Promise.all([
      message({ contactId: ben, summary: "Ben replied to @alice_handle." }),
      message({ contactId: ben, summary: "Mentioned in thread", payload: { author: "ALICE_HANDLE" } }),
      message({ contactId: ben, summary: "Talked about alice_handlebar and malice_handle", payload: { tag: "x@alice_handle.example" } }),
    ].map((input) => recordAssociation(fixture.db, "member-a", tenantA, input)));
    const ids = stored.map((result) => (result.stored ? result.id : ""));
    await eraseContact(fixture.db, "owner-a", tenantA, ali);
    const rows = (await fixture.admin.query("select id, redacted_at is not null as redacted from crm_associations where id = any($1::uuid[])", [ids])).rows;
    expect(ids.map((id) => rows.find((row) => row.id === id)?.redacted)).toEqual([true, true, false]);
  });

  it("never aborts erasure on a legacy handle full of regex metacharacters, and still scrubs it literally", async () => {
    const leg = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Legacy" })).id;
    // Written before the handle format check existed (or by a path that skipped it).
    await fixture.admin.query("insert into contact_identifiers (tenant_id, contact_id, kind, value, normalized_value) values ($1, $2, 'social', 'a+(b[c]{2}|$', 'a+(b[c]{2}|$')", [tenantA, leg]);
    const kim = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Kim" })).id;
    await grant("owner-a", tenantA, kim, "messaging");
    const hit = await recordAssociation(fixture.db, "member-a", tenantA, message({ contactId: kim, summary: "Reply to @a+(b[c]{2}|$ today" }));
    const miss = await recordAssociation(fixture.db, "member-a", tenantA, message({ contactId: kim, summary: "Reply to abbc today" }));
    await expect(eraseContact(fixture.db, "owner-a", tenantA, leg)).resolves.toBeTruthy();
    const rows = (await fixture.admin.query("select id, redacted_at is not null as redacted from crm_associations where id = any($1::uuid[])", [[hit, miss].map((result) => (result.stored ? result.id : ""))])).rows;
    expect([hit, miss].map((result) => rows.find((row) => result.stored && row.id === result.id)?.redacted)).toEqual([true, false]);
  });
});

describe("merge (required test 5)", () => {
  it("refuses to move an association to another person outside the merge definer", async () => {
    const other = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Other" })).id;
    await expect(fixture.admin.query("update crm_associations set contact_id = $1 where contact_id = $2", [other, ana])).rejects.toThrow(/immutable/);
  });

  it("moves associations to the surviving person on merge, shows them in the preview and on the kept person's timeline", async () => {
    const kept = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Kept", email: "kept@example.test" })).id;
    const dup = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Kept", phone: "+1 555 010 7788" })).id;
    await grant("owner-a", tenantA, dup, "messaging");
    const stored = await recordAssociation(fixture.db, "member-a", tenantA, message({ contactId: dup, summary: "Synthetic: merged-away note" }));
    if (!stored.stored) throw new Error("association was not stored");
    expect(await previewMerge(fixture.db, "owner-a", tenantA, kept, dup)).toMatchObject({ activities: 1, consents: 1 });
    const [k, d] = [await getContact(fixture.db, "owner-a", tenantA, kept), await getContact(fixture.db, "owner-a", tenantA, dup)];
    const merged = await mergeContacts(fixture.db, "owner-a", tenantA, kept, { sourceId: dup, targetVersion: k.version, sourceVersion: d.version });
    expect(merged.moved).toMatchObject({ activities: 1, consents: 1 });
    // The row survives the merged person's erasure, unredacted, now on the kept person with its consent row (which moved too).
    const row = (await fixture.admin.query("select a.contact_id, a.summary, a.redacted_at, c.contact_id as consent_contact from crm_associations a join contact_consents c on c.tenant_id = a.tenant_id and c.id = a.consent_id where a.id = $1", [stored.id])).rows[0];
    expect(row).toMatchObject({ contact_id: kept, consent_contact: kept, summary: "Synthetic: merged-away note", redacted_at: null });
    const timeline = (await getTimeline(fixture.db, "viewer-a", tenantA, "person", kept)).items;
    expect(timeline.some((item) => item.kind === "association" && item.associationId === stored.id)).toBe(true);
    // Later erasure of the kept person still removes it.
    await eraseContact(fixture.db, "owner-a", tenantA, kept);
    expect((await fixture.admin.query("select count(*)::int as n from crm_associations where id = $1", [stored.id])).rows[0].n).toBe(0);
  });
});

describe("timeline (required test 6)", () => {
  it("shows associations on person and company timelines and pages 50 at a time across notes, events and associations", async () => {
    const mia = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Mia" })).id;
    await grant("owner-a", tenantA, mia, "newsletter", "granted", "email");
    for (let index = 0; index < 30; index++) {
      await createNote(fixture.db, "owner-a", tenantA, { target: "person", targetId: mia, body: `Note ${index}` });
      await recordAssociation(fixture.db, "member-a", tenantA, { source: "form", kind: "signup", purpose: "newsletter", contactId: mia, companyId: index === 0 ? companyA : undefined, summary: `Signup ${index}` });
    }
    const first = await getTimeline(fixture.db, "viewer-a", tenantA, "person", mia);
    expect(first.items).toHaveLength(50);
    const second = await getTimeline(fixture.db, "viewer-a", tenantA, "person", mia, first.nextCursor);
    const all = [...first.items, ...second.items];
    expect(second.nextCursor).toBeNull();
    expect(all).toHaveLength(62); // 30 notes, 30 associations, contact.create, contact.consent_record
    expect(new Set(all.map((item) => item.id)).size).toBe(62);
    expect(all.filter((item) => item.kind === "association")).toHaveLength(30);
    expect(all.filter((item) => item.kind === "note")).toHaveLength(30);
    expect(all[0]).toMatchObject({ kind: "association", source: "form", activity: "signup", purpose: "newsletter", summary: "Signup 29", removed: false, redacted: false });
    // Newest first, by ledger time and id: strictly ordered with no repeats across the page boundary.
    const stamps = all.map((item) => item.createdAt.getTime());
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
    const company = (await getTimeline(fixture.db, "viewer-a", tenantA, "company", companyA)).items.filter((item) => item.kind === "association");
    expect(company.some((item) => item.kind === "association" && item.person?.id === mia && item.summary === "Signup 0")).toBe(true);
    await expect(later(() => getTimeline(fixture.db, "viewer-a", tenantA, "person", mia, "garbage"))).rejects.toMatchObject({ status: 400 });
    await expect(getTimeline(fixture.db, "viewer-a", tenantA, "person", "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ status: 404 });
  });
});
