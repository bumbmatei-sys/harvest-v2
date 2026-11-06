import { message, type MessageKey } from "../i18n/messages";
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { auditLogs, companies, contactCompanyLinks, contactIdentifiers, contacts, crmImportRows, crmImports, users, type CrmImportApplied, type CrmImportStats } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { DUPLICATE_MIN_LENGTH } from "../lib/crm-input";
import { CSV_BOM, CSV_MAX_BYTES, csvLine, parseCsv } from "../lib/csv";
import {
  IMPORT_CHUNK, IMPORT_PREVIEW_PAGE, companyReference, importCreate, importPatch, mappingSchema, parseCompanyRow, parsePersonRow, suggestMapping,
  type CompanyRow, type ImportCreate, type ImportEntity, type ImportPatch, type PersonRow, type RowError, type RowWarning,
} from "../lib/crm-import";
import { appendOutboxEvent } from "./jobs/outbox";
import { pgCode } from "./contacts";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

const missing = () => new AccessError(404, message("Errors.thisImportIsNotAvailable"));
const stale = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
const notEditable = () => new AccessError(409, message("Errors.thisImportCanNoLongerBeChanged"), { reason: "import_state" });
const badMapping = () => new AccessError(400, message("Errors.checkTheColumnMapping"));
const csvErrors: Record<string, MessageKey> = {
  empty: "Errors.theFileHasNoRowsToImport", too_many_rows: "Errors.theFileHasMoreThan5000Rows", too_many_columns: "Errors.theFileHasMoreThan100Columns",
  unterminated_quote: "Errors.theFileIsNotValidCsv", cell_too_long: "Errors.aCellIsLongerThan5000Characters", no_header: "Errors.theFileHasNoHeaderRow",
  duplicate_headers: "Errors.theFileHasRepeatedColumnNames", too_large: "Errors.theFileIsLargerThan5Mb",
};

/** A matched record no longer has room for the fill (someone wrote it first); the row is reported, not applied. */
class ChangedSincePreview extends Error {}
type ImportRecord = typeof crmImports.$inferSelect;
type RowRecord = typeof crmImportRows.$inferSelect;
type Decision = { action: "create" | "update" | "skip" | "error" | "conflict"; error?: RowError; warning?: RowWarning; recordId?: string; companyId?: string | null; fill?: CrmImportApplied };

async function loadImport(tx: Transaction, tenantId: string, id: string, lock = false) {
  const query = tx.select().from(crmImports).where(and(eq(crmImports.tenantId, tenantId), eq(crmImports.id, id)));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw missing();
  return row;
}
function summary(row: ImportRecord) {
  return { id: row.id, entity: row.entity, status: row.status, fileName: row.fileName, headers: row.headers, mapping: row.mapping, onMatch: row.onMatch, rowCount: row.rowCount,
    stats: row.stats, version: row.version, createdBy: row.createdBy, createdAt: row.createdAt, previewedAt: row.previewedAt, completedAt: row.completedAt, rolledBackAt: row.rolledBackAt };
}

/** Upload: parse the CSV, store one row per line, suggest a mapping. The client key makes re-sends idempotent. */
export function createImport(db: Database, userId: string, workspace: string, data: ImportCreate) {
  const input = importCreate.parse(data);
  if (Buffer.byteLength(input.csv, "utf8") > CSV_MAX_BYTES) throw new AccessError(400, message(csvErrors.too_large));
  const parsed = parseCsv(input.csv);
  if (!parsed.ok) throw new AccessError(400, message(csvErrors[parsed.error]), { reason: parsed.error });
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:import", async (tx, tenantId) => {
    const [created] = await tx.insert(crmImports).values({
      tenantId, entity: input.entity, clientKey: input.clientKey, fileName: input.fileName, headers: parsed.headers,
      mapping: suggestMapping(input.entity, parsed.headers), rowCount: parsed.rows.length, createdBy: userId,
    }).onConflictDoNothing({ target: [crmImports.tenantId, crmImports.clientKey] }).returning();
    if (!created) {
      const [existing] = await tx.select().from(crmImports).where(and(eq(crmImports.tenantId, tenantId), eq(crmImports.clientKey, input.clientKey)));
      return summary(existing);
    }
    for (let start = 0; start < parsed.rows.length; start += 500) {
      await tx.insert(crmImportRows).values(parsed.rows.slice(start, start + 500).map((raw, index) => ({ tenantId, importId: created.id, rowNumber: start + index + 1, raw })));
    }
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "crm.import.created", targetId: created.id, metadata: { entity: input.entity, rows: String(parsed.rows.length) } });
    return summary(created);
  });
}

