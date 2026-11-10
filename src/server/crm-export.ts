import { message } from "../i18n/messages";
import { and, count, eq, getTableColumns, inArray, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { auditLogs, companies, contactCompanyLinks, contactIdentifiers, contactSourceEvents, contacts } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { defaultColumns, paramsToState, type FieldDefinition, type FieldValue, type RawParams, type ViewState } from "../lib/crm-fields";
import { CSV_BOM, csvLine } from "../lib/csv";
import { invalidView, loadDefinitions, marketingEmailState, peopleCountExpr, resolveSourceReferences, resolveState, sourceAccessDenied } from "./crm-filters";
import type { Transaction } from "../db/client";
import { loadRecordValues } from "./crm-fields";
import { companiesQuery } from "./companies";
import { peopleQuery } from "./contacts";
import { AccessError, can } from "./permissions";
import { withTenant } from "./tenancy";

export const EXPORT_MAX_ROWS = 50_000;
const PAGE = 1000;

function formatValue(field: FieldDefinition, value: FieldValue | undefined, related: Map<string, string>) {
  if (value === null || value === undefined) return "";
  if (field.type === "boolean") return message(value ? "Exports.yes" : "Exports.no");
  if (field.type === "select" || field.type === "multi_select") {
    const values = Array.isArray(value) ? value : [String(value)];
    return values.map((item) => field.options.find((option) => option.value === item)?.label ?? item).join("; ");
  }
  if (field.type === "relation") return related.get(String(value)) ?? "";
  return String(value);
}

/**
 * Source rules in an export or count: owners/admins only, and every reference must still resolve.
 * Members, viewers and stale references are refused (403/400) rather than exporting a wider set.
 * The Sources column follows the view: included only when the Source column is shown.
 */
async function sourcePolicy(tx: Transaction, tenantId: string, role: Parameters<typeof can>[0], entity: "person" | "company", state: ViewState) {
  const access = entity === "person" && can(role, "contacts:sources_read");
  if (state.sources.length) {
    if (!access) throw sourceAccessDenied();
    await resolveSourceReferences(tx, tenantId, state.sources);
  }
  return { access, column: access && (state.columns ?? defaultColumns.person).includes("source") };
}

/**
 * CSV of the People or Companies list exactly as filtered by the URL view state. It runs in one
 * transaction (one snapshot) with the list's own predicate and order, so the row count equals the
 * list total. Viewers cannot export; the free-text Notes column needs owner or admin.
 */
export function exportRecords(db: Database, userId: string, workspace: string, entity: "person" | "company", params: RawParams = {}) {
  const parsed = paramsToState(entity, params);
  if (!parsed) throw invalidView();
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:export", async (tx, tenantId, role) => {
    const definitions = await loadDefinitions(tx, tenantId, entity);
    const state = resolveState(entity, parsed.state, definitions);
    const active = definitions.filter((field) => !field.archivedAt);
    const sensitive = can(role, "crm:export_sensitive");
    const filtered = Boolean(state.q || state.filters.length || state.sources.length);
    const sources = await sourcePolicy(tx, tenantId, role, entity, state);
    const lines: string[] = [];
    let total = 0;
    if (entity === "person") {
      const { where, order } = peopleQuery(tx, tenantId, state, definitions, sources.access);
      lines.push(csvLine([message("Exports.columns.name"), message("Exports.columns.email"), message("Exports.columns.phone"), message("Exports.columns.social"),
        message("Exports.columns.company"), message("Exports.columns.title"), message("Exports.columns.emailMarketing"), message("Exports.columns.created"), message("Exports.columns.updated"),
        ...(sensitive ? [message("Exports.columns.notes")] : []), ...(sources.column ? [message("Exports.columns.sources")] : []), ...active.map((field) => field.label)]));
      for (let offset = 0; ; offset += PAGE) {
        const rows = await tx.select({ ...getTableColumns(contacts), marketing: marketingEmailState(tenantId) }).from(contacts).where(where).orderBy(...order).limit(PAGE).offset(offset);
        if (!rows.length) break;
        total += rows.length;
        if (total > EXPORT_MAX_ROWS) throw new AccessError(400, message("Errors.thisExportIsTooLarge"));
        const ids = rows.map((row) => row.id);
        const identifiers = await tx.select().from(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenantId), inArray(contactIdentifiers.contactId, ids)));
        const links = await tx.select({ contactId: contactCompanyLinks.contactId, name: companies.name, title: contactCompanyLinks.title }).from(contactCompanyLinks)
          .innerJoin(companies, and(eq(companies.tenantId, contactCompanyLinks.tenantId), eq(companies.id, contactCompanyLinks.companyId)))
          .where(and(eq(contactCompanyLinks.tenantId, tenantId), inArray(contactCompanyLinks.contactId, ids), eq(contactCompanyLinks.isPrimary, true)));
        const { values, related } = await loadRecordValues(tx, tenantId, "person", ids, active);
        // Row security returns only retained, unreverted evidence: the same as the Source column.
        const events = sources.column ? await tx.selectDistinct({ contactId: contactSourceEvents.contactId, kind: contactSourceEvents.kind }).from(contactSourceEvents)
          .where(and(eq(contactSourceEvents.tenantId, tenantId), inArray(contactSourceEvents.contactId, ids), isNull(contactSourceEvents.revertedAt))) : [];
        const sourceText = (id: string) => {
          const kinds = (["connect", "manual", "csv_import"] as const).filter((kind) => events.some((event) => event.contactId === id && event.kind === kind));
          return kinds.length ? kinds.map((kind) => message(`Crm.sourceHistory.${kind}`)).join("; ") : message("Crm.sourceHistory.unknown");
        };
        for (const row of rows) {
          const value = (kind: string) => identifiers.find((item) => item.contactId === row.id && item.kind === kind)?.value ?? "";
          const link = links.find((item) => item.contactId === row.id);
          lines.push(csvLine([row.name, value("email"), value("phone"), value("social"), link?.name ?? "", link?.title ?? "",
            message(`Crm.marketing.${row.marketing as "granted" | "withdrawn" | "none"}`), row.createdAt.toISOString(), row.updatedAt.toISOString(),
            ...(sensitive ? [row.notes] : []), ...(sources.column ? [sourceText(row.id)] : []), ...active.map((field) => formatValue(field, values.get(row.id)?.[field.key], related))]));
        }
      }
    } else {
      const { where, order } = companiesQuery(tenantId, state, definitions);
      lines.push(csvLine([message("Exports.columns.name"), message("Exports.columns.domain"), message("Exports.columns.description"), message("Exports.columns.people"),
        message("Exports.columns.created"), message("Exports.columns.updated"), ...active.map((field) => field.label)]));
      for (let offset = 0; ; offset += PAGE) {
        const rows = await tx.select({ ...getTableColumns(companies), people: peopleCountExpr(tenantId) }).from(companies).where(where).orderBy(...order).limit(PAGE).offset(offset);
        if (!rows.length) break;
        total += rows.length;
        if (total > EXPORT_MAX_ROWS) throw new AccessError(400, message("Errors.thisExportIsTooLarge"));
        const { values, related } = await loadRecordValues(tx, tenantId, "company", rows.map((row) => row.id), active);
        for (const row of rows) lines.push(csvLine([row.name, row.domain ?? "", row.description, Number(row.people), row.createdAt.toISOString(), row.updatedAt.toISOString(),
          ...active.map((field) => formatValue(field, values.get(row.id)?.[field.key], related))]));
      }
    }
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "crm.export.created", targetId: null,
      metadata: { entity, rows: String(total), filtered: String(filtered), notes: String(sensitive && entity === "person"), sources: String(sources.column), sourceRules: String(state.sources.length) } });
    const stamp = new Date().toISOString().slice(0, 10);
    return { fileName: `${entity === "person" ? "people" : "companies"}-${stamp}.csv`, rows: total, body: CSV_BOM + lines.join("") };
  });
}

/** Count only, for the export dialog: the same predicate as the list and the file. */
export function exportCount(db: Database, userId: string, workspace: string, entity: "person" | "company", params: RawParams = {}) {
  const parsed = paramsToState(entity, params);
  if (!parsed) throw invalidView();
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:export", async (tx, tenantId, role) => {
    const definitions = await loadDefinitions(tx, tenantId, entity);
    const state = resolveState(entity, parsed.state, definitions);
    const sources = await sourcePolicy(tx, tenantId, role, entity, state);
    const { where } = entity === "person" ? peopleQuery(tx, tenantId, state, definitions, sources.access) : companiesQuery(tenantId, state, definitions);
    const table = entity === "person" ? contacts : companies;
    const [{ total }] = await tx.select({ total: count() }).from(table).where(where);
    return { total, notes: entity === "person" && can(role, "crm:export_sensitive"), sources: sources.column, max: EXPORT_MAX_ROWS };
  });
}
