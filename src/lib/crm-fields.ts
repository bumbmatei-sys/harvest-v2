import { z } from "zod";

/**
 * CRM-03 shared model: custom field definitions, typed values, the filter language,
 * list columns and saved-view state. Pure and client-safe so the UI and the server
 * validate with the same rules; the server re-validates everything against the
 * tenant's field definitions before any SQL is built.
 */
export const objectTypes = ["person", "company"] as const;
export type ObjectType = typeof objectTypes[number];
export const fieldTypes = ["text", "number", "date", "boolean", "select", "multi_select", "relation"] as const;
export type FieldType = typeof fieldTypes[number];
export type FieldOption = { value: string; label: string };
export type FieldDefinition = {
  id: string; objectType: ObjectType; key: string; label: string; description: string; type: FieldType;
  required: boolean; options: FieldOption[]; relationTarget: ObjectType | null; archivedAt: Date | string | null; position: number; version: number;
};

export const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;
export const OPTION_VALUE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** A readable machine key from a label: "Home church" → "home_church". */
export function slugifyKey(label: string) {
  const slug = label.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z]/.test(slug) ? slug : `field_${slug}`.slice(0, 40).replace(/_+$/, "");
}
export function slugifyOption(label: string) {
  const slug = label.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || "option";
}

const option = z.object({ value: z.string().regex(OPTION_VALUE), label: z.string().trim().min(1).max(60) }).strict();
const options = z.array(option).max(50).refine((list) => new Set(list.map((item) => item.value)).size === list.length);
const label = z.string().trim().min(1).max(60);
const description = z.string().trim().max(280);
export const fieldDefinitionInput = z.object({
  objectType: z.enum(objectTypes), label, key: z.string().regex(FIELD_KEY).optional(), type: z.enum(fieldTypes),
  description: description.default(""), required: z.boolean().default(false), options: options.default([]),
  relationTarget: z.enum(objectTypes).nullable().default(null),
}).strict().superRefine((value, context) => {
  const choice = value.type === "select" || value.type === "multi_select";
  if (choice !== value.options.length > 0) context.addIssue({ code: "custom", path: ["options"], message: "OPTIONS" });
  if ((value.type === "relation") !== (value.relationTarget !== null)) context.addIssue({ code: "custom", path: ["relationTarget"], message: "RELATION_TARGET" });
});
export type FieldDefinitionInput = z.input<typeof fieldDefinitionInput>;
export const fieldDefinitionPatch = z.object({
  label: label.optional(), description: description.optional(), required: z.boolean().optional(), options: options.optional(),
  archived: z.boolean().optional(), version: z.number().int().min(1),
}).strict();
export type FieldDefinitionPatch = z.input<typeof fieldDefinitionPatch>;

/** One custom value as sent by a client: null clears it. */
export type FieldValue = string | number | boolean | string[] | null;
export function valueSchema(field: Pick<FieldDefinition, "type" | "options">) {
  const allowed = new Set(field.options.map((item) => item.value));
  switch (field.type) {
    case "text": return z.string().trim().min(1).max(500);
    case "number": return z.number().finite().min(-1e15).max(1e15);
    case "date": return z.iso.date();
    case "boolean": return z.boolean();
    case "select": return z.string().refine((value) => allowed.has(value));
    case "multi_select": return z.array(z.string().refine((value) => allowed.has(value))).min(1).max(50).refine((list) => new Set(list).size === list.length);
    case "relation": return z.uuid();
  }
}
export const recordFieldsPatch = z.object({
  values: z.record(z.string().regex(FIELD_KEY), z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])).refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 50),
  version: z.number().int().min(1),
}).strict();
export type RecordFieldsPatch = z.input<typeof recordFieldsPatch>;