export function listImports(db: Database, userId: string, workspace: string) {
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:import", async (tx, tenantId) => {
    const rows = await tx.select({ row: crmImports, creator: users.name, creatorEmail: users.email }).from(crmImports).leftJoin(users, eq(users.id, crmImports.createdBy))
      .where(eq(crmImports.tenantId, tenantId)).orderBy(desc(crmImports.createdAt), desc(crmImports.id)).limit(50);
    return rows.map(({ row, creator, creatorEmail }) => ({ ...summary(row), creatorName: creator || creatorEmail || null }));
  });
}

export const rowOutcomes = ["all", "create", "update", "skip", "problem"] as const;
export type RowOutcome = typeof rowOutcomes[number];
/** One import with a page of rows. Before a preview the first rows are samples for the mapping step. */
export function getImport(db: Database, userId: string, workspace: string, importId: string, options: { outcome?: RowOutcome; page?: number } = {}) {
  const id = uuidInput.parse(importId), outcome = options.outcome ?? "all", page = Math.max(1, Math.min(1000, Math.floor(options.page ?? 1)));
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:import", async (tx, tenantId) => {
    const row = await loadImport(tx, tenantId, id);
    const filter = outcome === "all" ? undefined : outcome === "problem" ? inArray(crmImportRows.action, ["error", "conflict"]) : eq(crmImportRows.action, outcome);
    const where = and(eq(crmImportRows.tenantId, tenantId), eq(crmImportRows.importId, id), filter);
    const [{ total }] = await tx.select({ total: count() }).from(crmImportRows).where(where);
    const rows = await tx.select({ row: crmImportRows, contactName: contacts.name, companyName: companies.name }).from(crmImportRows)
      .leftJoin(contacts, and(eq(contacts.tenantId, crmImportRows.tenantId), eq(contacts.id, crmImportRows.contactId), isNull(contacts.erasedAt)))
      .leftJoin(companies, and(eq(companies.tenantId, crmImportRows.tenantId), eq(companies.id, crmImportRows.companyId)))
      .where(where).orderBy(asc(crmImportRows.rowNumber)).limit(IMPORT_PREVIEW_PAGE).offset((page - 1) * IMPORT_PREVIEW_PAGE);
    const [creator] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, row.createdBy));
    return {
      ...summary(row), creatorName: creator ? creator.name || creator.email : null, outcome, page, total,
      rows: rows.map(({ row: item, contactName, companyName }) => ({
        rowNumber: item.rowNumber, raw: item.raw, status: item.status, action: item.action, error: item.error, warning: item.warning, created: item.created,
        recordId: row.entity === "person" ? item.contactId : item.companyId, recordName: row.entity === "person" ? contactName : companyName,
        companyName: row.entity === "person" ? companyName : null,
      })),
    };
  });
}

/** Autosaves the mapping and match strategy. Any change returns the import to the mapping step. */
export function updateImport(db: Database, userId: string, workspace: string, importId: string, data: ImportPatch) {
  const id = uuidInput.parse(importId), input = importPatch.parse(data);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:import", async (tx, tenantId) => {
    const current = await loadImport(tx, tenantId, id, true);
    if (current.status !== "draft" && current.status !== "preview") throw notEditable();
    if (current.version !== input.version) throw stale();
    if (input.mapping && input.mapping.length !== current.headers.length) throw badMapping();
    const mapping = input.mapping ?? current.mapping, onMatch = input.onMatch ?? current.onMatch;
    if (JSON.stringify(mapping) === JSON.stringify(current.mapping) && onMatch === current.onMatch) return summary(current);
    const [row] = await tx.update(crmImports).set({ mapping, onMatch, status: "draft", stats: {}, version: sql`${crmImports.version} + 1`, updatedAt: new Date() })
      .where(and(eq(crmImports.tenantId, tenantId), eq(crmImports.id, id))).returning();
    return summary(row);
  });
}

