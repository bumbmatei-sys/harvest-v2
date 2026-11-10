import type { getFormatter, getTranslations } from "next-intl/server";
import { builtinFields, builtinSorts, columnSpecs, customFieldKey, defaultColumns, sortableTypes, type FieldDefinition, type FieldValue, type ObjectType, type ViewState } from "@/lib/crm-fields";
import type { SavedView } from "@/server/crm-views";
import type { FieldMeta } from "./filter-builder";
import type { EditSpec, GridCell, GridColumn } from "./record-grid";
import type { ViewSummary } from "./view-menu";

type T = Awaited<ReturnType<typeof getTranslations<"Crm">>>;
type Format = Awaited<ReturnType<typeof getFormatter>>;

export function builtinLabel(t: T, objectType: ObjectType, key: string) {
  const labels: Record<string, string> = objectType === "person"
    ? { source: t("sourceHistory.column"), name: t("name"), email: t("email"), phone: t("phone"), company: t("company"), marketing: t("emailMarketing"), created: t("added"), updated: t("updatedColumn") }
    : { name: t("name"), domain: t("fields.domain"), people: t("people"), created: t("added"), updated: t("updatedColumn") };
  return labels[key] ?? key;
}

/** A calendar date (YYYY-MM-DD) shown in the viewer's locale without a timezone shift. */
export function formatCalendarDate(format: Format, value: string) {
  return format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
}

/** Display text for one custom value. */
export function customText(t: T, format: Format, field: FieldDefinition, value: FieldValue | undefined, related: Record<string, string>) {
  if (value === undefined || value === null) return null;
  switch (field.type) {
    case "number": return format.number(value as number);
    case "date": return formatCalendarDate(format, value as string);
    case "boolean": return value ? t("yes") : t("no");
    case "select": return field.options.find((option) => option.value === value)?.label ?? String(value);
    case "multi_select": return (value as string[]).map((item) => field.options.find((option) => option.value === item)?.label ?? item).join(", ");
    case "relation": return related[value as string] ?? t("unavailableRecord");
    default: return String(value);
  }
}

export function customCell(t: T, format: Format, tenantId: string, field: FieldDefinition, value: FieldValue | undefined, related: Record<string, string>): GridCell {
  const text = customText(t, format, field, value, related);
  const editable = ["text", "number", "date", "boolean", "select"].includes(field.type);
  const edit: EditSpec | undefined = editable ? {
    kind: field.type as EditSpec["kind"], target: "custom", field: field.key, options: field.options,
    value: value === undefined || value === null ? "" : String(value),
  } : undefined;
  const href = field.type === "relation" && typeof value === "string" && related[value] ? `/workspaces/${tenantId}/crm/${field.relationTarget === "company" ? "companies" : "people"}/${value}` : undefined;
  return { text: text ?? t("empty"), muted: text === null, href, edit };
}

/** Everything the toolbar and grid need that depends on the tenant's field definitions. */
export function listParts(t: T, objectType: ObjectType, definitions: FieldDefinition[], state: ViewState, views: SavedView[], sourceAccess = false) {
  const fields: FieldMeta[] = [
    ...builtinFields[objectType].map((field) => ({ ...field, label: builtinLabel(t, objectType, field.key), options: field.key === "marketing" ? field.options?.map((option) => ({ value: option.value, label: t(`marketing.${option.value as "granted"}`) })) : field.options })),
    ...definitions.map((field) => ({ key: customFieldKey(field.key), type: field.type, options: field.options, relationTarget: field.relationTarget, builtin: false, label: field.label })),
  ];
  const sorts = [
    ...builtinSorts[objectType].map((key) => ({ value: key, label: builtinLabel(t, objectType, key) })),
    ...definitions.filter((field) => sortableTypes.includes(field.type)).map((field) => ({ value: customFieldKey(field.key), label: field.label })),
  ];
  const specs = columnSpecs(objectType, definitions).filter(spec => spec.key !== "source" || sourceAccess);
  const label = (key: string) => (key.startsWith("cf:") ? definitions.find((field) => customFieldKey(field.key) === key)?.label ?? key : builtinLabel(t, objectType, key));
  const available = specs.map((spec) => ({ key: spec.key, label: label(spec.key) }));
  // Columns that no longer exist (an archived field) are simply left out of the grid.
  const visible = (state.columns ?? defaultColumns[objectType]).filter((key) => specs.some((spec) => spec.key === key));
  const gridColumns: GridColumn[] = visible.map((key) => {
    const spec = specs.find((item) => item.key === key)!, field = definitions.find((item) => customFieldKey(item.key) === key);
    return { key, label: label(key), width: spec.width, numeric: key === "people" || field?.type === "number" };
  });
  const summaries: ViewSummary[] = views.map((view) => ({ id: view.id, name: view.name, kind: view.kind, state: view.state, version: view.version }));
  return { fields, sorts, available, visible, gridColumns, summaries };
}