// ---------------------------------------------------------------------------
// Filters: `field~operand~value`. Field is a built-in key or `cf:<key>`.
export const operands = ["contains", "not_contains", "is", "is_not", "is_empty", "is_not_empty", "gte", "lte", "before", "after", "any_of", "none_of"] as const;
export type Operand = typeof operands[number];
/** Operands per filterable type, modelled on Twenty's per-type operand table. */
export const operandsByType: Record<FieldType, readonly Operand[]> = {
  text: ["contains", "not_contains", "is", "is_not", "is_empty", "is_not_empty"],
  number: ["is", "is_not", "gte", "lte", "is_empty", "is_not_empty"],
  date: ["is", "before", "after", "is_empty", "is_not_empty"],
  boolean: ["is"],
  select: ["any_of", "none_of", "is_empty", "is_not_empty"],
  multi_select: ["any_of", "none_of", "is_empty", "is_not_empty"],
  relation: ["is", "is_not", "is_empty", "is_not_empty"],
};
export const valuelessOperands: readonly Operand[] = ["is_empty", "is_not_empty"];
export type FilterValue = string | string[] | null;
export type Filter = { field: string; op: Operand; value: FilterValue };
export const MAX_FILTERS = 10;

/** A filterable field as the filter builder and compiler see it. */
export type FilterField = { key: string; type: FieldType; options?: FieldOption[]; relationTarget?: ObjectType | null; builtin: boolean; label?: string };

export const builtinFields: Record<ObjectType, FilterField[]> = {
  person: [
    { key: "name", type: "text", builtin: true }, { key: "email", type: "text", builtin: true }, { key: "phone", type: "text", builtin: true },
    { key: "company", type: "relation", relationTarget: "company", builtin: true },
    { key: "marketing", type: "select", builtin: true, options: [{ value: "granted", label: "granted" }, { value: "withdrawn", label: "withdrawn" }, { value: "none", label: "none" }] },
    { key: "created", type: "date", builtin: true }, { key: "updated", type: "date", builtin: true },
  ],
  company: [
    { key: "name", type: "text", builtin: true }, { key: "domain", type: "text", builtin: true }, { key: "people", type: "number", builtin: true },
    { key: "created", type: "date", builtin: true }, { key: "updated", type: "date", builtin: true },
  ],
};
export function customFieldKey(key: string) { return `cf:${key}`; }
export function filterFields(objectType: ObjectType, definitions: Pick<FieldDefinition, "key" | "type" | "options" | "relationTarget" | "archivedAt" | "label">[]): FilterField[] {
  return [...builtinFields[objectType], ...definitions.filter((field) => !field.archivedAt).map((field) => ({ key: customFieldKey(field.key), type: field.type, options: field.options, relationTarget: field.relationTarget, builtin: false, label: field.label }))];
}

export function serializeFilter(filter: Filter) {
  const value = filter.value === null ? "" : Array.isArray(filter.value) ? filter.value.join(",") : filter.value;
  return `${filter.field}~${filter.op}~${value}`;
}
/** Syntax only. Field existence and value types are checked by validateFilter. */
export function parseFilter(raw: string): Filter | null {
  const first = raw.indexOf("~"), second = first < 0 ? -1 : raw.indexOf("~", first + 1);
  if (first < 1 || second < 0) return null;
  const field = raw.slice(0, first), op = raw.slice(first + 1, second), value = raw.slice(second + 1);
  if (!/^(cf:)?[a-z][a-z0-9_]{0,39}$/.test(field) || !(operands as readonly string[]).includes(op) || value.length > 500) return null;
  return { field, op: op as Operand, value: value === "" ? null : value };
}
/** Type-check one filter against the available fields. Returns the normalized filter or null. */
export function validateFilter(filter: Filter, fields: FilterField[]): Filter | null {
  const field = fields.find((item) => item.key === filter.field);
  if (!field || !operandsByType[field.type].includes(filter.op)) return null;
  if (valuelessOperands.includes(filter.op)) return filter.value === null || filter.value === "" ? { ...filter, value: null } : null;
  const raw = Array.isArray(filter.value) ? filter.value.join(",") : filter.value;
  if (raw === null || raw === "") return null;
  switch (field.type) {
    case "text": return raw.trim() ? { ...filter, value: raw.trim() } : null;
    case "number": return /^-?\d{1,15}(\.\d{1,6})?$/.test(raw) ? { ...filter, value: raw } : null;
    case "date": return z.iso.date().safeParse(raw).success ? { ...filter, value: raw } : null;
    case "boolean": return raw === "true" || raw === "false" ? { ...filter, value: raw } : null;
    case "select": case "multi_select": {
      const values = raw.split(","), allowed = new Set((field.options ?? []).map((item) => item.value));
      return values.length <= 50 && values.every((value) => allowed.has(value)) && new Set(values).size === values.length ? { ...filter, value: values } : null;
    }
    case "relation": return z.uuid().safeParse(raw).success ? { ...filter, value: raw } : null;
  }
}