type PersonContext = {
  byKey: Map<string, string>; names: Set<string>; records: Map<string, { notes: string; kinds: Set<string>; companies: Set<string> }>;
  companyByDomain: Map<string, string>; companyByName: Map<string, string[]>;
};
/** Everything the person decisions need, read in a few set-based queries. */
async function personContext(tx: Transaction, tenantId: string, parsed: ReturnType<typeof parsePersonRow>[]): Promise<PersonContext> {
  const keys = [...new Set(parsed.flatMap((row) => row.keys))];
  const pairs = keys.map((key) => { const at = key.indexOf(":"); return { kind: key.slice(0, at), value: key.slice(at + 1) }; });
  const identifiers = pairs.length ? await tx.select({ kind: contactIdentifiers.kind, value: contactIdentifiers.normalizedValue, contactId: contactIdentifiers.contactId }).from(contactIdentifiers)
    .where(and(eq(contactIdentifiers.tenantId, tenantId), or(...pairs.map((pair) => and(eq(contactIdentifiers.kind, pair.kind as "email"), eq(contactIdentifiers.normalizedValue, pair.value)))))) : [];
  const byKey = new Map(identifiers.map((item) => [`${item.kind}:${item.value}`, item.contactId]));
  const ids = [...new Set(byKey.values())];
  const records = new Map<string, { notes: string; kinds: Set<string>; companies: Set<string> }>();
  if (ids.length) {
    for (const row of await tx.select({ id: contacts.id, notes: contacts.notes }).from(contacts).where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, ids), isNull(contacts.erasedAt)))) records.set(row.id, { notes: row.notes, kinds: new Set(), companies: new Set() });
    for (const row of await tx.select({ contactId: contactIdentifiers.contactId, kind: contactIdentifiers.kind }).from(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenantId), inArray(contactIdentifiers.contactId, ids)))) records.get(row.contactId)?.kinds.add(row.kind);
    for (const row of await tx.select({ contactId: contactCompanyLinks.contactId, companyId: contactCompanyLinks.companyId }).from(contactCompanyLinks).where(and(eq(contactCompanyLinks.tenantId, tenantId), inArray(contactCompanyLinks.contactId, ids)))) records.get(row.contactId)?.companies.add(row.companyId);
  }
  const names = [...new Set(parsed.flatMap((row) => (row.ok && row.value.normalizedName.length >= DUPLICATE_MIN_LENGTH ? [row.value.normalizedName] : [])))];
  const nameRows = names.length ? await tx.selectDistinct({ name: contacts.normalizedName }).from(contacts).where(and(eq(contacts.tenantId, tenantId), isNull(contacts.erasedAt), inArray(contacts.normalizedName, names))) : [];
  const refs = parsed.flatMap((row) => (row.ok ? [companyReference(row.value.company)] : [])).filter((ref): ref is NonNullable<typeof ref> => !!ref);
  const domains = [...new Set(refs.flatMap((ref) => ("domain" in ref ? [ref.domain] : [])))], companyNames = [...new Set(refs.flatMap((ref) => ("name" in ref ? [ref.name] : [])))];
  const companyByDomain = new Map((domains.length ? await tx.select({ id: companies.id, domain: companies.domain }).from(companies).where(and(eq(companies.tenantId, tenantId), inArray(companies.domain, domains))) : []).map((row) => [row.domain!, row.id]));
  const companyByName = new Map<string, string[]>();
  if (companyNames.length) for (const row of await tx.select({ id: companies.id, name: companies.normalizedName }).from(companies).where(and(eq(companies.tenantId, tenantId), inArray(companies.normalizedName, companyNames))).orderBy(asc(companies.id))) companyByName.set(row.name, [...(companyByName.get(row.name) ?? []), row.id]);
  return { byKey, names: new Set(nameRows.map((row) => row.name)), records, companyByDomain, companyByName };
}
function decidePerson(row: ReturnType<typeof parsePersonRow>, context: PersonContext, onMatch: "skip" | "fill"): Decision {
  if (!row.ok) return { action: "error", error: row.error };
  const value = row.value;
  const ref = companyReference(value.company);
  let companyId: string | null = null, warning: RowWarning | undefined;
  if (ref) {
    const found = "domain" in ref ? (context.companyByDomain.get(ref.domain) ? [context.companyByDomain.get(ref.domain)!] : []) : context.companyByName.get(ref.name) ?? [];
    if (found.length === 1) companyId = found[0]; else warning = found.length ? "company_ambiguous" : "company_not_found";
  }
  const matched = [...new Set(row.keys.map((key) => context.byKey.get(key)).filter((id): id is string => !!id))];
  if (matched.length > 1) return { action: "conflict", error: "matches_several_records" };
  if (matched.length === 0) return { action: "create", companyId, warning: warning ?? (context.names.has(value.normalizedName) ? "possible_duplicate_name" : undefined) };
  const recordId = matched[0], record = context.records.get(recordId);
  if (onMatch === "skip" || !record) return { action: "skip", recordId, companyId, warning };
  const identifiers = (["email", "phone", "social"] as const).filter((kind) => value[kind] && !record.kinds.has(kind));
  const fill: CrmImportApplied = {
    ...(value.notes && !record.notes ? { notes: true } : {}), ...(identifiers.length ? { identifiers } : {}),
    ...(companyId && !record.companies.has(companyId) ? { companyId, linked: true } : {}),
  };
  return Object.keys(fill).length ? { action: "update", recordId, companyId, warning, fill } : { action: "skip", recordId, companyId, warning };
}

