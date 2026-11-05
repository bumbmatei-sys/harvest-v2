import { message } from "../i18n/messages";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { auditLogs, companies, contacts, crmFieldDefinitions, crmFieldValues } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { fieldDefinitionInput, fieldDefinitionPatch, objectTypes, recordFieldsPatch, slugifyKey, valueSchema, type FieldDefinition, type FieldDefinitionInput, type FieldDefinitionPatch, type FieldValue, type ObjectType, type RecordFieldsPatch } from "../lib/crm-fields";
import { loadDefinitions } from "./crm-filters";
import { AccessError, type Permission } from "./permissions";
import { withTenant } from "./tenancy";
import { z } from "zod";

const objectInput = z.enum(objectTypes);
const fieldMissing = () => new AccessError(404, message("Errors.thisFieldIsNotAvailable"));
const stale = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
const writePermission = (objectType: ObjectType): Permission => (objectType === "person" ? "contacts:write" : "companies:write");
const readPermission = (objectType: ObjectType): Permission => (objectType === "person" ? "contacts:read" : "companies:read");
function pgCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return pgCode(error.cause);
}

export function listFieldDefinitions(db: Database, userId: string, workspace: string, objectType: ObjectType, options: { includeArchived?: boolean } = {}) {
  const type = objectInput.parse(objectType);
  return withTenant(db, userId, uuidInput.parse(workspace), readPermission(type), (tx, tenantId) => loadDefinitions(tx, tenantId, type, options.includeArchived ?? true));
}

/** Schema changes affect every member, so only owners and admins manage definitions. */
export async function createFieldDefinition(db: Database, userId: string, workspace: string, data: FieldDefinitionInput) {
  const input = fieldDefinitionInput.parse(data);
  try {
    return await withTenant(db, userId, uuidInput.parse(workspace), "crm:fields_write", async (tx, tenantId) => {
      const existing = await loadDefinitions(tx, tenantId, input.objectType);
      const key = input.key ?? slugifyKey(input.label);
      const [row] = await tx.insert(crmFieldDefinitions).values({
        tenantId, objectType: input.objectType, key, label: input.label, description: input.description, type: input.type,
        required: input.required, options: input.options, relationTarget: input.relationTarget, position: existing.length, createdBy: userId,
      }).returning();
      await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "crm.field_create", targetId: row.id, metadata: { objectType: row.objectType, type: row.type } });
      return row;
    });
  } catch (error) {
    if (pgCode(error) === "23505") throw new AccessError(409, message("Errors.aFieldWithThisKeyAlreadyExists"));
    throw error;
  }
}

/** Label, description, required, options and archive state. Key and type never change. */
export function updateFieldDefinition(db: Database, userId: string, workspace: string, field: string, data: FieldDefinitionPatch) {
  const { version, archived, ...input } = fieldDefinitionPatch.parse(data), id = uuidInput.parse(field);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:fields_write", async (tx, tenantId) => {
    const [current] = await tx.select().from(crmFieldDefinitions).where(and(eq(crmFieldDefinitions.tenantId, tenantId), eq(crmFieldDefinitions.id, id))).for("update");
    if (!current) throw fieldMissing();
    if (current.version !== version) throw stale();
    if (input.options !== undefined) {
      const choice = current.type === "select" || current.type === "multi_select";
      if (!choice || input.options.length === 0) throw new AccessError(400, message("Errors.checkTheFieldValue"));
      // An option still used by a record cannot be removed (values would become invalid).
      const removed = current.options.map((option) => option.value).filter((value) => !input.options!.some((option) => option.value === value));
      if (removed.length) {
        const [{ used }] = await tx.select({ used: sql<number>`count(*)::int` }).from(crmFieldValues)
          .where(and(eq(crmFieldValues.tenantId, tenantId), eq(crmFieldValues.fieldId, id), sql`${crmFieldValues.valueOptions} && ${sql`array[${sql.join(removed.map((value) => sql`${value}`), sql`, `)}]::text[]`}`));
        if (used > 0) throw new AccessError(409, message("Errors.anOptionIsStillInUse"));
      }
    }
    const changed = (["label", "description", "required", "options"] as const).filter((key) => input[key] !== undefined && JSON.stringify(input[key]) !== JSON.stringify(current[key]));
    const archiveChange = archived === undefined ? null : archived && !current.archivedAt ? "archive" : !archived && current.archivedAt ? "restore" : null;
    if (!changed.length && !archiveChange) return current;
    const [row] = await tx.update(crmFieldDefinitions).set({
      ...Object.fromEntries(changed.map((key) => [key, input[key]])),
      ...(archiveChange ? { archivedAt: archiveChange === "archive" ? new Date() : null } : {}),
      updatedAt: new Date(), version: sql`${crmFieldDefinitions.version} + 1`,
    }).where(and(eq(crmFieldDefinitions.tenantId, tenantId), eq(crmFieldDefinitions.id, id), eq(crmFieldDefinitions.version, version))).returning();
    if (!row) throw stale();
    const action = archiveChange === "archive" ? "crm.field_archive" : archiveChange === "restore" ? "crm.field_restore" : "crm.field_update";
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action, targetId: id, metadata: changed.length ? { fields: changed.join(",") } : {} });
    return row;
  });
}