// ---------------------------------------------------------------------------
// Columns. Name is always first and not configurable.
export type ColumnSpec = { key: string; width: number };
export const builtinColumns: Record<ObjectType, ColumnSpec[]> = {
  person: [{ key: "source", width: 160 }, { key: "company", width: 192 }, { key: "email", width: 224 }, { key: "phone", width: 144 }, { key: "marketing", width: 136 }, { key: "created", width: 112 }, { key: "updated", width: 112 }],
  company: [{ key: "domain", width: 240 }, { key: "people", width: 88 }, { key: "created", width: 112 }, { key: "updated", width: 112 }],
};
export const defaultColumns: Record<ObjectType, string[]> = { person: ["company", "email", "phone", "marketing", "created"], company: ["domain", "people", "created"] };
export const NAME_MIN_WIDTH = 224;
export const customColumnWidth: Record<FieldType, number> = { text: 192, number: 112, date: 120, boolean: 96, select: 144, multi_select: 192, relation: 192 };
export function columnSpecs(objectType: ObjectType, definitions: Pick<FieldDefinition, "key" | "type" | "archivedAt">[]): ColumnSpec[] {
  return [...builtinColumns[objectType], ...definitions.filter((field) => !field.archivedAt).map((field) => ({ key: customFieldKey(field.key), width: customColumnWidth[field.type] }))];
}
export const MAX_COLUMNS = 20;
export function parseColumns(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  if (raw === "") return [];
  const list = raw.split(",");
  return list.length <= MAX_COLUMNS && list.every((key) => /^(cf:)?[a-z][a-z0-9_]{0,39}$/.test(key)) && new Set(list).size === list.length ? list : null;
}

// ---------------------------------------------------------------------------
// Sorts: built-in keys plus scalar custom fields, `-` prefix for descending.
export const builtinSorts: Record<ObjectType, string[]> = { person: ["name", "created", "updated"], company: ["name", "created", "people"] };
export const sortableTypes: readonly FieldType[] = ["text", "number", "date", "boolean", "select"];
export const defaultSort = "name";

// ---------------------------------------------------------------------------
// Saved views.
export const densities = ["comfortable", "compact"] as const;
export type Density = typeof densities[number];
export const viewState = z.object({
  q: z.string().trim().max(100).default(""),
  sort: z.string().regex(/^-?(cf:)?[a-z][a-z0-9_]{0,39}$/).default(defaultSort),
  filters: z.array(z.object({ field: z.string().max(43), op: z.enum(operands), value: z.union([z.string().max(500), z.array(z.string().max(40)).max(50), z.null()]) }).strict()).max(MAX_FILTERS).default([]),
  columns: z.array(z.string().regex(/^(cf:)?[a-z][a-z0-9_]{0,39}$/)).max(MAX_COLUMNS).nullable().default(null),
  density: z.enum(densities).default("comfortable"),
}).strict();
export type ViewState = z.output<typeof viewState>;
export const viewInput = z.object({ objectType: z.enum(objectTypes), name: z.string().trim().min(1).max(60), shared: z.boolean().default(false), state: viewState }).strict();
export type ViewInput = z.input<typeof viewInput>;
export const viewPatch = z.object({ name: z.string().trim().min(1).max(60).optional(), shared: z.boolean().optional(), state: viewState.optional(), version: z.number().int().min(1) }).strict();
export type ViewPatch = z.input<typeof viewPatch>;

/** Built-in, read-only views. Names are message keys under Crm.systemViews. */
export const systemViews: Record<ObjectType, { id: string; name: string; state: Partial<ViewState> }[]> = {
  person: [
    { id: "system:all-people", name: "allPeople", state: {} },
    { id: "system:email-subscribers", name: "emailSubscribers", state: { filters: [{ field: "marketing", op: "any_of", value: ["granted"] }] } },
    { id: "system:unsubscribed", name: "unsubscribed", state: { filters: [{ field: "marketing", op: "any_of", value: ["withdrawn"] }] } },
    { id: "system:no-email-decision", name: "noEmailDecision", state: { filters: [{ field: "marketing", op: "any_of", value: ["none"] }] } },
    { id: "system:no-company", name: "noCompany", state: { filters: [{ field: "company", op: "is_empty", value: null }] } },
  ],
  company: [
    { id: "system:all-companies", name: "allCompanies", state: {} },
    { id: "system:with-people", name: "withPeople", state: { filters: [{ field: "people", op: "gte", value: "1" }] } },
    { id: "system:no-domain", name: "noDomain", state: { filters: [{ field: "domain", op: "is_empty", value: null }] } },
  ],
};
export function fullState(state: Partial<ViewState>): ViewState { return viewState.parse(state); }

