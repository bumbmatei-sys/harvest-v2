import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { testDatabase } from "../database";
import { crmImportRows, crmImports, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createContact, eraseContact, getContact, linkCompany, listContacts, patchContact, recordConsent } from "../../src/server/contacts";
import { createCompany, listCompanies } from "../../src/server/companies";
import { createDeal, listPipelines } from "../../src/server/crm-deals";
import { createNote, createTask } from "../../src/server/crm-tasks";
import { createFieldDefinition, patchRecordFields } from "../../src/server/crm-fields";
import { commitImport, createImport, getImport, importReport, listImports, previewImport, rollbackImport, updateImport } from "../../src/server/crm-imports";
import { exportCount, exportRecords } from "../../src/server/crm-export";
import { mergeContacts, previewMerge } from "../../src/server/crm-merge";
import { withTenant } from "../../src/server/tenancy";
import { parseCsvRecords } from "../../src/lib/csv";

let fixture: Awaited<ReturnType<typeof testDatabase>>, tenantA: string, tenantB: string;
const later = (fn: () => unknown) => Promise.resolve().then(fn);
const csv = (rows: string[][]) => rows.map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, "\"\"")}"` : cell)).join(",")).join("\n");
const consent = { channel: "email", status: "withdrawn", purpose: "marketing", noticeVersion: "notice-v1", source: "Synthetic unsubscribe link", evidence: "Clicked unsubscribe" } as const;

