import { message } from "../i18n/messages";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type { Transaction } from "../db/client";
import { crmFieldDefinitions } from "../db/schema";
import { customFieldKey, filterFields, permissionScopes, sortableTypes, builtinSorts, sourceRuleReferences, validateFilter, type FieldDefinition, type Filter, type FilterField, type ObjectType, type PermissionField, type SourceRule, type ViewState } from "../lib/crm-fields";
import { AccessError } from "./permissions";

export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
/** Raised for unknown fields, operands or values. Pages fall back to the default view. */
export const invalidView = () => new AccessError(400, message("Errors.thisViewHasSettingsThatAreNoLongerValid"), { reason: "invalid_view" });

export async function loadDefinitions(tx: Transaction, tenantId: string, objectType: ObjectType, includeArchived = true) {
  const rows = await tx.select().from(crmFieldDefinitions).where(and(eq(crmFieldDefinitions.tenantId, tenantId), eq(crmFieldDefinitions.objectType, objectType)))
    .orderBy(asc(crmFieldDefinitions.position), asc(crmFieldDefinitions.createdAt), asc(crmFieldDefinitions.id));
  return includeArchived ? rows : rows.filter((row) => !row.archivedAt);
}

// Outer record references are raw SQL on purpose: Drizzle renders single-table select
// columns unqualified, which inside a subquery would bind to the subquery's own table.
const recordRef = (objectType: ObjectType) => sql.raw(objectType === "person" ? "contacts.id" : "companies.id");
const valueColumn: Record<FieldDefinition["type"], string> = {
  text: "value_text", number: "value_number", date: "value_date", boolean: "value_boolean", select: "value_options", multi_select: "value_options", relation: "relation_contact_id",
};
/** Scalar expression for one custom field on the current row (NULL when unset). */
export function customExpr(tenantId: string, objectType: ObjectType, field: Pick<FieldDefinition, "id" | "type" | "relationTarget">) {
  const column = field.type === "relation" ? (field.relationTarget === "company" ? "relation_company_id" : "relation_contact_id") : valueColumn[field.type];
  const owner = objectType === "person" ? "contact_id" : "company_id";
  return sql`(select v.${sql.raw(column)} from crm_field_values v where v.tenant_id = ${tenantId} and v.field_id = ${field.id} and v.${sql.raw(owner)} = ${recordRef(objectType)})`;
}
/**
 * Effective consent state for one purpose and channel: an unsuperseded withdrawal wins (a later
 * grant must beat it on both clocks), otherwise the latest decision. The same rule as the consent
 * ledger, the contact detail and the list badge. Redacted evidence never counts.
 */
export function consentState(tenantId: string, purpose: string, channel: string) {
  return sql<"granted" | "withdrawn" | "none">`(case
    when exists (select 1 from contact_consents w where w.tenant_id = ${tenantId} and w.contact_id = contacts.id
      and w.channel = ${channel} and w.purpose = ${purpose} and w.status = 'withdrawn' and w.redacted_at is null
      and not exists (select 1 from contact_consents g where g.tenant_id = w.tenant_id and g.contact_id = w.contact_id
        and g.channel = w.channel and g.purpose = w.purpose and g.status = 'granted' and g.redacted_at is null
        and g.recorded_at > w.recorded_at and g.occurred_at > w.occurred_at)) then 'withdrawn'
    when (select l.status from contact_consents l where l.tenant_id = ${tenantId} and l.contact_id = contacts.id
      and l.channel = ${channel} and l.purpose = ${purpose} and l.redacted_at is null
      order by l.recorded_at desc, l.occurred_at desc, l.id desc limit 1) = 'granted' then 'granted'
    else 'none' end)`;
}
/** Effective marketing-email state; the same rule as the consent ledger and list badge. */
export function marketingEmailState(tenantId: string) { return consentState(tenantId, "marketing", "email"); }
export function peopleCountExpr(tenantId: string) {
  return sql<number>`(select count(*)::int from contact_company_links l where l.tenant_id = ${tenantId} and l.company_id = companies.id)`;
}