/** The URL is the state while browsing. These are the only list parameters. */
export function stateToParams(state: ViewState, view?: string | null) {
  const params = new URLSearchParams();
  if (view) params.set("view", view);
  // A view id alone restores saved state. Keep an explicit state key even when
  // clearing the final condition returns every setting to its default.
  if (state.q || view) params.set("q", state.q);
  if (state.sort !== defaultSort) params.set("sort", state.sort);
  for (const filter of state.filters) params.append("f", serializeFilter(filter));
  if (state.columns) params.set("cols", state.columns.join(","));
  if (state.density !== "comfortable") params.set("density", state.density);
  return params;
}
export type RawParams = Record<string, string | number | string[] | undefined>;
const one = (value: RawParams[string]) => (value === undefined ? undefined : Array.isArray(value) ? value[0] : String(value));
const many = (value: RawParams[string]) => (value === undefined ? [] : Array.isArray(value) ? value : [String(value)]);
/**
 * Read list state from URL parameters (syntax only). CRM-02 shareable parameters
 * (company, email, marketing for people; people, domain for companies) keep working
 * by becoming the equivalent filters.
 */
export function paramsToState(objectType: ObjectType, raw: RawParams): { state: ViewState; page: number; view: string | null } | null {
  const filters: Filter[] = [];
  for (const entry of many(raw.f)) { const filter = parseFilter(entry); if (!filter) return null; filters.push(filter); }
  const legacy = objectType === "person" ? {
    company: one(raw.company), email: one(raw.email), marketing: one(raw.marketing),
  } : { people: one(raw.people), domain: one(raw.domain) };
  if ("company" in legacy && legacy.company !== undefined) {
    if (legacy.company === "any") filters.push({ field: "company", op: "is_not_empty", value: null });
    else if (legacy.company === "none") filters.push({ field: "company", op: "is_empty", value: null });
    else filters.push({ field: "company", op: "is", value: legacy.company });
  }
  if ("email" in legacy && legacy.email !== undefined) {
    if (legacy.email !== "with" && legacy.email !== "without") return null;
    filters.push({ field: "email", op: legacy.email === "with" ? "is_not_empty" : "is_empty", value: null });
  }
  if ("marketing" in legacy && legacy.marketing !== undefined) filters.push({ field: "marketing", op: "any_of", value: legacy.marketing });
  if ("people" in legacy && legacy.people !== undefined) {
    if (legacy.people !== "any" && legacy.people !== "none") return null;
    filters.push(legacy.people === "any" ? { field: "people", op: "gte", value: "1" } : { field: "people", op: "lte", value: "0" });
  }
  if ("domain" in legacy && legacy.domain !== undefined) {
    if (legacy.domain !== "with" && legacy.domain !== "without") return null;
    filters.push({ field: "domain", op: legacy.domain === "with" ? "is_not_empty" : "is_empty", value: null });
  }
  const columns = parseColumns(one(raw.cols));
  if (one(raw.cols) !== undefined && columns === null) return null;
  const parsed = viewState.safeParse({ q: one(raw.q) ?? "", sort: one(raw.sort) ?? defaultSort, filters, columns, density: one(raw.density) ?? "comfortable" });
  const page = z.coerce.number().int().min(1).max(100000).safeParse(one(raw.page) ?? "1");
  const view = one(raw.view);
  if (!parsed.success || !page.success || (view !== undefined && !/^(system:[a-z-]{1,40}|[0-9a-f-]{36})$/.test(view))) return null;
  return { state: parsed.data, page: page.data, view: view ?? null };
}
/** Two states are the same view if they would produce the same URL. */
export function sameState(a: ViewState, b: ViewState) { return stateToParams(a).toString() === stateToParams(b).toString(); }