export type StoredValue = typeof crmFieldValues.$inferSelect;
/** Read the typed column of a stored value back into the client representation. */
export function readValue(field: Pick<FieldDefinition, "type" | "relationTarget">, row: StoredValue | undefined): FieldValue {
  if (!row) return null;
  switch (field.type) {
    case "text": return row.valueText;
    case "number": return row.valueNumber;
    case "date": return row.valueDate;
    case "boolean": return row.valueBoolean;
    case "select": return row.valueOptions?.[0] ?? null;
    case "multi_select": return row.valueOptions ?? null;
    case "relation": return field.relationTarget === "company" ? row.relationCompanyId : row.relationContactId;
  }
}
function storedColumns(field: Pick<FieldDefinition, "type" | "relationTarget">, value: Exclude<FieldValue, null>) {
  const empty = { valueText: null, valueNumber: null, valueDate: null, valueBoolean: null, valueOptions: null, relationContactId: null, relationCompanyId: null };
  switch (field.type) {
    case "text": return { ...empty, valueText: value as string };
    case "number": return { ...empty, valueNumber: value as number };
    case "date": return { ...empty, valueDate: value as string };
    case "boolean": return { ...empty, valueBoolean: value as boolean };
    case "select": return { ...empty, valueOptions: [value as string] };
    case "multi_select": return { ...empty, valueOptions: value as string[] };
    case "relation": return field.relationTarget === "company" ? { ...empty, relationCompanyId: value as string } : { ...empty, relationContactId: value as string };
  }
}

/** Custom values for a set of records, keyed by record id then field key, with related-record names. */
export async function loadRecordValues(tx: Transaction, tenantId: string, objectType: ObjectType, recordIds: string[], definitions: FieldDefinition[]) {
  const result = new Map<string, Record<string, FieldValue>>();
  const related = new Map<string, string>();
  if (!recordIds.length || !definitions.length) return { values: result, related };
  const owner = objectType === "person" ? crmFieldValues.contactId : crmFieldValues.companyId;
  const rows = await tx.select().from(crmFieldValues).where(and(eq(crmFieldValues.tenantId, tenantId), inArray(owner, recordIds), inArray(crmFieldValues.fieldId, definitions.map((field) => field.id))));
  for (const row of rows) {
    const field = definitions.find((item) => item.id === row.fieldId)!, recordId = (objectType === "person" ? row.contactId : row.companyId)!;
    result.set(recordId, { ...result.get(recordId), [field.key]: readValue(field, row) });
  }
  const contactIds = [...new Set(rows.map((row) => row.relationContactId).filter((value): value is string => !!value))];
  const companyIds = [...new Set(rows.map((row) => row.relationCompanyId).filter((value): value is string => !!value))];
  if (contactIds.length) for (const row of await tx.select({ id: contacts.id, name: contacts.name }).from(contacts).where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, contactIds), isNull(contacts.erasedAt)))) related.set(row.id, row.name);
  if (companyIds.length) for (const row of await tx.select({ id: companies.id, name: companies.name }).from(companies).where(and(eq(companies.tenantId, tenantId), inArray(companies.id, companyIds)))) related.set(row.id, row.name);
  return { values: result, related };
}

