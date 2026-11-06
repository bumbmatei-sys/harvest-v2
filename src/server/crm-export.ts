import { message } from "../i18n/messages";
import { and, count, eq, getTableColumns, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { auditLogs, companies, contactCompanyLinks, contactIdentifiers, contacts } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { paramsToState, type FieldDefinition, type FieldValue, type RawParams } from "../lib/crm-fields";
import { CSV_BOM, csvLine } from "../lib/csv";
import { invalidView, loadDefinitions, marketingEmailState, peopleCountExpr, resolveState } from "./crm-filters";
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
    const filtered = Boolean(state.q || state.filters.length);
    const lines: string[] = [];
    let total = 0;
    if (entity === "person") {
      const { where, order } = peopleQuery(tx, tenantId, state, definitions);
      lines.push(csvLine([message("Exports.columns.name"), message("Exports.columns.email"), message("Exports.columns.phone"), message("Exports.columns.social"),
        message("Exports.columns.company"), message("Exports.columns.title"), message("Exports.columns.emailMarketing"), message("Exports.columns.created"), message("Exports.columns.updated"),
        ...(sensitive ? [message("Exports.columns.notes")] : []), ...active.map((field) => field.label)]));
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
        for (const row of rows) {
          const value = (kind: string) => identifiers.find((item) => item.contactId === row.id && item.kind === kind)?.value ?? "";
          const link = links.find((item) => item.contactId === row.id);
          lines.push(csvLine([row.name, value("email"), value("phone"), value("social"), link?.name ?? "", link?.title ?? "",
            message(`Crm.marketing.${row.marketing as "granted" | "withdrawn" | "none"}`), row.createdAt.toISOString(), row.updatedAt.toISOString(),
            ...(sensitive ? [row.notes] : []), ...active.map((field) => formatValue(field, values.get(row.id)?.[field.key], related))]));
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
      metadata: { entity, rows: String(total), filtered: String(filtered), notes: String(sensitive && entity === "person") } });
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
    const { where } = entity === "person" ? peopleQuery(tx, tenantId, state, definitions) : companiesQuery(tenantId, state, definitions);
    const table = entity === "person" ? contacts : companies;
    const [{ total }] = await tx.select({ total: count() }).from(table).where(where);
    return { total, notes: entity === "person" && can(role, "crm:export_sensitive"), max: EXPORT_MAX_ROWS };
  });
}