type CompanyContext = { byDomain: Map<string, { id: string; description: string }>; names: Set<string> };
async function companyContext(tx: Transaction, tenantId: string, parsed: ReturnType<typeof parseCompanyRow>[]): Promise<CompanyContext> {
  const domains = [...new Set(parsed.flatMap((row) => (row.ok && row.value.domain ? [row.value.domain] : [])))];
  const byDomain = new Map((domains.length ? await tx.select({ id: companies.id, domain: companies.domain, description: companies.description }).from(companies).where(and(eq(companies.tenantId, tenantId), inArray(companies.domain, domains))) : [])
    .map((row) => [row.domain!, { id: row.id, description: row.description }]));
  const names = [...new Set(parsed.flatMap((row) => (row.ok && row.value.normalizedName.length >= DUPLICATE_MIN_LENGTH ? [row.value.normalizedName] : [])))];
  const nameRows = names.length ? await tx.selectDistinct({ name: companies.normalizedName }).from(companies).where(and(eq(companies.tenantId, tenantId), inArray(companies.normalizedName, names))) : [];
  return { byDomain, names: new Set(nameRows.map((row) => row.name)) };
}
function decideCompany(row: ReturnType<typeof parseCompanyRow>, context: CompanyContext, onMatch: "skip" | "fill"): Decision {
  if (!row.ok) return { action: "error", error: row.error };
  const existing = row.value.domain ? context.byDomain.get(row.value.domain) : undefined;
  if (!existing) return { action: "create", warning: context.names.has(row.value.normalizedName) ? "possible_duplicate_name" : undefined };
  if (onMatch === "fill" && row.value.description && !existing.description) return { action: "update", recordId: existing.id, fill: { description: true } };
  return { action: "skip", recordId: existing.id };
}

const statusFor = (action: Decision["action"]) => (action === "create" || action === "update" ? "ready" : action === "skip" ? "skipped" : "error");
/**
 * Dry run: validates every row, finds in-file duplicates (first occurrence wins) and matches
 * against live, tenant-unique identifiers only. Nothing outside the import changes.
 */
