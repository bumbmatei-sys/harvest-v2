import { z } from "zod";
import type { Transaction } from "../db/client";
import { associationConsentPurposes } from "../lib/consent-purposes";
import { consentPurposes } from "../lib/contact-input";
import { stageKinds } from "../lib/crm-deals";
import { appendOutboxEvent } from "./jobs/outbox";

/**
 * CRM-08: typed, versioned contracts for every CRM lifecycle event that leaves a domain write.
 *
 * - Emitted only through `emitCrmEvent`, inside the same tenant transaction as the domain write,
 *   into the transactional outbox. A failed write emits nothing; a committed write emits once
 *   (the idempotency key is derived from the ledger row or record version it belongs to).
 * - Payloads carry ids, categories and changed field NAMES only: never names, emails, phones,
 *   note/task/description text, deal amounts or reasons, import cells, consent evidence or
 *   association summaries. Each schema is strict, so an extra key fails the write instead of leaking.
 * - `contactId` is always a top-level key so erasure (`erase_contact`) can null it in the outbox and
 *   in dispatched jobs; every contract therefore accepts a null `contactId`.
 * - The stable event id is the outbox row id. `version` changes only for a breaking payload change;
 *   additive optional keys keep the version.
 */
const actor = { tenantId: z.uuid(), actorId: z.string().min(1).max(200) };
const contactRef = z.uuid().nullable();
const optionalId = z.uuid().nullable();
const fieldNames = <const T extends readonly [string, ...string[]]>(names: T) => z.array(z.enum(names)).max(names.length);
const redacted = z.object({ redacted: z.literal(true), length: z.number().int().min(0) }).strict();

const personFields = ["name", "notes", "email", "phone", "social"] as const;
const organizationFields = ["name", "domain", "description"] as const;
const linkFields = ["title", "primary"] as const;
const dealFields = ["name", "amount", "currency", "expectedCloseDate", "ownerUserId", "companyId", "contactId", "closedReason"] as const;

const taskData = z.object({
  ...actor, taskId: z.uuid(), version: z.number().int().min(1), status: z.enum(["open", "done"]), priority: z.enum(["none", "low", "medium", "high"]),
  dueAt: z.iso.datetime({ offset: true }).nullable(), assigneeId: z.string().max(200).nullable(),
  contactId: contactRef, companyId: optionalId, opportunityId: optionalId, body: redacted,
});
const noteData = z.object({ ...actor, noteId: z.uuid(), version: z.number().int().min(1), contactId: contactRef, companyId: optionalId, opportunityId: optionalId, archived: z.boolean(), body: redacted }).strict();
const count = z.number().int().min(0);
const importCounts = z.object({ ...actor, importId: z.uuid(), entity: z.enum(["person", "company"]), total: count, created: count, updated: count, skipped: count, failed: count }).strict();