/** Upload, preview and commit to the end, like the wizard does. */
async function runImport(user: string, tenant: string, text: string, options: { entity?: "person" | "company"; onMatch?: "skip" | "fill"; mapping?: (string | null)[] } = {}) {
  let current = await createImport(fixture.db, user, tenant, { entity: options.entity ?? "person", clientKey: randomUUID(), fileName: "synthetic.csv", csv: text });
  if (options.onMatch || options.mapping) current = await updateImport(fixture.db, user, tenant, current.id, { onMatch: options.onMatch, mapping: options.mapping, version: current.version });
  const preview = await previewImport(fixture.db, user, tenant, current.id, { version: current.version });
  let result = await commitImport(fixture.db, user, tenant, current.id), calls = 1;
  while (result.remaining > 0) { result = await commitImport(fixture.db, user, tenant, current.id); calls++; }
  return { id: current.id, preview, result, calls };
}
const rowsOf = async (user: string, tenant: string, id: string) => {
  const all = [];
  for (let page = 1; ; page++) { const { rows } = await getImport(fixture.db, user, tenant, id, { page }); if (!rows.length) break; all.push(...rows); }
  return all;
};

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "admin-a", "member-a", "viewer-a", "owner-b"].map((id) => ({ id, name: `Synthetic ${id}`, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "Imports A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "Imports B")).tenantId;
  for (const [id, role] of [["admin-a", "admin"], ["member-a", "member"], ["viewer-a", "viewer"]] as const) await putMember(fixture.db, "owner-a", tenantA, `${id}@example.test`, role);
});
afterAll(async () => { await fixture?.close(); });

describe("CRM-06 schema and RLS", () => {
  it("forces RLS on the import tables, grants no DELETE and shows nothing without tenant context", async () => {
    const { rows } = await fixture.admin.query("select relname, relforcerowsecurity from pg_class where relname in ('crm_imports','crm_import_rows') order by relname");
    expect(rows).toEqual([{ relname: "crm_import_rows", relforcerowsecurity: true }, { relname: "crm_imports", relforcerowsecurity: true }]);
    const grants = await fixture.admin.query("select table_name, privilege_type from information_schema.role_table_grants where grantee = 'harvest_app' and table_name in ('crm_imports','crm_import_rows') and privilege_type = 'DELETE'");
    expect(grants.rows).toEqual([]);
    expect(await fixture.db.select().from(crmImports)).toEqual([]);
  });
});

describe("import row erasure", () => {
  it("scrubs draft and preview cells containing identifiers and scrubs a merged person before moving identifiers", async () => {
    const person = await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Erasure", email: "erase-draft@example.test", phone: "+4915199990004" });
    const draft = await createImport(fixture.db, "owner-a", tenantA, { entity: "person", clientKey: randomUUID(), fileName: "draft.csv", csv: csv([["Name", "Email", "Phone"], ["Synthetic Erasure", "erase-draft@example.test", ""], ["Phone only", "", "+49 (151) 9999-0004"]]) });
    const notes = await createImport(fixture.db, "owner-a", tenantA, { entity: "person", clientKey: randomUUID(), fileName: "notes.csv", csv: csv([["Name", "Unmapped"], ["Someone else", "Contact ERASE-DRAFT@example.test"]]) });
    await previewImport(fixture.db, "owner-a", tenantA, notes.id, { version: notes.version });
    await eraseContact(fixture.db, "owner-a", tenantA, person.id);
    const erased = await fixture.admin.query("select raw, match_keys from crm_import_rows where import_id = any($1::uuid[]) order by import_id", [[draft.id, notes.id]]);
    expect(erased.rows).toEqual([{ raw: [], match_keys: [] }, { raw: [], match_keys: [] }, { raw: [], match_keys: [] }]);

    const kept = await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Survivor" });
    const loser = await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Loser", email: "loser-scrub@example.test" });
    const imported = await runImport("owner-a", tenantA, csv([["Name", "Email"], ["Synthetic Loser", "loser-scrub@example.test"]]));
    await mergeContacts(fixture.db, "owner-a", tenantA, kept.id, { sourceId: loser.id, targetVersion: kept.version, sourceVersion: loser.version });
    const merged = await fixture.admin.query("select raw, match_keys, contact_id from crm_import_rows where import_id = $1", [imported.id]);
    expect(merged.rows).toEqual([{ raw: [], match_keys: [], contact_id: null }]);
  });

  it("preserves unrelated rows when identifiers are only substrings", async () => {
    const phone = await createContact(fixture.db, "owner-a", tenantA, { name: "Phone target", phone: "+4915199990004" });
    const email = await createContact(fixture.db, "owner-a", tenantA, { name: "Email target", email: "ed@example.test" });
    const handle = await createContact(fixture.db, "owner-a", tenantA, { name: "Handle target", social: "a" });
    const imported = await runImport("owner-a", tenantA, csv([["Name", "Email", "Notes"], ["Synthetic Ada", "fred@example.test", "Needed a volunteer; ref 149151999900041; ed@example.test.evil"]]));
    const before = (await fixture.admin.query("select raw, match_keys, contact_id from crm_import_rows where import_id = $1", [imported.id])).rows;
    expect(before[0].contact_id).toBeTruthy();
    for (const person of [phone, email, handle]) await eraseContact(fixture.db, "owner-a", tenantA, person.id);
    const after = (await fixture.admin.query("select raw, match_keys, contact_id from crm_import_rows where import_id = $1", [imported.id])).rows;
    expect(after).toEqual(before);
  });

  it("keeps another imported person's link when scrubbing a mention so rollback removes them", async () => {
    const mentioned = await createContact(fixture.db, "owner-a", tenantA, { name: "Mentioned person", email: "mentioned-probe@example.test" });
    const imported = await runImport("owner-a", tenantA, csv([["Name", "Email", "Notes"], ["Synthetic Collateral", "collateral-probe@example.test", "email them at mentioned-probe@example.test"]]));
    const before = (await fixture.admin.query("select contact_id, match_keys from crm_import_rows where import_id = $1", [imported.id])).rows[0];
    expect(before.contact_id).toBeTruthy();
    await eraseContact(fixture.db, "owner-a", tenantA, mentioned.id);
    const after = (await fixture.admin.query("select raw, match_keys, contact_id from crm_import_rows where import_id = $1", [imported.id])).rows[0];
    expect(after).toEqual({ raw: [], match_keys: before.match_keys, contact_id: before.contact_id });
    await expect(rollbackImport(fixture.db, "owner-a", tenantA, imported.id)).resolves.toMatchObject({ result: { removed: 1 } });
    expect((await fixture.admin.query("select count(*)::int as n from contacts where id = $1", [before.contact_id])).rows[0].n).toBe(0);
  });

  it("fails closed with an empty tenant setting even when import rows exist", async () => {
    const item = await createImport(fixture.db, "owner-a", tenantA, { entity: "person", clientKey: randomUUID(), fileName: "context.csv", csv: "Name\nContext person" });
    const client = await fixture.pool.connect();
    try {
      await client.query("select set_config('app.user_id', 'owner-a', false), set_config('app.tenant_id', '', false)");
      expect((await client.query("select * from crm_import_rows")).rows).toEqual([]);
      for (const [query, params] of [
        ["insert into crm_import_rows (tenant_id, import_id, row_number, raw) values ($1,$2,99,'[]')", [tenantA, item.id]],
        ["select public.rollback_crm_import($1,$2)", [tenantA, item.id]],
        ["select public.merge_contacts($1,$2,$3)", [tenantA, randomUUID(), randomUUID()]],
      ] as [string, string[]][]) await expect(client.query(query, params)).rejects.toMatchObject({ code: "42501" });
    } finally { await client.query("reset app.user_id; reset app.tenant_id"); client.release(); }
  });
});

describe("upload and mapping", () => {
  it("suggests a deterministic mapping, is idempotent per client key and refuses broken files", async () => {
    const clientKey = randomUUID(), text = csv([["Full name", "E-mail", "Mobile", "Organisation", "Shoe size"], ["Synthetic Ada", "ada@example.test", "+4915112345678", "", "42"]]);
    const first = await createImport(fixture.db, "member-a", tenantA, { entity: "person", clientKey, fileName: "people.csv", csv: text });
    expect(first.mapping).toEqual(["name", "email", "phone", "company", null]);
    const again = await createImport(fixture.db, "member-a", tenantA, { entity: "person", clientKey, fileName: "people.csv", csv: text });
    expect(again.id).toBe(first.id);
    expect((await fixture.admin.query("select count(*)::int as n from crm_import_rows where import_id = $1", [first.id])).rows[0].n).toBe(1);
    await expect(later(() => createImport(fixture.db, "member-a", tenantA, { entity: "person", clientKey: randomUUID(), fileName: "x.csv", csv: "Name\n\"unterminated" }))).rejects.toMatchObject({ status: 400, details: { reason: "unterminated_quote" } });
    await expect(later(() => createImport(fixture.db, "member-a", tenantA, { entity: "person", clientKey: randomUUID(), fileName: "x.csv", csv: "Name,Name\nA,B" }))).rejects.toMatchObject({ status: 400 });
    await expect(later(() => createImport(fixture.db, "member-a", tenantA, { entity: "person", clientKey: randomUUID(), fileName: "x.csv", csv: `Name\n${"A\n".repeat(5001)}` }))).rejects.toMatchObject({ status: 400 });
    await expect(updateImport(fixture.db, "member-a", tenantA, first.id, { mapping: [null, "email", null, null, null], version: first.version })).resolves.toMatchObject({ status: "draft" });
    const saved = (await listImports(fixture.db, "member-a", tenantA)).find((item) => item.id === first.id)!;
    await expect(previewImport(fixture.db, "member-a", tenantA, first.id, { version: saved.version })).rejects.toMatchObject({ status: 400 });
    await expect(updateImport(fixture.db, "member-a", tenantA, first.id, { mapping: ["name", "name", null, null, null], version: saved.version })).resolves.toBeTruthy();
  });

  it("denies viewers every import action and keeps imports inside their workspace, both ways", async () => {
    await expect(createImport(fixture.db, "viewer-a", tenantA, { entity: "person", clientKey: randomUUID(), fileName: "v.csv", csv: "Name\nX" })).rejects.toMatchObject({ status: 403 });
    await expect(listImports(fixture.db, "viewer-a", tenantA)).rejects.toMatchObject({ status: 403 });
    await expect(exportRecords(fixture.db, "viewer-a", tenantA, "person")).rejects.toMatchObject({ status: 403 });
    const a = await createImport(fixture.db, "owner-a", tenantA, { entity: "person", clientKey: randomUUID(), fileName: "a.csv", csv: "Name\nSynthetic A" });
    const b = await createImport(fixture.db, "owner-b", tenantB, { entity: "person", clientKey: randomUUID(), fileName: "b.csv", csv: "Name\nSynthetic B" });
    await expect(getImport(fixture.db, "owner-b", tenantB, a.id)).rejects.toMatchObject({ status: 404 });
    await expect(getImport(fixture.db, "owner-a", tenantA, b.id)).rejects.toMatchObject({ status: 404 });
    await expect(getImport(fixture.db, "owner-b", tenantA, a.id)).rejects.toMatchObject({ status: 403 });
    await expect(previewImport(fixture.db, "owner-b", tenantB, a.id, { version: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(commitImport(fixture.db, "owner-a", tenantA, b.id)).rejects.toMatchObject({ status: 404 });
    await expect(rollbackImport(fixture.db, "owner-b", tenantB, a.id)).rejects.toMatchObject({ status: 404 });
    await withTenant(fixture.db, "owner-b", tenantB, "crm:import", async (tx, tenantId) => {
      expect((await tx.select().from(crmImports)).map((row) => row.id)).toEqual([b.id]);
      expect((await tx.select().from(crmImportRows)).every((row) => row.importId === b.id)).toBe(true);
      expect(await tx.update(crmImports).set({ status: "preview" }).where(eq(crmImports.id, a.id)).returning()).toEqual([]);
      await expect(tx.insert(crmImportRows).values({ tenantId, importId: a.id, rowNumber: 99, raw: ["x"] })).rejects.toThrow();
    });
    await expect(withTenant(fixture.db, "owner-b", tenantB, "crm:import", (tx) => tx.insert(crmImportRows).values({ tenantId: tenantA, importId: a.id, rowNumber: 98, raw: ["x"] }))).rejects.toThrow();
    // The cells are never updatable by the app, even in its own tenant.
    await expect(withTenant(fixture.db, "owner-a", tenantA, "crm:import", (tx) => tx.update(crmImportRows).set({ raw: [] }).where(eq(crmImportRows.importId, a.id)))).rejects.toThrow();
  });
});

describe("preview and commit", () => {
  it("previews without writing, then creates, skips and reports rows deterministically by tenant-unique identifiers only", async () => {
    const company = await createCompany(fixture.db, "owner-a", tenantA, { name: "Synthetic Grace Chapel", domain: "grace.example" });
    const known = await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Known", email: "known@example.test" });
    await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Known Two", email: "known2@example.test" });
    const other = await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Other", phone: "+4915100000001" });
    await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Namesake" });
    const before = (await listContacts(fixture.db, "owner-a", tenantA)).total;
    const text = csv([
      ["Name", "Email", "Phone", "Company", "Title", "Notes"],
      ["Synthetic New", "new@example.test", "", "grace.example", "Elder", "=HYPERLINK(\"x\")"],
      ["Synthetic Known Again", "KNOWN2@example.test", "", "", "", ""],
      ["Synthetic Two Matches", "known@example.test", "+49 151 00000001", "", "", ""],
      ["Synthetic Repeat", "new@example.test", "", "", "", ""],
      ["", "noname@example.test", "", "", "", ""],
      ["Synthetic Bad Email", "not-an-email", "", "", "", ""],
      ["Synthetic Namesake", "", "", "Synthetic Grace Chapel", "", ""],
      ["Synthetic Lost Company", "", "", "Nowhere Fellowship", "", ""],
    ]);
    const created = await createImport(fixture.db, "member-a", tenantA, { entity: "person", clientKey: randomUUID(), fileName: "people.csv", csv: text });
    const previewed = await previewImport(fixture.db, "member-a", tenantA, created.id, { version: created.version });
    expect((await listContacts(fixture.db, "owner-a", tenantA)).total).toBe(before);
    expect(previewed.stats).toEqual({ total: 8, create: 3, skip: 1, conflict: 2, error: 2 });
    const preview = await rowsOf("member-a", tenantA, created.id);
    expect(preview.map((row) => [row.rowNumber, row.action, row.error, row.warning])).toEqual([
      [1, "create", null, null], [2, "skip", null, null], [3, "conflict", "matches_several_records", null], [4, "conflict", "duplicate_in_file", null],
      [5, "error", "missing_name", null], [6, "error", "invalid_email", null], [7, "create", null, "possible_duplicate_name"], [8, "create", null, "company_not_found"],
    ]);
    expect(preview[1].recordName).toBe("Synthetic Known Two");
    expect((await getImport(fixture.db, "member-a", tenantA, created.id, { outcome: "problem" })).total).toBe(4);
    let result = await commitImport(fixture.db, "member-a", tenantA, created.id);
    expect(result).toMatchObject({ status: "completed", remaining: 0, stats: { created: 3, updated: 0, skipped: 1, failed: 4 } });
    // Repeating the commit is a no-op.
    result = await commitImport(fixture.db, "member-a", tenantA, created.id);
    expect((await listContacts(fixture.db, "owner-a", tenantA)).total).toBe(before + 3);
    const newbie = (await listContacts(fixture.db, "owner-a", tenantA, { q: "Synthetic New" })).rows[0];
    expect(newbie.identifiers.map((item) => item.value)).toEqual(["new@example.test"]);
    expect(newbie.companies).toMatchObject([{ companyId: company.id, title: "Elder", isPrimary: true }]);
    expect(newbie.notes).toBe("=HYPERLINK(\"x\")");
    // The two people that the conflicting row named stay separate and unchanged.
    expect((await getContact(fixture.db, "owner-a", tenantA, known.id)).identifiers).toHaveLength(1);
    expect((await getContact(fixture.db, "owner-a", tenantA, other.id)).name).toBe("Synthetic Other");
    const audit = await fixture.admin.query("select action, metadata from audit_logs where tenant_id = $1 and (target_id = $2 or metadata->>'importId' = $2) order by created_at", [tenantA, created.id]);
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(["crm.import.created", "contact.create", "crm.import.completed"]));
    const outbox = await fixture.admin.query("select kind, payload from outbox_events where idempotency_key = $1", [`crm:import:${created.id}:completed`]);
    expect(outbox.rows).toMatchObject([{ kind: "crm.import.completed", payload: { importId: created.id, created: 3, failed: 4 } }]);
    expect(JSON.stringify(outbox.rows)).not.toMatch(/example\.test|Synthetic/);
    // The error report carries the original cells, formula-safe, and the reason for each problem row.
    const report = await importReport(fixture.db, "member-a", tenantA, created.id);
    const lines = parseCsvRecords(report.body.replace(/^﻿/, "")) as string[][];
    expect(lines[0]).toEqual(["Row", "Name", "Email", "Phone", "Company", "Title", "Notes", "Problem"]);
    expect(lines.slice(1).map((line) => line[0])).toEqual(["3", "4", "5", "6"]);
    expect(lines[2][7]).toMatch(/earlier row/);
    const formula = await createImport(fixture.db, "member-a", tenantA, { entity: "person", clientKey: randomUUID(), fileName: "f.csv", csv: csv([["Name", "Email"], ["=1+1", "bad"]]) });
    await previewImport(fixture.db, "member-a", tenantA, formula.id, { version: formula.version });
    await commitImport(fixture.db, "member-a", tenantA, formula.id);
    expect((await importReport(fixture.db, "member-a", tenantA, formula.id)).body).toContain("'=1+1");
  });

  it("fills only empty fields on a match, never touches consent and never clears an opt-out", async () => {
    const person = await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Opted Out", email: "optout@example.test" });
    await recordConsent(fixture.db, "owner-a", tenantA, person.id, consent);
    const { result } = await runImport("member-a", tenantA, csv([["Name", "Email", "Phone", "Notes"], ["Renamed Person", "optout@example.test", "+4915199999999", "Met at the picnic"]]), { onMatch: "fill" });
    expect(result.stats).toMatchObject({ updated: 1, created: 0 });
    const after = await getContact(fixture.db, "owner-a", tenantA, person.id);
    expect(after.name).toBe("Synthetic Opted Out");
    expect(after.notes).toBe("Met at the picnic");
    expect(after.identifiers.map((item) => item.kind).sort()).toEqual(["email", "phone"]);
    expect(after.effectiveConsents).toMatchObject([{ channel: "email", status: "withdrawn" }]);
    expect((await listContacts(fixture.db, "owner-a", tenantA, { f: "marketing~any_of~withdrawn" })).rows.map((row) => row.id)).toContain(person.id);
    // Skip leaves a match alone.
    const skipped = await runImport("member-a", tenantA, csv([["Name", "Email", "Notes"], ["X", "optout@example.test", "Other notes"]]));
    expect(skipped.result.stats).toMatchObject({ skipped: 1, updated: 0 });
    expect((await getContact(fixture.db, "owner-a", tenantA, person.id)).notes).toBe("Met at the picnic");
  });

  it("re-decides each row at commit, so an identifier taken after the preview is never duplicated", async () => {
    const created = await createImport(fixture.db, "member-a", tenantA, { entity: "person", clientKey: randomUUID(), fileName: "race.csv", csv: csv([["Name", "Email"], ["Synthetic Racer", "racer@example.test"]]) });
    await previewImport(fixture.db, "member-a", tenantA, created.id, { version: created.version });
    await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic First", email: "racer@example.test" });
    const result = await commitImport(fixture.db, "member-a", tenantA, created.id);
    expect(result.stats).toMatchObject({ created: 0, skipped: 1 });
    expect((await listContacts(fixture.db, "owner-a", tenantA, { q: "racer@example.test" })).total).toBe(1);
  });

  it("imports companies by domain, fills an empty description and refuses duplicate domains in the file", async () => {
    await createCompany(fixture.db, "owner-a", tenantA, { name: "Synthetic Hope", domain: "hope.example" });
    const { id, result } = await runImport("member-a", tenantA, csv([["Company", "Website", "About"], ["Synthetic Hope Renamed", "https://www.hope.example/about", "A church"], ["Synthetic Peace", "peace.example", ""], ["Synthetic Peace Again", "PEACE.example", ""], ["Synthetic Bad", "not a domain", ""]]), { entity: "company", onMatch: "fill" });
    expect(result.stats).toMatchObject({ created: 1, updated: 1, failed: 2 });
    expect((await rowsOf("member-a", tenantA, id)).map((row) => row.error)).toEqual([null, null, "duplicate_in_file", "invalid_domain"]);
    const hope = (await listCompanies(fixture.db, "owner-a", tenantA, { q: "hope.example" })).rows[0];
    expect(hope).toMatchObject({ name: "Synthetic Hope", description: "A church" });
  });

  it("imports 1,000 rows in five chunks with the same per-row outcome in any workspace", async () => {
    const rows = [["Name", "Email", "Phone"]];
    for (let index = 1; index <= 1000; index++) {
      const email = index % 97 === 0 ? "broken-email" : index % 50 === 0 ? `bulk${index - 1}@example.test` : `bulk${index}@example.test`;
      rows.push([index % 113 === 0 ? "" : `Synthetic Bulk ${index}`, email, index % 131 === 0 ? "12345" : ""]);
    }
    const text = csv(rows);
    const outcomes = [];
    for (const [user, tenant] of [["owner-a", tenantA], ["owner-b", tenantB]] as const) {
      const run = await runImport(user, tenant, text);
      expect(run.calls).toBe(5);
      outcomes.push({ stats: run.result.stats, rows: (await rowsOf(user, tenant, run.id)).map((row) => `${row.rowNumber}:${row.status}:${row.error ?? ""}`) });
    }
    expect(outcomes[0]).toEqual(outcomes[1]);
    const problems = outcomes[0].rows.filter((row) => row.includes(":error:"));
    expect(outcomes[0].stats).toMatchObject({ total: 1000, created: 1000 - problems.length, failed: problems.length });
    expect(problems).toContain("97:error:invalid_email");
    expect(problems).toContain("50:error:duplicate_in_file");
    expect(problems).toContain("113:error:missing_name");
    expect(problems).toContain("131:error:invalid_phone");
    const report = await importReport(fixture.db, "owner-b", tenantB, (await listImports(fixture.db, "owner-b", tenantB))[0].id);
    expect((parseCsvRecords(report.body.replace(/^﻿/, "")) as string[][]).length).toBe(problems.length + 1);
  });
});

describe("rollback", () => {
  it("removes untouched records it created, reverts fills, keeps anything changed since and is final", async () => {
    const matched = await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Matched", email: "matched@example.test" });
    const { id } = await runImport("member-a", tenantA, csv([["Name", "Email", "Phone", "Notes"],
      ["Synthetic Gone", "gone@example.test", "", ""], ["Synthetic Edited", "edited@example.test", "", ""], ["Synthetic Tasked", "tasked@example.test", "", ""],
      ["Synthetic Matched", "matched@example.test", "+4915188888888", "Imported note"]]), { onMatch: "fill" });
    const find = async (q: string) => (await listContacts(fixture.db, "owner-a", tenantA, { q })).rows[0];
    const edited = await find("edited@example.test");
    await patchContact(fixture.db, "owner-a", tenantA, edited.id, { notes: "Changed by a person", version: edited.version });
    await createTask(fixture.db, "owner-a", tenantA, { title: "Call them", contactId: (await find("tasked@example.test")).id });
    await expect(rollbackImport(fixture.db, "viewer-a", tenantA, id)).rejects.toMatchObject({ status: 403 });
    const rolled = await rollbackImport(fixture.db, "member-a", tenantA, id);
    expect(rolled.result).toEqual({ removed: 1, reverted: 1, kept: 2 });
    expect(rolled.status).toBe("rolled_back");
    expect(await find("gone@example.test")).toBeUndefined();
    expect(await find("edited@example.test")).toBeTruthy();
    expect(await find("tasked@example.test")).toBeTruthy();
    const back = await getContact(fixture.db, "owner-a", tenantA, matched.id);
    expect(back).toMatchObject({ notes: "" });
    expect(back.identifiers.map((item) => item.kind)).toEqual(["email"]);
    await expect(rollbackImport(fixture.db, "member-a", tenantA, id)).rejects.toMatchObject({ status: 409 });
    const outbox = await fixture.admin.query("select payload from outbox_events where idempotency_key = $1", [`crm:import:${id}:rolled_back`]);
    expect(outbox.rows[0].payload).toMatchObject({ removed: 1, reverted: 1, kept: 2 });
    // Only the creator (or an owner/admin) may roll an import back.
    const mine = await runImport("owner-a", tenantA, csv([["Name"], ["Synthetic Owner Row"]]));
    await expect(rollbackImport(fixture.db, "member-a", tenantA, mine.id)).rejects.toMatchObject({ status: 403 });
    await expect(rollbackImport(fixture.db, "admin-a", tenantA, mine.id)).resolves.toMatchObject({ result: { removed: 1 } });
  });
});

describe("erasure", () => {
  it("empties import rows about an erased person, including rows that only carried their email", async () => {
    const { id } = await runImport("member-a", tenantA, csv([["Name", "Email", "Phone"], ["Synthetic Private", "private@example.test", ""], ["Synthetic Private Typo", "private@example.test", "bad"]]));
    const person = (await listContacts(fixture.db, "owner-a", tenantA, { q: "private@example.test" })).rows[0];
    await eraseContact(fixture.db, "owner-a", tenantA, person.id);
    const rows = await fixture.admin.query("select raw, match_keys, contact_id from crm_import_rows where import_id = $1 order by row_number", [id]);
    expect(rows.rows).toEqual([{ raw: [], match_keys: [], contact_id: null }, { raw: [], match_keys: [], contact_id: null }]);
    expect(JSON.stringify((await getImport(fixture.db, "member-a", tenantA, id)).rows)).not.toContain("private@example.test");
  });
});

describe("export", () => {
  it("exports exactly the filtered list, formula-safe, without erased people, notes only for owners and admins", async () => {
    const tenant = (await createWorkspace(fixture.db, "owner-a", "Export A")).tenantId;
    await putMember(fixture.db, "owner-a", tenant, "member-a@example.test", "member");
    const church = await createCompany(fixture.db, "owner-a", tenant, { name: "Synthetic Export Chapel", domain: "export.example" });
    const formula = await createContact(fixture.db, "owner-a", tenant, { name: "=SUM(A1:A9)", email: "formula@example.test", notes: "Private pastoral note" });
    const linked = await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic Linked", phone: "+4915177777777" });
    await linkCompany(fixture.db, "owner-a", tenant, linked.id, { companyId: church.id, title: "Deacon" });
    const unsubscribed = await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic Unsubscribed", email: "unsub@example.test" });
    await recordConsent(fixture.db, "owner-a", tenant, unsubscribed.id, consent);
    const erased = await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic Erased Export", email: "erased-export@example.test" });
    await eraseContact(fixture.db, "owner-a", tenant, erased.id);
    const field = await createFieldDefinition(fixture.db, "owner-a", tenant, { objectType: "person", label: "Ministry", type: "select", options: [{ value: "youth", label: "Youth" }] });
    await patchRecordFields(fixture.db, "owner-a", tenant, "person", linked.id, { version: (await getContact(fixture.db, "owner-a", tenant, linked.id)).version, values: { [field.key]: "youth" } });
    for (const params of [{}, { q: "Synthetic" }, { f: "marketing~any_of~withdrawn" }, { f: `cf:${field.key}~any_of~youth` }, { sort: "-name" }]) {
      const list = await listContacts(fixture.db, "member-a", tenant, params);
      const file = await exportRecords(fixture.db, "member-a", tenant, "person", params);
      const lines = parseCsvRecords(file.body.replace(/^﻿/, "")) as string[][];
      expect(file.rows).toBe(list.total);
      expect(lines.length - 1).toBe(list.total);
      expect((await exportCount(fixture.db, "member-a", tenant, "person", params)).total).toBe(list.total);
      expect(lines.slice(1).map((line) => line[0])).toEqual(list.rows.map((row) => (row.name.startsWith("=") ? `'${row.name}` : row.name)));
    }
    const member = await exportRecords(fixture.db, "member-a", tenant, "person");
    const memberLines = parseCsvRecords(member.body.replace(/^﻿/, "")) as string[][];
    expect(memberLines[0]).toEqual(["Name", "Email", "Phone", "Social handle", "Organization", "Job title", "Email marketing", "Created", "Updated", "Ministry"]);
    expect(member.body).toContain("'=SUM(A1:A9)");
    expect(member.body).toContain("'+4915177777777");
    expect(member.body).not.toContain("Private pastoral note");
    expect(member.body).not.toMatch(/erased-export|Erased contact|Synthetic Erased Export/);
    const linkedLine = memberLines.find((line) => line[0] === "Synthetic Linked")!;
    expect(linkedLine.slice(4, 7)).toEqual(["Synthetic Export Chapel", "Deacon", "No decision"]);
    expect(linkedLine[9]).toBe("Youth");
    expect(memberLines.find((line) => line[0] === "Synthetic Unsubscribed")![6]).toBe("Unsubscribed");
    const owner = await exportRecords(fixture.db, "owner-a", tenant, "person");
    expect(owner.body).toContain("Private pastoral note");
    const companiesFile = await exportRecords(fixture.db, "member-a", tenant, "company", { q: "export" });
    expect(parseCsvRecords(companiesFile.body.replace(/^﻿/, "")) as string[][]).toEqual([["Name", "Domain", "Description", "People", "Created", "Updated"], expect.arrayContaining(["Synthetic Export Chapel", "export.example", "", "1"])]);
    const audit = await fixture.admin.query("select metadata from audit_logs where tenant_id = $1 and action = 'crm.export.created' order by created_at desc limit 1", [tenant]);
    expect(audit.rows[0].metadata).toMatchObject({ entity: "company", rows: "1", filtered: "true" });
    // Cross-tenant: the other workspace's people never appear, and its export is refused for outsiders.
    await expect(exportRecords(fixture.db, "owner-b", tenant, "person")).rejects.toMatchObject({ status: 403 });
    expect((await exportRecords(fixture.db, "owner-b", tenantB, "person")).body).not.toContain("formula@example.test");
    await expect(exportRecords(fixture.db, "member-a", tenant, "person", { f: "cf:nope~is_empty~" })).rejects.toMatchObject({ status: 400 });
    void formula;
  });
});

describe("merge", () => {
  it("previews, then moves every child to the kept person, keeps all consent events and erases the merged one", async () => {
    const tenant = (await createWorkspace(fixture.db, "owner-a", "Merge A")).tenantId;
    await putMember(fixture.db, "owner-a", tenant, "member-a@example.test", "member");
    await listPipelines(fixture.db, "owner-a", tenant);
    const companyOne = await createCompany(fixture.db, "owner-a", tenant, { name: "Synthetic Merge One" });
    const companyTwo = await createCompany(fixture.db, "owner-a", tenant, { name: "Synthetic Merge Two" });
    const kept = await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic Maria", email: "maria@example.test" });
    const dup = await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic Maria", email: "maria.old@example.test", phone: "+4915166666666", notes: "From the old list" });
    await linkCompany(fixture.db, "owner-a", tenant, kept.id, { companyId: companyOne.id });
    await linkCompany(fixture.db, "owner-a", tenant, dup.id, { companyId: companyOne.id });
    await linkCompany(fixture.db, "owner-a", tenant, dup.id, { companyId: companyTwo.id, title: "Volunteer" });
    await recordConsent(fixture.db, "owner-a", tenant, dup.id, consent);
    const task = await createTask(fixture.db, "owner-a", tenant, { title: "Visit Maria", contactId: dup.id });
    await createNote(fixture.db, "owner-a", tenant, { target: "person", targetId: dup.id, body: "Prefers mornings" });
    const deal = await createDeal(fixture.db, "owner-a", tenant, { name: "Synthetic gift", contactId: dup.id });
    const field = await createFieldDefinition(fixture.db, "owner-a", tenant, { objectType: "person", label: "Spouse", type: "relation", relationTarget: "person" });
    const third = await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic Jose" });
    await patchRecordFields(fixture.db, "owner-a", tenant, "person", third.id, { version: (await getContact(fixture.db, "owner-a", tenant, third.id)).version, values: { [field.key]: dup.id } });
    // Members cannot merge; nor can anyone merge a person into themselves or across workspaces.
    await expect(previewMerge(fixture.db, "member-a", tenant, kept.id, dup.id)).rejects.toMatchObject({ status: 403 });
    await expect(later(() => previewMerge(fixture.db, "owner-a", tenant, kept.id, kept.id))).rejects.toMatchObject({ status: 400 });
    await expect(previewMerge(fixture.db, "owner-b", tenantB, kept.id, dup.id)).rejects.toMatchObject({ status: 404 });
    await expect(previewMerge(fixture.db, "owner-a", tenantA, kept.id, dup.id)).rejects.toMatchObject({ status: 404 });
    const preview = await previewMerge(fixture.db, "owner-a", tenant, kept.id, dup.id);
    expect(preview).toMatchObject({
      kept: { id: kept.id }, merged: { id: dup.id }, identifiers: { moved: [{ kind: "phone", value: "+4915166666666" }], dropped: [{ kind: "email", value: "maria.old@example.test" }] },
      links: 1, consents: 1, tasks: 1, notes: 1, deals: 1, values: 1, notesText: "copied",
    });
    const fresh = await getContact(fixture.db, "owner-a", tenant, kept.id), old = await getContact(fixture.db, "owner-a", tenant, dup.id);
    await expect(mergeContacts(fixture.db, "owner-a", tenant, kept.id, { sourceId: dup.id, targetVersion: fresh.version - 1 || 99, sourceVersion: old.version })).rejects.toMatchObject({ status: 409 });
    const merged = await mergeContacts(fixture.db, "owner-a", tenant, kept.id, { sourceId: dup.id, targetVersion: fresh.version, sourceVersion: old.version });
    expect(merged.moved).toMatchObject({ identifiers: 1, droppedIdentifiers: 1, links: 1, consents: 1, tasks: 1, notes: 1, deals: 1, values: 1, notesCopied: true });
    const after = await getContact(fixture.db, "owner-a", tenant, kept.id);
    expect(after.identifiers.map((item) => item.value).sort()).toEqual(["+4915166666666", "maria@example.test"]);
    expect(after.companies.map((item) => item.name).sort()).toEqual(["Synthetic Merge One", "Synthetic Merge Two"]);
    expect(after.notes).toBe("From the old list");
    expect(after.effectiveConsents).toMatchObject([{ channel: "email", status: "withdrawn" }]);
    expect((await listContacts(fixture.db, "owner-a", tenant, { f: "marketing~any_of~withdrawn" })).rows.map((row) => row.id)).toEqual([kept.id]);
    await expect(getContact(fixture.db, "owner-a", tenant, dup.id)).rejects.toMatchObject({ status: 404 });
    const moved = await fixture.admin.query(`select (select contact_id from crm_tasks where id = $1) as task, (select contact_id from opportunities where id = $2) as deal,
      (select count(*)::int from crm_notes where tenant_id = $3 and contact_id = $4) as notes, (select relation_contact_id from crm_field_values where tenant_id = $3 and contact_id = $5) as relation`, [task.id, deal.id, tenant, kept.id, third.id]);
    expect(moved.rows[0]).toEqual({ task: kept.id, deal: kept.id, notes: 1, relation: kept.id });
    const leftovers = await fixture.admin.query(`select count(*)::int as n from (select contact_id::text from contact_identifiers where tenant_id = $1 union all select contact_id::text from contact_company_links where tenant_id = $1
      union all select contact_id::text from contact_consents where tenant_id = $1 union all select contact_id::text from crm_tasks where tenant_id = $1 union all select contact_id::text from crm_notes where tenant_id = $1
      union all select contact_id::text from opportunities where tenant_id = $1 union all select relation_contact_id::text from crm_field_values where tenant_id = $1) x where contact_id = $2`, [tenant, dup.id]);
    expect(leftovers.rows[0].n).toBe(0);
    const audit = await fixture.admin.query("select action from audit_logs where tenant_id = $1 and action in ('contact.merge', 'contact.erase') order by created_at", [tenant]);
    expect(audit.rows.map((row) => row.action)).toEqual(["contact.merge", "contact.erase"]);
    const outbox = await fixture.admin.query("select payload, idempotency_key from outbox_events where tenant_id = $1 and kind = 'crm.merge.completed'", [tenant]);
    expect(outbox.rows[0].payload).toMatchObject({ contactId: kept.id, moved: { tasks: 1 } });
    expect(JSON.stringify(outbox.rows)).not.toContain(dup.id);
    // The SQL definer itself refuses members and foreign tenants.
    await expect(withTenant(fixture.db, "member-a", tenant, "contacts:read", (tx, tenantId) => tx.execute(`select public.merge_contacts('${tenantId}', '${kept.id}', '${third.id}')`))).rejects.toThrow();
  });

  it("refuses to move consents, notes or import cells outside the merge and erasure definers", async () => {
    const person = await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Guarded", email: "guarded@example.test" });
    const other = await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Elsewhere" });
    await recordConsent(fixture.db, "owner-a", tenantA, person.id, consent);
    await createNote(fixture.db, "owner-a", tenantA, { target: "person", targetId: person.id, body: "Stay here" });
    await expect(fixture.admin.query("update contact_consents set contact_id = $1 where contact_id = $2", [other.id, person.id])).rejects.toThrow(/append-only/);
    await expect(fixture.admin.query("update crm_notes set contact_id = $1 where contact_id = $2", [other.id, person.id])).rejects.toThrow(/immutable/);
    // Even with the merge setting forged for that person, only the merge definer's own session may move them.
    await expect(withTenant(fixture.db, "owner-a", tenantA, "contacts:write", async (tx) => {
      await tx.execute(`select set_config('app.merge_source', '${person.id}', true)`);
      await tx.execute(`update crm_notes set contact_id = '${other.id}' where contact_id = '${person.id}'`);
    })).rejects.toThrow();
  });
});

describe("definers without superuser or BYPASSRLS", () => {
  it("merge and rollback work when owned by a restricted role under FORCE RLS (as on Neon)", async () => {
    const role = "harvest_test_crm06", tables = ["contacts", "contact_identifiers", "contact_company_links", "contact_consents", "crm_tasks", "crm_notes", "opportunities",
      "crm_field_values", "crm_field_definitions", "crm_import_rows", "crm_imports", "crm_associations", "companies", "audit_logs", "workspace_members"];
    await fixture.admin.query(`create role ${role} nologin nosuperuser nobypassrls noinherit`);
    try {
      await fixture.admin.query(`grant usage on schema public to ${role}`);
      await fixture.admin.query(`grant select, insert, update, delete on ${tables.join(", ")} to ${role}`);
      await fixture.admin.query(`grant execute on function public.erase_contact(uuid, uuid) to ${role}`);
      for (const table of tables) await fixture.admin.query(`create policy test_crm06_definer on ${table} to ${role} using (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) with check (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)`);
      await fixture.admin.query(`alter function public.merge_contacts(uuid,uuid,uuid) owner to ${role}`);
      await fixture.admin.query(`alter function public.rollback_crm_import(uuid,uuid) owner to ${role}`);
      const tenant = (await createWorkspace(fixture.db, "owner-a", "Restricted definers")).tenantId;
      const field = await createFieldDefinition(fixture.db, "owner-a", tenant, { objectType: "person", label: "Group", type: "text" });
      const kept = await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic Kept", email: "kept@example.test" });
      const dup = await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic Dup", phone: "+4915155555555" });
      await recordConsent(fixture.db, "owner-a", tenant, dup.id, consent);
      await createNote(fixture.db, "owner-a", tenant, { target: "person", targetId: dup.id, body: "Moves" });
      await patchRecordFields(fixture.db, "owner-a", tenant, "person", dup.id, { version: (await getContact(fixture.db, "owner-a", tenant, dup.id)).version, values: { [field.key]: "Youth" } });
      const versions = { targetVersion: (await getContact(fixture.db, "owner-a", tenant, kept.id)).version, sourceVersion: (await getContact(fixture.db, "owner-a", tenant, dup.id)).version };
      const merged = await mergeContacts(fixture.db, "owner-a", tenant, kept.id, { sourceId: dup.id, ...versions });
      expect(merged.moved).toMatchObject({ identifiers: 1, consents: 1, notes: 1, values: 1 });
      expect((await getContact(fixture.db, "owner-a", tenant, kept.id)).effectiveConsents).toMatchObject([{ status: "withdrawn" }]);
      const run = await runImport("owner-a", tenant, csv([["Name", "Email"], ["Synthetic Restricted", "restricted-import@example.test"]]));
      await expect(rollbackImport(fixture.db, "owner-a", tenant, run.id)).resolves.toMatchObject({ result: { removed: 1 } });
      expect((await fixture.admin.query("select proowner::regrole::text as owner from pg_proc where proname in ('merge_contacts', 'rollback_crm_import')")).rows).toEqual([{ owner: role }, { owner: role }]);
    } finally {
      await fixture.admin.query("do $$ begin execute format('alter function public.merge_contacts(uuid,uuid,uuid) owner to %I', current_user); execute format('alter function public.rollback_crm_import(uuid,uuid) owner to %I', current_user); end $$");
      for (const table of tables) await fixture.admin.query(`drop policy if exists test_crm06_definer on ${table}`);
      await fixture.admin.query(`drop owned by ${role}`);
      await fixture.admin.query(`drop role ${role}`);
    }
  });
});