/**
 * Set or clear custom values on one record, guarded by the record's own version (the
 * same 409 "stale" contract as built-in inline fields). Values are validated per type
 * here and again by the database trigger; archived fields accept no edits.
 */
export function patchRecordFields(db: Database, userId: string, workspace: string, objectType: ObjectType, record: string, data: RecordFieldsPatch) {
  const type = objectInput.parse(objectType), id = uuidInput.parse(record), { version, values } = recordFieldsPatch.parse(data);
  return withTenant(db, userId, uuidInput.parse(workspace), writePermission(type), async (tx, tenantId) => {
    const table = type === "person" ? contacts : companies;
    const where = type === "person" ? and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), isNull(contacts.erasedAt)) : and(eq(companies.tenantId, tenantId), eq(companies.id, id));
    const [current] = await tx.select({ version: table.version }).from(table).where(where).for("update");
    if (!current) throw new AccessError(404, message(type === "person" ? "Errors.thisContactIsNotAvailableInThisWorkspace" : "Errors.thisCompanyIsNotAvailableInThisWorkspace"));
    if (current.version !== version) throw stale();
    const definitions = await loadDefinitions(tx, tenantId, type);
    const ownerColumn = type === "person" ? crmFieldValues.contactId : crmFieldValues.companyId;
    const existing = await tx.select().from(crmFieldValues).where(and(eq(crmFieldValues.tenantId, tenantId), eq(ownerColumn, id)));
    const changed: string[] = [];
    for (const [key, raw] of Object.entries(values)) {
      const field = definitions.find((item) => item.key === key);
      if (!field) throw fieldMissing();
      if (field.archivedAt) throw new AccessError(409, message("Errors.thisFieldIsArchived"));
      const stored = existing.find((row) => row.fieldId === field.id);
      if (raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0)) {
        if (!stored) continue;
        if (field.required) throw new AccessError(400, message("Errors.thisFieldIsRequired"));
        await tx.delete(crmFieldValues).where(and(eq(crmFieldValues.tenantId, tenantId), eq(crmFieldValues.id, stored.id)));
        changed.push(key); continue;
      }
      const parsed = valueSchema(field).safeParse(raw);
      if (!parsed.success) throw new AccessError(400, message("Errors.checkTheFieldValue"));
      const value = parsed.data as Exclude<FieldValue, null>;
      if (JSON.stringify(readValue(field, stored)) === JSON.stringify(value)) continue;
      if (field.type === "relation") {
        const target = field.relationTarget === "company" ? companies : contacts;
        const conditions = field.relationTarget === "company" ? and(eq(companies.tenantId, tenantId), eq(companies.id, value as string)) : and(eq(contacts.tenantId, tenantId), eq(contacts.id, value as string), isNull(contacts.erasedAt));
        const [exists] = await tx.select({ id: target.id }).from(target).where(conditions);
        if (!exists) throw new AccessError(404, message("Errors.theRelatedRecordIsNotAvailable"));
      }
      const columns = storedColumns(field, value);
      if (stored) await tx.update(crmFieldValues).set({ ...columns, updatedBy: userId, updatedAt: new Date() }).where(and(eq(crmFieldValues.tenantId, tenantId), eq(crmFieldValues.id, stored.id)));
      else await tx.insert(crmFieldValues).values({ tenantId, fieldId: field.id, objectType: type, ...(type === "person" ? { contactId: id } : { companyId: id }), ...columns, updatedBy: userId });
      changed.push(key);
    }
    if (!changed.length) return { version: current.version };
    const [row] = await tx.update(table).set({ updatedAt: new Date(), version: sql`${table.version} + 1` }).where(and(where, eq(table.version, version))).returning({ version: table.version });
    if (!row) throw stale();
    // Field names only, never values; contact.* actions are unlinked by erasure.
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: type === "person" ? "contact.update" : "company.update", targetId: id, metadata: { fields: changed.map((key) => `cf:${key}`).join(",") } });
    return { version: row.version };
  });
}