export function previewImport(db: Database, userId: string, workspace: string, importId: string, data: { version: number }) {
  const id = uuidInput.parse(importId);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:import", async (tx, tenantId) => {
    const current = await loadImport(tx, tenantId, id, true);
    if (current.status !== "draft" && current.status !== "preview") throw notEditable();
    if (current.version !== data.version) throw stale();
    if (!mappingSchema(current.entity, current.headers.length).safeParse(current.mapping).success) throw badMapping();
    const rows = await tx.select({ rowNumber: crmImportRows.rowNumber, raw: crmImportRows.raw }).from(crmImportRows)
      .where(and(eq(crmImportRows.tenantId, tenantId), eq(crmImportRows.importId, id))).orderBy(asc(crmImportRows.rowNumber));
    const decisions = await decideAll(tx, tenantId, current.entity, current.mapping, current.onMatch, rows.map((row) => row.raw), true);
    const updates = rows.map((row, index) => ({
      row_number: row.rowNumber, action: decisions[index].action, error: decisions[index].error ?? null, warning: decisions[index].warning ?? null,
      match_keys: decisions[index].keys, status: statusFor(decisions[index].action),
      contact_id: current.entity === "person" ? decisions[index].recordId ?? null : null,
      company_id: current.entity === "person" ? decisions[index].companyId ?? null : decisions[index].recordId ?? null,
    }));
    await tx.execute(sql`update crm_import_rows r set action = x.action, error = x.error, warning = x.warning, match_keys = x.match_keys, status = x.status,
      contact_id = x.contact_id, company_id = x.company_id, created = false, applied = null, result_version = null
      from jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) as x(row_number int, action text, error text, warning text, match_keys text[], status text, contact_id uuid, company_id uuid)
      where r.tenant_id = ${tenantId}::uuid and r.import_id = ${id}::uuid and r.row_number = x.row_number`);
    const stats: CrmImportStats = { total: rows.length };
    for (const decision of decisions) stats[decision.action] = (stats[decision.action] ?? 0) + 1;
    const [row] = await tx.update(crmImports).set({ status: "preview", stats, previewedAt: new Date(), updatedAt: new Date(), version: sql`${crmImports.version} + 1` })
      .where(and(eq(crmImports.tenantId, tenantId), eq(crmImports.id, id))).returning();
    return summary(row);
  });
}
/** Shared by preview and commit: parse, mark in-file duplicates, then decide against the database. */
async function decideAll(tx: Transaction, tenantId: string, entity: ImportEntity, mapping: (string | null)[], onMatch: "skip" | "fill", raws: string[][], checkInFile: boolean) {
  const parsed = raws.map((raw) => (entity === "person" ? parsePersonRow(raw, mapping) : parseCompanyRow(raw, mapping)));
  const seen = new Set<string>();
  const inFile = parsed.map((row) => {
    const repeated = checkInFile && row.ok && row.keys.some((key) => seen.has(key));
    for (const key of row.ok ? row.keys : []) seen.add(key);
    return repeated;
  });
  const decisions: Decision[] = entity === "person"
    ? await personContext(tx, tenantId, parsed as ReturnType<typeof parsePersonRow>[]).then((context) => (parsed as ReturnType<typeof parsePersonRow>[]).map((row) => decidePerson(row, context, onMatch)))
    : await companyContext(tx, tenantId, parsed as ReturnType<typeof parseCompanyRow>[]).then((context) => (parsed as ReturnType<typeof parseCompanyRow>[]).map((row) => decideCompany(row, context, onMatch)));
  return decisions.map((decision, index) => ({ ...(inFile[index] ? { action: "conflict" as const, error: "duplicate_in_file" as const } : decision), keys: parsed[index].keys, value: parsed[index].ok ? (parsed[index] as { value: PersonRow | CompanyRow }).value : null }));
}

const identifierValue = (kind: "email" | "phone" | "social", value: string) => ({ kind, value, normalizedValue: kind === "social" ? value.replace(/^@/, "").toLowerCase() : value });
async function applyPerson(tx: Transaction, tenantId: string, userId: string, importId: string, decision: Decision, value: PersonRow) {
  if (decision.action === "create") {
    const [contact] = await tx.insert(contacts).values({ tenantId, name: value.name, notes: value.notes }).returning();
    const identifiers = (["email", "phone", "social"] as const).filter((kind) => value[kind]).map((kind) => ({ tenantId, contactId: contact.id, ...identifierValue(kind, value[kind]) }));
    if (identifiers.length) await tx.insert(contactIdentifiers).values(identifiers);
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "contact.create", targetId: contact.id, metadata: { importId } });
    let applied: CrmImportApplied | null = null;
    if (decision.companyId) {
      await tx.insert(contactCompanyLinks).values({ tenantId, contactId: contact.id, companyId: decision.companyId, title: value.title, isPrimary: true, createdBy: userId });
      await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "contact.company_link", targetId: contact.id, metadata: { companyId: decision.companyId, importId } });
      applied = { companyId: decision.companyId, linked: true };
    }
    return { recordId: contact.id, created: true, applied, version: contact.version };
  }
  const id = decision.recordId!, fill = decision.fill!;
  if (fill.identifiers?.length) await tx.insert(contactIdentifiers).values(fill.identifiers.map((kind) => ({ tenantId, contactId: id, ...identifierValue(kind as "email", value[kind as "email"]) })));
  if (fill.linked && fill.companyId) {
    const [primary] = await tx.select({ one: sql`1` }).from(contactCompanyLinks).where(and(eq(contactCompanyLinks.tenantId, tenantId), eq(contactCompanyLinks.contactId, id), eq(contactCompanyLinks.isPrimary, true)));
    await tx.insert(contactCompanyLinks).values({ tenantId, contactId: id, companyId: fill.companyId, title: value.title, isPrimary: !primary, createdBy: userId });
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "contact.company_link", targetId: id, metadata: { companyId: fill.companyId, importId } });
  }
  const [row] = await tx.update(contacts).set({ ...(fill.notes ? { notes: value.notes } : {}), updatedAt: new Date(), version: sql`${contacts.version} + 1` })
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), isNull(contacts.erasedAt))).returning();
  const fields = [...(fill.notes ? ["notes"] : []), ...(fill.identifiers ?? [])];
  if (fields.length) await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "contact.update", targetId: id, metadata: { fields: fields.join(","), importId } });
  return { recordId: id, created: false, applied: fill, version: row.version };
}
async function applyCompany(tx: Transaction, tenantId: string, userId: string, importId: string, decision: Decision, value: CompanyRow) {
  if (decision.action === "create") {
    const [company] = await tx.insert(companies).values({ tenantId, name: value.name, domain: value.domain, description: value.description, createdBy: userId }).returning();
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "company.create", targetId: company.id, metadata: { importId } });
    return { recordId: company.id, created: true, applied: null, version: company.version };
  }
  const [row] = await tx.update(companies).set({ description: value.description, updatedAt: new Date(), version: sql`${companies.version} + 1` })
    .where(and(eq(companies.tenantId, tenantId), eq(companies.id, decision.recordId!), eq(companies.description, ""))).returning();
  if (!row) throw new ChangedSincePreview();
  await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "company.update", targetId: row.id, metadata: { fields: "description", importId } });
  return { recordId: row.id, created: false, applied: { description: true }, version: row.version };
}

