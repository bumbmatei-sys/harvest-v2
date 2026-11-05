import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { crmFieldDefinitions, crmFieldValues, crmSavedViews, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createContact, eraseContact, getContact, listContacts, recordConsent } from "../../src/server/contacts";
import { createCompany, listCompanies } from "../../src/server/companies";
import { createFieldDefinition, listFieldDefinitions, patchRecordFields, updateFieldDefinition } from "../../src/server/crm-fields";
import { createView, deleteView, findView, listViews, updateView } from "../../src/server/crm-views";
import { withTenant } from "../../src/server/tenancy";
import { fullState, serializeFilter, type Filter } from "../../src/lib/crm-fields";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenantA: string, tenantB: string, personA: string, personA2: string, personB: string, companyA: string, companyB: string;
const later = (fn: () => unknown) => Promise.resolve().then(fn);
const f = (filter: Filter) => serializeFilter(filter);
type Field = Awaited<ReturnType<typeof createFieldDefinition>>;
const fields: Record<string, Field> = {};

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "admin-a", "member-a", "member-a2", "viewer-a", "owner-b"].map((id) => ({ id, name: `Synthetic ${id}`, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "Fields A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "Fields B")).tenantId;
  for (const [email, role] of [["admin-a", "admin"], ["member-a", "member"], ["member-a2", "member"], ["viewer-a", "viewer"]] as const) await putMember(fixture.db, "owner-a", tenantA, `${email}@example.test`, role);
  personA = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Ruth", email: "ruth@example.test" })).id;
  personA2 = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Boaz" })).id;
  personB = (await createContact(fixture.db, "owner-b", tenantB, { name: "Synthetic Naomi" })).id;
  companyA = (await createCompany(fixture.db, "owner-a", tenantA, { name: "Bethlehem Fields" })).id;
  companyB = (await createCompany(fixture.db, "owner-b", tenantB, { name: "Moab Trust" })).id;
});
afterAll(async () => { await fixture?.close(); });

describe("CRM-03 schema and RLS", () => {
  it("forces RLS on every new table and shows nothing without tenant context", async () => {
    const { rows } = await fixture.admin.query("select relname, relforcerowsecurity from pg_class where relname in ('crm_field_definitions','crm_field_values','crm_saved_views') order by relname");
    expect(rows.map((row) => [row.relname, row.relforcerowsecurity])).toEqual([["crm_field_definitions", true], ["crm_field_values", true], ["crm_saved_views", true]]);
    for (const table of [crmFieldDefinitions, crmFieldValues, crmSavedViews]) expect(await fixture.db.select().from(table)).toEqual([]);
  });
});

describe("field definitions", () => {
  it("creates every supported type with stable keys and rejects unknown types", async () => {
    fields.church = await createFieldDefinition(fixture.db, "owner-a", tenantA, { objectType: "person", label: "Home church", type: "text" });
    expect(fields.church.key).toBe("home_church");
    fields.gifts = await createFieldDefinition(fixture.db, "admin-a", tenantA, { objectType: "person", label: "Gifts", type: "number" });
    fields.joined = await createFieldDefinition(fixture.db, "owner-a", tenantA, { objectType: "person", label: "Joined", type: "date" });
    fields.volunteer = await createFieldDefinition(fixture.db, "owner-a", tenantA, { objectType: "person", label: "Volunteer", type: "boolean", required: true });
    fields.stage = await createFieldDefinition(fixture.db, "owner-a", tenantA, { objectType: "person", label: "Stage", type: "select", options: [{ value: "visitor", label: "Visitor" }, { value: "member", label: "Member" }] });
    fields.interests = await createFieldDefinition(fixture.db, "owner-a", tenantA, { objectType: "person", label: "Interests", type: "multi_select", options: [{ value: "music", label: "Music" }, { value: "youth", label: "Youth" }, { value: "prayer", label: "Prayer" }] });
    fields.mentor = await createFieldDefinition(fixture.db, "owner-a", tenantA, { objectType: "person", label: "Mentor", type: "relation", relationTarget: "person" });
    fields.partner = await createFieldDefinition(fixture.db, "owner-a", tenantA, { objectType: "person", label: "Partner org", type: "relation", relationTarget: "company" });
    fields.contact = await createFieldDefinition(fixture.db, "owner-a", tenantA, { objectType: "company", label: "Main contact", type: "relation", relationTarget: "person" });
    for (const bad of [{ objectType: "person", label: "Bad", type: "formula" }, { objectType: "person", label: "No options", type: "select" }, { objectType: "person", label: "No target", type: "relation" },
      { objectType: "person", label: "Bad key", key: "Bad Key", type: "text" }, { objectType: "deal", label: "Deal", type: "text" }]) {
      await expect(later(() => createFieldDefinition(fixture.db, "owner-a", tenantA, bad as never))).rejects.toThrow();
    }
    await expect(createFieldDefinition(fixture.db, "owner-a", tenantA, { objectType: "person", label: "Home church!", type: "text" })).rejects.toMatchObject({ status: 409 });
    // The same key is independent in another tenant and on the other object type.
    expect((await createFieldDefinition(fixture.db, "owner-b", tenantB, { objectType: "person", label: "Home church", type: "text" })).key).toBe("home_church");
    expect((await createFieldDefinition(fixture.db, "owner-a", tenantA, { objectType: "company", label: "Home church", type: "text" })).key).toBe("home_church");
  });
  it("lets only owners and admins change definitions", async () => {
    for (const user of ["member-a", "viewer-a"]) {
      await expect(createFieldDefinition(fixture.db, user, tenantA, { objectType: "person", label: "Denied", type: "text" })).rejects.toMatchObject({ status: 403 });
      await expect(updateFieldDefinition(fixture.db, user, tenantA, fields.church.id, { label: "Denied", version: 1 })).rejects.toMatchObject({ status: 403 });
    }
    expect((await listFieldDefinitions(fixture.db, "viewer-a", tenantA, "person")).length).toBe(8);
  });
  it("keeps key and type immutable and checks options in SQL", async () => {
    await expect(withTenant(fixture.db, "owner-a", tenantA, "crm:fields_write", (tx) => tx.execute(sql`update crm_field_definitions set key = 'renamed'`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(withTenant(fixture.db, "owner-a", tenantA, "crm:fields_write", (tx) => tx.execute(sql`update crm_field_definitions set type = 'number'`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(withTenant(fixture.db, "owner-a", tenantA, "crm:fields_write", (tx) => tx.execute(sql`update crm_field_definitions set options = '[{"value":"Bad Value","label":"x"}]' where id = ${fields.stage.id}`))).rejects.toThrow();
    await expect(fixture.pool.query("delete from crm_field_definitions")).rejects.toThrow(/permission denied/);
  });
  it("updates with optimistic versions, archives and restores", async () => {
    const updated = await updateFieldDefinition(fixture.db, "admin-a", tenantA, fields.church.id, { label: "Home church name", version: fields.church.version });
    expect(updated).toMatchObject({ label: "Home church name", key: "home_church", version: 2 });
    await expect(updateFieldDefinition(fixture.db, "admin-a", tenantA, fields.church.id, { label: "Stale", version: 1 })).rejects.toMatchObject({ status: 409 });
    const archived = await updateFieldDefinition(fixture.db, "owner-a", tenantA, fields.church.id, { archived: true, version: 2 });
    expect(archived.archivedAt).not.toBeNull();
    fields.church = await updateFieldDefinition(fixture.db, "owner-a", tenantA, fields.church.id, { archived: false, version: 3 });
    expect(fields.church.archivedAt).toBeNull();
    await expect(updateFieldDefinition(fixture.db, "owner-a", tenantA, fields.church.id, { options: [{ value: "x", label: "X" }], version: fields.church.version })).rejects.toMatchObject({ status: 400 });
  });
});

describe("field values", () => {
  it("validates every type and bumps the record version like built-in fields", async () => {
    let version = (await getContact(fixture.db, "member-a", tenantA, personA)).version;
    const result = await patchRecordFields(fixture.db, "member-a", tenantA, "person", personA, { version, values: {
      home_church: "Grace Chapel", gifts: 1250.5, joined: "2024-03-01", volunteer: true, stage: "member", interests: ["music", "prayer"], mentor: personA2, partner_org: companyA,
    } });
    expect(result.version).toBe(version + 1);
    version = result.version;
    const listed = await listContacts(fixture.db, "member-a", tenantA, { q: "ruth" });
    expect(listed.rows[0].custom).toEqual({ home_church: "Grace Chapel", gifts: 1250.5, joined: "2024-03-01", volunteer: true, stage: "member", interests: ["music", "prayer"], mentor: personA2, partner_org: companyA });
    expect(listed.related[personA2]).toBe("Synthetic Boaz");
    for (const values of [{ stage: "elder" }, { joined: "2024-02-30" }, { gifts: "12" }, { interests: ["music", "music"] }, { volunteer: "yes" }, { home_church: "x".repeat(501) }, { unknown_field: "x" }]) {
      await expect(patchRecordFields(fixture.db, "member-a", tenantA, "person", personA, { version, values: values as never })).rejects.toMatchObject({ status: expect.any(Number) });
    }
    await expect(patchRecordFields(fixture.db, "member-a", tenantA, "person", personA, { version: version - 1, values: { gifts: 1 } })).rejects.toMatchObject({ status: 409, details: { reason: "stale" } });
    await expect(patchRecordFields(fixture.db, "member-a", tenantA, "person", personA, { version, values: { volunteer: null } })).rejects.toMatchObject({ status: 400 });
    expect((await patchRecordFields(fixture.db, "member-a", tenantA, "person", personA, { version, values: { gifts: null } })).version).toBe(version + 1);
    expect((await patchRecordFields(fixture.db, "member-a", tenantA, "person", personA, { version: version + 1, values: { home_church: "Grace Chapel" } })).version).toBe(version + 1);
  });
  it("denies viewers and archived fields, and audits field names only", async () => {
    const { version } = await getContact(fixture.db, "owner-a", tenantA, personA);
    await expect(patchRecordFields(fixture.db, "viewer-a", tenantA, "person", personA, { version, values: { gifts: 5 } })).rejects.toMatchObject({ status: 403 });
    const archived = await updateFieldDefinition(fixture.db, "owner-a", tenantA, fields.gifts.id, { archived: true, version: fields.gifts.version });
    await expect(patchRecordFields(fixture.db, "member-a", tenantA, "person", personA, { version, values: { gifts: 5 } })).rejects.toMatchObject({ status: 409 });
    fields.gifts = await updateFieldDefinition(fixture.db, "owner-a", tenantA, fields.gifts.id, { archived: false, version: archived.version });
    const { rows } = await fixture.admin.query("select metadata from audit_logs where tenant_id = $1 and action = 'contact.update' and target_id = $2", [tenantA, personA]);
    expect(rows.some((row) => row.metadata.fields?.includes("cf:home_church"))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("Grace Chapel");
  });
  it("refuses removing an option that is still used", async () => {
    await expect(updateFieldDefinition(fixture.db, "owner-a", tenantA, fields.stage.id, { options: [{ value: "visitor", label: "Visitor" }], version: fields.stage.version })).rejects.toMatchObject({ status: 409 });
    fields.stage = await updateFieldDefinition(fixture.db, "owner-a", tenantA, fields.stage.id, { options: [{ value: "visitor", label: "Guest" }, { value: "member", label: "Member" }, { value: "leader", label: "Leader" }], version: fields.stage.version });
    expect(fields.stage.options.map((option) => option.label)).toEqual(["Guest", "Member", "Leader"]);
  });
  it("rejects wrong types and foreign references in SQL even without the service", async () => {
    const insert = (values: Record<string, unknown>) => withTenant(fixture.db, "owner-a", tenantA, "contacts:write", (tx) => tx.insert(crmFieldValues).values({ tenantId: tenantA, objectType: "person", contactId: personA2, updatedBy: "owner-a", ...values } as never));
    // Positive control: the same path accepts a well-typed value, so the rejections below are about the data.
    await insert({ fieldId: fields.joined.id, valueDate: "2023-05-05" });
    await withTenant(fixture.db, "owner-a", tenantA, "contacts:write", (tx) => tx.delete(crmFieldValues).where(and(eq(crmFieldValues.fieldId, fields.joined.id), eq(crmFieldValues.contactId, personA2))));
    await expect(insert({ fieldId: fields.gifts.id, valueText: "not a number" })).rejects.toMatchObject({ cause: { message: expect.stringMatching(/does not match field type/) } });
    await expect(insert({ fieldId: fields.stage.id, valueOptions: ["elder"] })).rejects.toMatchObject({ cause: { message: expect.stringMatching(/not an allowed option/) } });
    await expect(insert({ fieldId: fields.mentor.id, relationContactId: personB })).rejects.toThrow();
    await expect(insert({ fieldId: fields.gifts.id, valueNumber: 1, updatedBy: "owner-b" })).rejects.toMatchObject({ cause: { message: expect.stringMatching(/provenance/) } });
    await expect(insert({ fieldId: fields.contact.id, relationContactId: personA })).rejects.toThrow();
    await expect(withTenant(fixture.db, "owner-a", tenantA, "contacts:write", (tx) => tx.insert(crmFieldValues).values({ tenantId: tenantB, fieldId: fields.gifts.id, objectType: "person", contactId: personB, valueNumber: 1, updatedBy: "owner-a" }))).rejects.toThrow();
  });
});

describe("two-tenant isolation in both directions", () => {
  it("never exposes or accepts another tenant's records, fields or views", async () => {
    const versionB = (await getContact(fixture.db, "owner-b", tenantB, personB)).version;
    expect((await listFieldDefinitions(fixture.db, "owner-b", tenantB, "person")).map((field) => field.key)).toEqual(["home_church"]);
    await expect(patchRecordFields(fixture.db, "owner-a", tenantA, "person", personB, { version: versionB, values: { home_church: "x" } })).rejects.toMatchObject({ status: 404 });
    await expect(patchRecordFields(fixture.db, "owner-b", tenantB, "person", personA, { version: 1, values: { home_church: "x" } })).rejects.toMatchObject({ status: 404 });
    const { version } = await getContact(fixture.db, "owner-a", tenantA, personA);
    await expect(patchRecordFields(fixture.db, "owner-a", tenantA, "person", personA, { version, values: { mentor: personB } })).rejects.toMatchObject({ status: 404 });
    await expect(patchRecordFields(fixture.db, "owner-a", tenantA, "person", personA, { version, values: { partner_org: companyB } })).rejects.toMatchObject({ status: 404 });
    await expect(updateFieldDefinition(fixture.db, "owner-b", tenantB, fields.stage.id, { label: "x", version: 1 })).rejects.toMatchObject({ status: 404 });
    const viewA = await createView(fixture.db, "owner-a", tenantA, { objectType: "person", name: "A shared", shared: true, state: fullState({}) });
    expect(await findView(fixture.db, "owner-b", tenantB, "person", viewA.id)).toBeNull();
    await expect(updateView(fixture.db, "owner-b", tenantB, "person", viewA.id, { name: "x", version: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(deleteView(fixture.db, "owner-b", tenantB, "person", viewA.id)).rejects.toMatchObject({ status: 404 });
    await withTenant(fixture.db, "owner-b", tenantB, "contacts:read", async (tx) => {
      expect(await tx.select().from(crmSavedViews)).toEqual([]);
      expect((await tx.select().from(crmFieldDefinitions)).every((row) => row.tenantId === tenantB)).toBe(true);
      expect(await tx.select().from(crmFieldValues).where(eq(crmFieldValues.tenantId, tenantA))).toEqual([]);
    });
    // A filter naming another tenant's record simply matches nothing.
    expect((await listContacts(fixture.db, "owner-a", tenantA, { f: f({ field: "cf:mentor", op: "is", value: personB }) })).total).toBe(0);
    expect((await listContacts(fixture.db, "owner-b", tenantB, { f: f({ field: "company", op: "is", value: companyA }) })).total).toBe(0);
    await deleteView(fixture.db, "owner-a", tenantA, "person", viewA.id);
  });
});

describe("filters, sorts and columns", () => {
  it("enforces every operand family on the server", async () => {
    const ids = async (...filters: Filter[]) => (await listContacts(fixture.db, "member-a", tenantA, { f: filters.map(f) })).rows.map((row) => row.id).sort();
    expect(await ids({ field: "cf:home_church", op: "contains", value: "grace" })).toEqual([personA]);
    expect(await ids({ field: "cf:home_church", op: "not_contains", value: "grace" })).toEqual([personA2]);
    expect(await ids({ field: "cf:home_church", op: "is_empty", value: null })).toEqual([personA2]);
    expect(await ids({ field: "cf:joined", op: "after", value: "2024-01-01" })).toEqual([personA]);
    expect(await ids({ field: "cf:joined", op: "before", value: "2024-01-01" })).toEqual([]);
    expect(await ids({ field: "cf:volunteer", op: "is", value: "true" })).toEqual([personA]);
    expect(await ids({ field: "cf:stage", op: "any_of", value: ["member", "leader"] })).toEqual([personA]);
    expect(await ids({ field: "cf:stage", op: "none_of", value: ["member"] })).toEqual([personA2]);
    expect(await ids({ field: "cf:interests", op: "any_of", value: ["youth", "prayer"] })).toEqual([personA]);
    expect(await ids({ field: "cf:mentor", op: "is", value: personA2 })).toEqual([personA]);
    expect(await ids({ field: "cf:mentor", op: "is_not_empty", value: null }, { field: "email", op: "contains", value: "ruth" })).toEqual([personA]);
    expect(await ids({ field: "name", op: "is", value: "synthetic boaz" })).toEqual([personA2]);
    await patchRecordFields(fixture.db, "member-a", tenantA, "person", personA2, { version: (await getContact(fixture.db, "member-a", tenantA, personA2)).version, values: { gifts: 10 } });
    expect(await ids({ field: "cf:gifts", op: "gte", value: "10" })).toEqual([personA2]);
    expect(await ids({ field: "cf:gifts", op: "is_empty", value: null })).toEqual([personA]);
  });
  it("rejects unknown fields, operands, values and archived fields as a whole", async () => {
    for (const filter of ["cf:nope~is~x", "cf:gifts~contains~x", "cf:gifts~gte~ten", "cf:stage~any_of~elder", "cf:joined~is~2024-13-01", "name~gte~1", "email~is_empty~x", "cf:mentor~is~not-a-uuid", "nonsense"]) {
      await expect(later(() => listContacts(fixture.db, "member-a", tenantA, { f: filter }))).rejects.toMatchObject({ status: 400 });
    }
    await expect(later(() => listContacts(fixture.db, "member-a", tenantA, { sort: "cf:interests" }))).rejects.toMatchObject({ status: 400 });
    const archived = await updateFieldDefinition(fixture.db, "owner-a", tenantA, fields.joined.id, { archived: true, version: fields.joined.version });
    await expect(listContacts(fixture.db, "member-a", tenantA, { f: "cf:joined~is_empty~" })).rejects.toMatchObject({ status: 400 });
    fields.joined = await updateFieldDefinition(fixture.db, "owner-a", tenantA, fields.joined.id, { archived: false, version: archived.version });
  });
  it("sorts by custom fields with empty values last", async () => {
    expect((await listContacts(fixture.db, "member-a", tenantA, { sort: "-cf:gifts" })).rows.map((row) => row.id)).toEqual([personA2, personA]);
    expect((await listContacts(fixture.db, "member-a", tenantA, { sort: "cf:home_church" })).rows.map((row) => row.id)).toEqual([personA, personA2]);
  });
  it("keeps the marketing filter, system views and badge on one rule", async () => {
    await recordConsent(fixture.db, "owner-a", tenantA, personA, { purpose: "marketing", noticeVersion: "notice-v1", channel: "email", status: "granted", source: "Synthetic", evidence: "Synthetic" });
    const subscribers = await listContacts(fixture.db, "member-a", tenantA, { f: "marketing~any_of~granted" });
    expect(subscribers.rows.map((row) => [row.id, row.marketingEmail])).toEqual([[personA, "granted"]]);
    expect((await listContacts(fixture.db, "member-a", tenantA, { marketing: "none" })).rows.map((row) => row.id)).toEqual([personA2]);
    const views = await listViews(fixture.db, "viewer-a", tenantA, "person");
    expect(views.filter((view) => view.kind === "system").map((view) => view.id)).toEqual(["system:all-people", "system:email-subscribers", "system:unsubscribed", "system:no-email-decision", "system:no-company"]);
  });
  it("company lists filter, sort and expose custom values too", async () => {
    await patchRecordFields(fixture.db, "member-a", tenantA, "company", companyA, { version: 1, values: { main_contact: personA, home_church: "Grace" } });
    const listed = await listCompanies(fixture.db, "member-a", tenantA, { f: "cf:main_contact~is~" + personA });
    expect(listed.rows.map((row) => [row.id, row.custom.home_church])).toEqual([[companyA, "Grace"]]);
    expect((await listCompanies(fixture.db, "member-a", tenantA, { f: "people~gte~1" })).total).toBe(0);
    expect((await listCompanies(fixture.db, "member-a", tenantA, { people: "none", domain: "without" })).total).toBe(1);
  });
});

describe("saved views", () => {
  it("round-trips filters, columns, sort and density, and validates state on save", async () => {
    const state = fullState({ q: "ruth", sort: "-cf:gifts", filters: [{ field: "cf:stage", op: "any_of", value: ["member"] }], columns: ["email", "cf:stage", "cf:interests"], density: "compact" });
    const view = await createView(fixture.db, "member-a", tenantA, { objectType: "person", name: "Members", state });
    expect(view).toMatchObject({ kind: "personal", state });
    expect((await findView(fixture.db, "member-a", tenantA, "person", view.id))?.state).toEqual(state);
    await expect(createView(fixture.db, "member-a", tenantA, { objectType: "person", name: "Bad", state: fullState({ filters: [{ field: "cf:missing", op: "is", value: "x" }] }) })).rejects.toMatchObject({ status: 400 });
    const renamed = await updateView(fixture.db, "member-a", tenantA, "person", view.id, { name: "Members only", version: view.version });
    await expect(updateView(fixture.db, "member-a", tenantA, "person", view.id, { name: "Stale", version: view.version })).rejects.toMatchObject({ status: 409 });
    await deleteView(fixture.db, "member-a", tenantA, "person", renamed.id);
    expect(await findView(fixture.db, "member-a", tenantA, "person", renamed.id)).toBeNull();
  });
  it("keeps personal views private and lets writers share workspace views", async () => {
    const mine = await createView(fixture.db, "member-a", tenantA, { objectType: "person", name: "Mine", state: fullState({}) });
    const shared = await createView(fixture.db, "member-a", tenantA, { objectType: "person", name: "Shared", shared: true, state: fullState({}) });
    expect((await listViews(fixture.db, "member-a2", tenantA, "person")).map((view) => view.name)).toContain("Shared");
    expect((await listViews(fixture.db, "member-a2", tenantA, "person")).map((view) => view.name)).not.toContain("Mine");
    expect(await findView(fixture.db, "member-a2", tenantA, "person", mine.id)).toBeNull();
    await expect(updateView(fixture.db, "member-a2", tenantA, "person", mine.id, { name: "Stolen", version: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(deleteView(fixture.db, "owner-a", tenantA, "person", mine.id)).rejects.toMatchObject({ status: 404 });
    // RLS hides another member's personal view even from a raw query in the right tenant.
    await withTenant(fixture.db, "member-a2", tenantA, "contacts:read", async (tx) => {
      expect((await tx.select().from(crmSavedViews)).map((row) => row.id)).toEqual([shared.id]);
      expect(await tx.update(crmSavedViews).set({ name: "Hijack" }).where(eq(crmSavedViews.id, mine.id)).returning()).toEqual([]);
    });
    await expect(withTenant(fixture.db, "member-a2", tenantA, "contacts:write", (tx) => tx.insert(crmSavedViews).values({ tenantId: tenantA, objectType: "person", name: "Forged", ownerUserId: "member-a", state: {}, createdBy: "member-a2" }))).rejects.toThrow();
    expect((await updateView(fixture.db, "member-a2", tenantA, "person", shared.id, { name: "Shared edited", version: shared.version })).name).toBe("Shared edited");
    await expect(createView(fixture.db, "viewer-a", tenantA, { objectType: "person", name: "Denied", state: fullState({}) })).rejects.toMatchObject({ status: 403 });
    await expect(deleteView(fixture.db, "viewer-a", tenantA, "person", shared.id)).rejects.toMatchObject({ status: 403 });
    await expect(updateView(fixture.db, "member-a", tenantA, "person", "system:all-people", { name: "x", version: 1 })).rejects.toMatchObject({ status: 403 });
    expect(await findView(fixture.db, "viewer-a", tenantA, "person", "system:unknown")).toBeNull();
    expect(await findView(fixture.db, "viewer-a", tenantA, "company", shared.id)).toBeNull();
  });
});

describe("erasure", () => {
  it("removes the person's values, relation values pointing at them and view filters naming them", async () => {
    const view = await createView(fixture.db, "member-a", tenantA, { objectType: "person", name: "Mentored by Boaz", shared: true, state: fullState({ filters: [{ field: "cf:mentor", op: "is", value: personA2 }, { field: "cf:stage", op: "any_of", value: ["member"] }] }) });
    await eraseContact(fixture.db, "owner-a", tenantA, personA2);
    const { rows } = await fixture.admin.query("select count(*)::int as n from crm_field_values where tenant_id = $1 and (contact_id = $2 or relation_contact_id = $2)", [tenantA, personA2]);
    expect(rows[0].n).toBe(0);
    expect((await listContacts(fixture.db, "member-a", tenantA, { q: "ruth" })).rows[0].custom.mentor).toBeUndefined();
    const after = await findView(fixture.db, "member-a", tenantA, "person", view.id);
    expect(after?.state.filters).toEqual([{ field: "cf:stage", op: "any_of", value: ["member"] }]);
    const dump = JSON.stringify((await fixture.admin.query("select * from crm_saved_views")).rows) + JSON.stringify((await fixture.admin.query("select * from crm_field_values")).rows);
    expect(dump).not.toContain(personA2);
  });
});
