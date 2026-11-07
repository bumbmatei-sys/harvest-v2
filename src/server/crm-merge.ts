import { randomUUID } from "node:crypto";
import { message } from "../i18n/messages";
import { and, count, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { contactCompanyLinks, contactConsents, contactIdentifiers, contacts, crmAssociations, crmFieldDefinitions, crmFieldValues, crmNotes, crmTasks, opportunities } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { emitCrmEvent } from "./crm-events";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

const missing = () => new AccessError(404, message("Errors.thisContactIsNotAvailableInThisWorkspace"));
const self = () => new AccessError(400, message("Errors.aPersonCannotBeMergedIntoThemselves"));

async function people(tx: Transaction, tenantId: string, ids: string[]) {
  const rows = await tx.select({ id: contacts.id, name: contacts.name, notes: contacts.notes, version: contacts.version }).from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, ids), isNull(contacts.erasedAt)));
  if (rows.length !== ids.length) throw missing();
  return rows;
}
const tally = async (query: Promise<{ value: number }[]>) => Number((await query)[0]?.value ?? 0);

/**
 * What an explicit merge would do, without doing it: the person kept, the person merged away,
 * and per child type how much moves or is dropped. Same-name suggestions never merge by themselves.
 */
export function previewMerge(db: Database, userId: string, workspace: string, target: string, source: string) {
  const targetId = uuidInput.parse(target), sourceId = uuidInput.parse(source);
  if (targetId === sourceId) throw self();
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:merge", async (tx, tenantId) => {
    const rows = await people(tx, tenantId, [targetId, sourceId]);
    const kept = rows.find((row) => row.id === targetId)!, merged = rows.find((row) => row.id === sourceId)!;
    const identifiers = await tx.select({ contactId: contactIdentifiers.contactId, kind: contactIdentifiers.kind, value: contactIdentifiers.value }).from(contactIdentifiers)
      .where(and(eq(contactIdentifiers.tenantId, tenantId), inArray(contactIdentifiers.contactId, [targetId, sourceId])));
    const keptKinds = new Set(identifiers.filter((item) => item.contactId === targetId).map((item) => item.kind));
    const fromSource = identifiers.filter((item) => item.contactId === sourceId);
    const linked = await tx.select({ contactId: contactCompanyLinks.contactId, companyId: contactCompanyLinks.companyId }).from(contactCompanyLinks)
      .where(and(eq(contactCompanyLinks.tenantId, tenantId), inArray(contactCompanyLinks.contactId, [targetId, sourceId])));
    const keptCompanies = new Set(linked.filter((item) => item.contactId === targetId).map((item) => item.companyId));
    const consents = await tally(tx.select({ value: count() }).from(contactConsents).where(and(eq(contactConsents.tenantId, tenantId), eq(contactConsents.contactId, sourceId))));
    const tasks = await tally(tx.select({ value: count() }).from(crmTasks).where(and(eq(crmTasks.tenantId, tenantId), eq(crmTasks.contactId, sourceId))));
    const notes = await tally(tx.select({ value: count() }).from(crmNotes).where(and(eq(crmNotes.tenantId, tenantId), eq(crmNotes.contactId, sourceId))));
    const deals = await tally(tx.select({ value: count() }).from(opportunities).where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.contactId, sourceId))));
    // CRM-07: logged activities (associations) move with the person; the merge definer re-parents them.
    const activities = await tally(tx.select({ value: count() }).from(crmAssociations).where(and(eq(crmAssociations.tenantId, tenantId), eq(crmAssociations.contactId, sourceId))));
    const keptFields = tx.select({ id: crmFieldValues.fieldId }).from(crmFieldValues).where(and(eq(crmFieldValues.tenantId, tenantId), eq(crmFieldValues.contactId, targetId)));
    const values = await tally(tx.select({ value: count() }).from(crmFieldValues)
      .innerJoin(crmFieldDefinitions, and(eq(crmFieldDefinitions.tenantId, crmFieldValues.tenantId), eq(crmFieldDefinitions.id, crmFieldValues.fieldId), isNull(crmFieldDefinitions.archivedAt)))
      .where(and(eq(crmFieldValues.tenantId, tenantId), or(
        and(eq(crmFieldValues.contactId, sourceId), sql`${crmFieldValues.fieldId} not in (${keptFields})`),
        and(eq(crmFieldValues.relationContactId, sourceId), ne(sql`coalesce(${crmFieldValues.contactId}::text, '')`, sourceId))))));
    return {
      kept: { id: kept.id, name: kept.name, version: kept.version }, merged: { id: merged.id, name: merged.name, version: merged.version },
      identifiers: {
        moved: fromSource.filter((item) => !keptKinds.has(item.kind)).map((item) => ({ kind: item.kind, value: item.value })),
        dropped: fromSource.filter((item) => keptKinds.has(item.kind)).map((item) => ({ kind: item.kind, value: item.value })),
      },
      links: linked.filter((item) => item.contactId === sourceId && !keptCompanies.has(item.companyId)).length,
      consents, tasks, notes, deals, values, activities,
      notesText: !kept.notes && merged.notes ? "copied" as const : merged.notes ? "dropped" as const : "none" as const,
    };
  });
}

/**
 * Confirmed merge, guarded by both versions the preview showed. The SQL definer moves every
 * child atomically, keeps all consent events (a withdrawal still wins) and erases the merged person.
 */
export function mergeContacts(db: Database, userId: string, workspace: string, target: string, data: { sourceId: string; targetVersion: number; sourceVersion: number }) {
  const targetId = uuidInput.parse(target), sourceId = uuidInput.parse(data.sourceId);
  if (targetId === sourceId) throw self();
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:merge", async (tx, tenantId) => {
    const rows = await people(tx, tenantId, [targetId, sourceId]);
    const versions = new Map(rows.map((row) => [row.id, row.version]));
    if (versions.get(targetId) !== data.targetVersion || versions.get(sourceId) !== data.sourceVersion) {
      throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
    }
    const result = await tx.execute(sql`select public.merge_contacts(${tenantId}::uuid, ${targetId}::uuid, ${sourceId}::uuid) as result`);
    const moved = result.rows[0]?.result as Record<string, number | boolean> | null;
    if (!moved) throw missing();
    // Counts and the kept person's id only (erasure scrubs contactId). Neither the merged person's id
    // nor any contact id goes into the key, which erasure cannot scrub; a merge happens once anyway.
    await emitCrmEvent(tx, tenantId, "crm.merge.completed", `crm:merge:${randomUUID()}`, { contactId: targetId, tenantId, actorId: userId, moved });
    return { id: targetId, moved };
  });
}