/**
 * Commits the next chunk of ready rows. Each row is re-decided against the live database and
 * written in its own savepoint, so a row that fails (say, an identifier taken since the preview)
 * becomes an error without undoing the others. Calling again continues; the last call finalizes.
 */
export function commitImport(db: Database, userId: string, workspace: string, importId: string) {
  const id = uuidInput.parse(importId);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:import", async (tx, tenantId) => {
    const current = await loadImport(tx, tenantId, id, true);
    if (current.status === "completed" || current.status === "failed") return { ...summary(current), remaining: 0 };
    if (current.status !== "preview" && current.status !== "running") throw new AccessError(409, message("Errors.previewTheImportFirst"), { reason: "import_state" });
    if (current.status === "preview") await tx.update(crmImports).set({ status: "running", updatedAt: new Date() }).where(and(eq(crmImports.tenantId, tenantId), eq(crmImports.id, id)));
    const rows = await tx.select().from(crmImportRows).where(and(eq(crmImportRows.tenantId, tenantId), eq(crmImportRows.importId, id), eq(crmImportRows.status, "ready")))
      .orderBy(asc(crmImportRows.rowNumber)).limit(IMPORT_CHUNK);
    const decisions = await decideAll(tx, tenantId, current.entity, current.mapping, current.onMatch, rows.map((row) => row.raw), false);
    for (const [index, row] of rows.entries()) {
      const decision = decisions[index];
      const mark = (values: Partial<RowRecord>) => tx.update(crmImportRows).set(values).where(and(eq(crmImportRows.tenantId, tenantId), eq(crmImportRows.importId, id), eq(crmImportRows.rowNumber, row.rowNumber)));
      if (decision.action !== "create" && decision.action !== "update") {
        // The database changed since the preview (for example the identifier now belongs to someone).
        await mark(decision.action === "skip" ? { status: "skipped", action: "skip" } : { status: "error", action: decision.action, error: decision.error === "matches_several_records" ? decision.error : "changed_since_preview" });
        continue;
      }
      try {
        const result = await tx.transaction((sp) => current.entity === "person"
          ? applyPerson(sp, tenantId, userId, id, decision, decision.value as PersonRow)
          : applyCompany(sp, tenantId, userId, id, decision, decision.value as CompanyRow));
        await mark({ status: "done", action: decision.action, created: result.created, applied: result.applied, resultVersion: result.version,
          ...(current.entity === "person" ? { contactId: result.recordId } : { companyId: result.recordId }) });
      } catch (error) {
        if (pgCode(error) !== "23505" && !(error instanceof ChangedSincePreview)) throw error;
        await mark({ status: "error", action: "error", error: pgCode(error) === "23505" ? "identifier_taken" : "changed_since_preview" });
      }
    }
    const [{ remaining }] = await tx.select({ remaining: count() }).from(crmImportRows).where(and(eq(crmImportRows.tenantId, tenantId), eq(crmImportRows.importId, id), eq(crmImportRows.status, "ready")));
    if (remaining > 0) return { ...summary(await loadImport(tx, tenantId, id)), remaining };
    return { ...summary(await finalize(tx, tenantId, userId, current)), remaining: 0 };
  });
}
async function finalize(tx: Transaction, tenantId: string, userId: string, current: ImportRecord) {
  const [counts] = await tx.select({
    created: sql<number>`count(*) filter (where ${crmImportRows.status} = 'done' and ${crmImportRows.created})::int`,
    updated: sql<number>`count(*) filter (where ${crmImportRows.status} = 'done' and not ${crmImportRows.created})::int`,
    skipped: sql<number>`count(*) filter (where ${crmImportRows.status} = 'skipped')::int`,
    failed: sql<number>`count(*) filter (where ${crmImportRows.status} = 'error')::int`,
  }).from(crmImportRows).where(and(eq(crmImportRows.tenantId, tenantId), eq(crmImportRows.importId, current.id)));
  const status = counts.created + counts.updated === 0 && counts.failed > 0 ? "failed" : "completed";
  const [row] = await tx.update(crmImports).set({ status, stats: { ...current.stats, ...counts }, completedAt: new Date(), updatedAt: new Date(), version: sql`${crmImports.version} + 1` })
    .where(and(eq(crmImports.tenantId, tenantId), eq(crmImports.id, current.id))).returning();
  const metadata = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, String(value)]));
  await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: `crm.import.${status}`, targetId: current.id, metadata: { entity: current.entity, ...metadata } });
  // Counts and ids only: no cell, name or identifier ever reaches the outbox.
  await appendOutboxEvent(tx, tenantId, { kind: `crm.import.${status}`, idempotencyKey: `crm:import:${current.id}:${status}`,
    payload: { importId: current.id, tenantId, actorId: userId, entity: current.entity, total: current.rowCount, ...counts } });
  return row;
}