function textCondition(expr: SQL, filter: Filter): SQL {
  const value = String(filter.value ?? "");
  switch (filter.op) {
    case "contains": return sql`${expr} ilike ${likePattern(value)}`;
    case "not_contains": return sql`(${expr} is null or ${expr} not ilike ${likePattern(value)})`;
    case "is": return sql`lower(${expr}) = lower(${value})`;
    case "is_not": return sql`(${expr} is null or lower(${expr}) <> lower(${value}))`;
    case "is_empty": return sql`(${expr} is null or ${expr} = '')`;
    case "is_not_empty": return sql`(${expr} is not null and ${expr} <> '')`;
    default: throw invalidView();
  }
}
function scalarCondition(expr: SQL, filter: Filter, cast: "float8" | "date" | "boolean" | "uuid"): SQL {
  const value = sql`${String(filter.value)}::${sql.raw(cast)}`;
  switch (filter.op) {
    case "is": return sql`${expr} = ${value}`;
    case "is_not": return sql`(${expr} is null or ${expr} <> ${value})`;
    case "gte": return sql`${expr} >= ${value}`;
    case "lte": return sql`${expr} <= ${value}`;
    case "before": return sql`${expr} < ${value}`;
    case "after": return sql`${expr} > ${value}`;
    case "is_empty": return sql`${expr} is null`;
    case "is_not_empty": return sql`${expr} is not null`;
    default: throw invalidView();
  }
}
function optionsCondition(expr: SQL, filter: Filter): SQL {
  const values = Array.isArray(filter.value) ? filter.value : [];
  const list = sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`;
  switch (filter.op) {
    case "any_of": return sql`coalesce(${expr} && ${list}, false)`;
    case "none_of": return sql`not coalesce(${expr} && ${list}, false)`;
    case "is_empty": return sql`${expr} is null`;
    case "is_not_empty": return sql`${expr} is not null`;
    default: throw invalidView();
  }
}
const utcDate = (column: string) => sql.raw(`(${column} at time zone 'UTC')::date`);

/** Compile one validated filter to a WHERE condition for the current row. */
export function compileFilter(tenantId: string, objectType: ObjectType, filter: Filter, definitions: FieldDefinition[]): SQL {
  if (filter.field.startsWith("cf:")) {
    const definition = definitions.find((field) => customFieldKey(field.key) === filter.field && !field.archivedAt);
    if (!definition) throw invalidView();
    const expr = customExpr(tenantId, objectType, definition);
    switch (definition.type) {
      case "text": return textCondition(expr, filter);
      case "number": return scalarCondition(expr, filter, "float8");
      case "date": return scalarCondition(expr, filter, "date");
      case "boolean": return scalarCondition(expr, filter, "boolean");
      case "relation": return scalarCondition(expr, filter, "uuid");
      case "select": case "multi_select": return optionsCondition(expr, filter);
    }
  }
  if (objectType === "person") {
    const identifier = (kind: string) => sql`(select i.value from contact_identifiers i where i.tenant_id = ${tenantId} and i.contact_id = contacts.id and i.kind = ${kind})`;
    switch (filter.field) {
      case "name": return textCondition(sql.raw("contacts.name"), filter);
      case "email": return textCondition(identifier("email"), filter);
      case "phone": return textCondition(identifier("phone"), filter);
      case "created": return scalarCondition(utcDate("contacts.created_at"), filter, "date");
      case "updated": return scalarCondition(utcDate("contacts.updated_at"), filter, "date");
      case "marketing": case "newsletter": case "followup_email": case "followup_sms": {
        const scope = filter.field === "marketing" ? { purpose: "marketing", channel: "email" } : permissionScopes[filter.field as PermissionField];
        const state = consentState(tenantId, scope.purpose, scope.channel);
        if (filter.op === "is_empty") return sql`${state} = 'none'`;
        if (filter.op === "is_not_empty") return sql`${state} <> 'none'`;
        const values = Array.isArray(filter.value) ? filter.value : [];
        const list = sql.join(values.map((value) => sql`${value}`), sql`, `);
        return filter.op === "any_of" ? sql`${state} in (${list})` : sql`${state} not in (${list})`;
      }
      case "company": {
        const linked = (company?: string) => sql`exists (select 1 from contact_company_links l where l.tenant_id = ${tenantId} and l.contact_id = contacts.id${company ? sql` and l.company_id = ${company}::uuid` : sql``})`;
        if (filter.op === "is") return linked(String(filter.value));
        if (filter.op === "is_not") return sql`not ${linked(String(filter.value))}`;
        if (filter.op === "is_empty") return sql`not ${linked()}`;
        if (filter.op === "is_not_empty") return linked();
        throw invalidView();
      }
    }
  } else {
    switch (filter.field) {
      case "name": return textCondition(sql.raw("companies.name"), filter);
      case "domain": return textCondition(sql.raw("companies.domain"), filter);
      case "people": return scalarCondition(peopleCountExpr(tenantId), filter, "float8");
      case "created": return scalarCondition(utcDate("companies.created_at"), filter, "date");
      case "updated": return scalarCondition(utcDate("companies.updated_at"), filter, "date");
    }
  }
  throw invalidView();
}

/**
 * Validate a whole list state against the tenant's live definitions. Anything unknown
 * or ill-typed rejects the state as a whole; it is never half-applied.
 */
export function resolveState(objectType: ObjectType, state: ViewState, definitions: FieldDefinition[]) {
  const fields: FilterField[] = filterFields(objectType, definitions);
  const filters = state.filters.map((filter) => validateFilter(filter, fields));
  if (filters.some((filter) => filter === null)) throw invalidView();
  const sortKey = state.sort.replace(/^-/, "");
  const sortable = builtinSorts[objectType].includes(sortKey) || definitions.some((field) => !field.archivedAt && customFieldKey(field.key) === sortKey && sortableTypes.includes(field.type));
  if (!sortable) throw invalidView();
  return { ...state, filters: filters as Filter[] };
}

/** ORDER BY for a validated sort: built-in expressions or a scalar custom field, nulls last, id as tiebreak. */
export function sortOrder(objectType: ObjectType, sort: string, tenantId: string, definitions: FieldDefinition[], builtins: Record<string, SQL>, idExpr: SQL): SQL[] {
  const descending = sort.startsWith("-"), key = sort.replace(/^-/, "");
  const direction = sql.raw(descending ? "desc" : "asc");
  let expr: SQL | undefined = builtins[key];
  if (!expr && key.startsWith("cf:")) {
    const definition = definitions.find((field) => customFieldKey(field.key) === key && !field.archivedAt && sortableTypes.includes(field.type));
    if (definition) {
      const value = customExpr(tenantId, objectType, definition);
      expr = definition.type === "select" ? sql`(${value})[1]` : definition.type === "text" ? sql`lower(${value})` : value;
    }
  }
  if (!expr) throw invalidView();
  return [sql`${expr} ${direction} nulls last`, sql`${idExpr} ${direction}`];
}

/** Display names for relation filter values (for filter chips), tenant-scoped. */
export async function relatedFilterNames(tx: Transaction, tenantId: string, objectType: ObjectType, filters: Filter[], definitions: FieldDefinition[]) {
  const names = new Map<string, string>();
  const ids = { person: new Set<string>(), company: new Set<string>() };
  for (const filter of filters) {
    if (typeof filter.value !== "string" || (filter.op !== "is" && filter.op !== "is_not")) continue;
    if (objectType === "person" && filter.field === "company") ids.company.add(filter.value);
    const definition = definitions.find((field) => customFieldKey(field.key) === filter.field && field.type === "relation");
    if (definition?.relationTarget) ids[definition.relationTarget].add(filter.value);
  }
  if (ids.person.size) {
    const rows = await tx.execute(sql`select id::text, name from contacts where tenant_id = ${tenantId} and erased_at is null and id in (${sql.join([...ids.person].map((id) => sql`${id}::uuid`), sql`, `)})`);
    for (const row of rows.rows as { id: string; name: string }[]) names.set(row.id, row.name);
  }
  if (ids.company.size) {
    const rows = await tx.execute(sql`select id::text, name from companies where tenant_id = ${tenantId} and id in (${sql.join([...ids.company].map((id) => sql`${id}::uuid`), sql`, `)})`);
    for (const row of rows.rows as { id: string; name: string }[]) names.set(row.id, row.name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// HC-06C source rules.

/** Source rules need the owner/admin source capability. Raised before any SQL is built. */
export const sourceAccessDenied = () => new AccessError(403, message("Errors.sourceFiltersUnavailable"), { reason: "source_access" });
/** A rule names a campaign, link or form version that is not in this workspace (any more). */
export const invalidSourceRule = () => new AccessError(400, message("Errors.sourceFiltersUnavailable"), { reason: "invalid_source" });
export const isSourceLock = (error: unknown) => error instanceof AccessError && (error.details?.reason === "source_access" || error.details?.reason === "invalid_source");

/**
 * Check every campaign, link and form version a rule names against this tenant, and return
 * display names for chips. Missing references fail closed: an exclusion of a source that is no
 * longer resolvable must never silently become "exclude nothing".
 */
export async function resolveSourceReferences(tx: Transaction, tenantId: string, rules: SourceRule[]) {
  const names = new Map<string, string>();
  const refs = sourceRuleReferences(rules);
  const ids = (values: string[]) => sql.join(values.map((id) => sql`${id}::uuid`), sql`, `);
  if (refs.campaigns.length) {
    const rows = (await tx.execute(sql`select id::text, name, archived_at is not null as archived from campaigns where tenant_id = ${tenantId} and id in (${ids(refs.campaigns)})`)).rows as { id: string; name: string; archived: boolean }[];
    if (rows.length !== refs.campaigns.length) throw invalidSourceRule();
    for (const row of rows) names.set(row.id, row.archived ? message("Crm.sourceFilters.archivedName", { name: row.name }) : row.name);
  }
  if (refs.links.length) {
    const rows = (await tx.execute(sql`select id::text, coalesce(nullif(btrim(label), ''), short_code) as name, archived_at is not null as archived from campaign_response_links where tenant_id = ${tenantId} and id in (${ids(refs.links)})`)).rows as { id: string; name: string; archived: boolean }[];
    if (rows.length !== refs.links.length) throw invalidSourceRule();
    for (const row of rows) names.set(row.id, row.archived ? message("Crm.sourceFilters.archivedName", { name: row.name }) : row.name);
  }
  if (refs.forms.length) {
    const rows = (await tx.execute(sql`select v.id::text, f.name, v.version from form_versions v join forms f on f.tenant_id = v.tenant_id and f.id = v.form_id where v.tenant_id = ${tenantId} and v.id in (${ids(refs.forms)})`)).rows as { id: string; name: string; version: number }[];
    if (rows.length !== refs.forms.length) throw invalidSourceRule();
    for (const row of rows) names.set(row.id, message("Crm.sourceFilters.formVersion", { name: row.name, version: row.version }));
  }
  return names;
}

/**
 * Retained, unreverted source events of the current contact. Row security already limits
 * contact_source_events and campaign_responses to owners/admins and hides Connect evidence whose
 * response is no longer associated and unexpired, so this is exactly what the Source column shows.
 */
function sourceEvents(tenantId: string, order: "first" | "latest" | "any") {
  const base = sql`select s.id, s.kind, s.occurred_at, s.entry_route, r.campaign_id, r.link_id, r.form_version_id
    from contact_source_events s left join campaign_responses r on r.tenant_id = s.tenant_id and r.id = s.response_id
    where s.tenant_id = ${tenantId} and s.contact_id = contacts.id and s.reverted_at is null`;
  if (order === "any") return base;
  const direction = sql.raw(order === "first" ? "asc" : "desc");
  return sql`${base} order by s.occurred_at ${direction}, s.id ${direction} limit 1`;
}
function ruleMatches(tenantId: string, rule: SourceRule): SQL {
  if (rule.kinds.includes("unknown")) return sql`not exists (${sourceEvents(tenantId, "any")})`;
  const list = (values: string[], cast: string) => sql.join(values.map((value) => sql`${value}::${sql.raw(cast)}`), sql`, `);
  const conditions: SQL[] = [sql`true`];
  if (rule.kinds.length) conditions.push(sql`e.kind in (${list(rule.kinds, "text")})`);
  if (rule.campaigns.length) conditions.push(sql`e.campaign_id in (${list(rule.campaigns, "uuid")})`);
  if (rule.links.length) conditions.push(sql`e.link_id in (${list(rule.links, "uuid")})`);
  if (rule.forms.length) conditions.push(sql`e.form_version_id in (${list(rule.forms, "uuid")})`);
  if (rule.route) conditions.push(sql`e.entry_route = ${rule.route}`);
  if (rule.from) conditions.push(sql`(e.occurred_at at time zone 'UTC')::date >= ${rule.from}::date`);
  if (rule.to) conditions.push(sql`(e.occurred_at at time zone 'UTC')::date <= ${rule.to}::date`);
  return sql`exists (select 1 from (${sourceEvents(tenantId, rule.match)}) e where ${sql.join(conditions, sql` and `)})`;
}
/**
 * One WHERE condition for all source rules: any included rule (a union), minus every contact
 * matching any excluded rule (NOT EXISTS, so several events never duplicate or leak a contact).
 */
export function compileSourceRules(tenantId: string, rules: SourceRule[], sourceAccess: boolean): SQL | undefined {
  if (!rules.length) return undefined;
  if (!sourceAccess) throw sourceAccessDenied();
  const included = rules.filter((rule) => rule.mode === "include").map((rule) => ruleMatches(tenantId, rule));
  const excluded = rules.filter((rule) => rule.mode === "exclude").map((rule) => sql`not ${ruleMatches(tenantId, rule)}`);
  return and(...(included.length ? [sql`(${sql.join(included, sql` or `)})`] : []), ...excluded);
}