export const crmEventContracts = {
  // People
  "crm.person.created": { version: 1, data: z.object({ ...actor, contactId: contactRef }).strict() },
  "crm.person.updated": { version: 1, data: z.object({ ...actor, contactId: contactRef, fields: fieldNames(personFields) }).strict() },
  "crm.person.consent_recorded": { version: 1, data: z.object({ ...actor, contactId: contactRef, consentId: z.uuid(),
    purpose: z.enum(consentPurposes), channel: z.enum(["email", "sms", "social"]), status: z.enum(["granted", "withdrawn", "unknown"]) }).strict() },
  "crm.person.organization_linked": { version: 1, data: z.object({ ...actor, contactId: contactRef, companyId: z.uuid() }).strict() },
  "crm.person.organization_link_updated": { version: 1, data: z.object({ ...actor, contactId: contactRef, companyId: z.uuid(), fields: fieldNames(linkFields) }).strict() },
  "crm.person.organization_unlinked": { version: 1, data: z.object({ ...actor, contactId: contactRef, companyId: z.uuid() }).strict() },
  // Organizations (internally "companies")
  "crm.organization.created": { version: 1, data: z.object({ ...actor, companyId: z.uuid() }).strict() },
  "crm.organization.updated": { version: 1, data: z.object({ ...actor, companyId: z.uuid(), fields: fieldNames(organizationFields) }).strict() },
  // Deals
  "crm.deal.created": { version: 1, data: z.object({ ...actor, opportunityId: z.uuid(), pipelineId: z.uuid(), stageId: z.uuid(), contactId: contactRef, companyId: optionalId }).strict() },
  "crm.deal.updated": { version: 1, data: z.object({ ...actor, opportunityId: z.uuid(), fields: fieldNames(dealFields) }).strict() },
  "crm.deal.stage_changed": { version: 1, data: z.object({ ...actor, opportunityId: z.uuid(), pipelineId: z.uuid(), fromStageId: z.uuid(), toStageId: z.uuid(),
    toStageKind: z.enum(stageKinds), contactId: contactRef, companyId: optionalId }).strict() },
  "crm.deal.archived": { version: 1, data: z.object({ ...actor, opportunityId: z.uuid() }).strict() },
  "crm.deal.restored": { version: 1, data: z.object({ ...actor, opportunityId: z.uuid() }).strict() },
  // Tasks and notes (CRM-05 payloads, unchanged)
  "crm.task.created": { version: 1, data: taskData.strict() },
  "crm.task.updated": { version: 1, data: taskData.extend({ fields: z.string().max(200) }).strict() },
  "crm.task.completed": { version: 1, data: taskData.strict() },
  "crm.task.reassigned": { version: 1, data: taskData.extend({ previousAssigneeId: z.string().max(200).nullable() }).strict() },
  "crm.note.created": { version: 1, data: noteData },
  "crm.note.updated": { version: 1, data: noteData },
  "crm.note.archived": { version: 1, data: noteData },
  // Imports and merge (CRM-06 payloads, unchanged): counts and ids only
  "crm.import.completed": { version: 1, data: importCounts },
  "crm.import.failed": { version: 1, data: importCounts },
  "crm.import.rolled_back": { version: 1, data: z.object({ ...actor, importId: z.uuid(), entity: z.enum(["person", "company"]), removed: count, reverted: count, kept: count }).strict() },
  "crm.merge.completed": { version: 1, data: z.object({ ...actor, contactId: contactRef, moved: z.record(z.string().max(40), z.union([z.number().int(), z.boolean()])) }).strict() },
  // Recorded activities (CRM-07 payload, unchanged): categories only, content stays in the table
  "crm.association.recorded": { version: 1, data: z.object({ ...actor, associationId: z.uuid(), contactId: contactRef, companyId: optionalId,
    source: z.string().min(1).max(40), kind: z.string().min(1).max(40), purpose: z.enum(associationConsentPurposes), occurredAt: z.iso.datetime({ offset: true }),
    summary: redacted, payload: z.object({ redacted: z.literal(true) }).strict() }).strict() },
} as const satisfies Record<string, { version: number; data: z.ZodType<Record<string, unknown>> }>;

export type CrmEventType = keyof typeof crmEventContracts;
export type CrmEventData<T extends CrmEventType> = z.input<(typeof crmEventContracts)[T]["data"]>;
export const crmEventTypes = Object.keys(crmEventContracts) as CrmEventType[];
export function isCrmEventType(value: string): value is CrmEventType { return Object.hasOwn(crmEventContracts, value); }

/** The only way CRM code emits an event. Call with the domain write's transaction. */
export async function emitCrmEvent<T extends CrmEventType>(tx: Transaction, tenantId: string, type: T, idempotencyKey: string, data: CrmEventData<T>) {
  const payload = crmEventContracts[type].data.parse(data) as Record<string, unknown>;
  if (payload.tenantId !== tenantId) throw new Error("CRM_EVENT_TENANT_MISMATCH");
  return appendOutboxEvent(tx, tenantId, { kind: type, idempotencyKey, payload: payload as Record<string, never> });
}

/** What consumers (webhooks, future automation and AI context) receive. Built from the outbox row. */
export type CrmEventEnvelope = { id: string; type: CrmEventType; version: number; tenantId: string; occurredAt: string; data: Record<string, unknown> };
/** Per-process counts of events `crmEnvelope` refused to build (HC-DEC1b reviewer note). Counts only. */
export const crmEnvelopeDrops = { unknownKind: 0, invalidPayload: 0 };
export function crmEnvelope(row: { id: string; kind: string; tenantId: string; createdAt: Date; payload: Record<string, unknown> }): CrmEventEnvelope | null {
  // Fixed codes only (no event id, tenant, kind text or payload): a dropped event is counted in the log, never silent.
  if (!isCrmEventType(row.kind)) { crmEnvelopeDrops.unknownKind++; console.error("crm_envelope_unknown_kind"); return null; }
  const parsed = crmEventContracts[row.kind].data.safeParse(row.payload);
  if (!parsed.success) { crmEnvelopeDrops.invalidPayload++; console.error("crm_envelope_invalid_payload"); return null; }
  const { tenantId: _tenant, ...data } = parsed.data as Record<string, unknown>;
  void _tenant;
  return { id: row.id, type: row.kind, version: crmEventContracts[row.kind].version, tenantId: row.tenantId, occurredAt: row.createdAt.toISOString(), data };
}