/** Batch rollback through the fixed SQL definer (ADR 0012): untouched created records go, fills revert. */
export function rollbackImport(db: Database, userId: string, workspace: string, importId: string) {
  const id = uuidInput.parse(importId);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:import", async (tx, tenantId) => {
    let result: { removed: number; reverted: number; kept: number } | null;
    try {
      const rows = await tx.execute(sql`select public.rollback_crm_import(${tenantId}::uuid, ${id}::uuid) as result`);
      result = rows.rows[0]?.result as typeof result;
    } catch (error) {
      if (pgCode(error) === "55000") throw new AccessError(409, message("Errors.thisImportCannotBeRolledBack"), { reason: "import_state" });
      if (pgCode(error) === "42501") throw new AccessError(403, message("Errors.youDoNotHavePermissionToDoThat"));
      throw error;
    }
    if (!result) throw missing();
    const [current] = await tx.select().from(crmImports).where(and(eq(crmImports.tenantId, tenantId), eq(crmImports.id, id)));
    await appendOutboxEvent(tx, tenantId, { kind: "crm.import.rolled_back", idempotencyKey: `crm:import:${id}:rolled_back`,
      payload: { importId: id, tenantId, actorId: userId, entity: current.entity, ...result } });
    return { ...summary(current), result };
  });
}

/** Row-level report of everything not imported, as formula-safe CSV with the original cells. */
export function importReport(db: Database, userId: string, workspace: string, importId: string) {
  const id = uuidInput.parse(importId);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:import", async (tx, tenantId) => {
    const current = await loadImport(tx, tenantId, id);
    const rows = await tx.select().from(crmImportRows).where(and(eq(crmImportRows.tenantId, tenantId), eq(crmImportRows.importId, id), eq(crmImportRows.status, "error"))).orderBy(asc(crmImportRows.rowNumber));
    const lines = [csvLine([message("Imports.report.row"), ...current.headers, message("Imports.report.problem")])];
    for (const row of rows) lines.push(csvLine([row.rowNumber, ...current.headers.map((_, index) => row.raw[index] ?? ""), message(`Imports.rowErrors.${row.error ?? "changed_since_preview"}` as MessageKey)]));
    return { fileName: `${current.fileName.replace(/\.csv$/i, "")}-problems.csv`, body: CSV_BOM + lines.join("") };
  });
}
