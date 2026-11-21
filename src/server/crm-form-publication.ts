import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { auditLogs } from "../db/schema";
import { message } from "../i18n/messages";
import { uuidInput } from "../lib/contact-input";
import { formIssues } from "../lib/crm-forms";
import { syntheticCrmFormsKey } from "./crm-form-mode";
import { checkDestination, loadCrmForm, lockCrmForm } from "./crm-forms";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

const publicationInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish"), slug: z.string().max(64), revision: z.number().int().min(1).max(2_147_483_647) }).strict(),
  z.object({ action: z.literal("retire") }).strict(),
]);

export function transitionCrmForm(db: Database, userId: string, workspace: string, formId: string, raw: unknown) {
  const input = publicationInput.parse(raw);
  const id = uuidInput.parse(formId);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:forms_manage", async (tx, tenantId) => {
    if (!syntheticCrmFormsKey()) throw new AccessError(404, message("CrmForms.errors.notFound"));
    await lockCrmForm(tx, tenantId, id);
    let slug: string | null = null;
    let revision: number | null = null;
    if (input.action === "publish") {
      ({ slug, revision } = input);
      const { form } = await loadCrmForm(tx, tenantId, id);
      if (form.definition.revision !== revision) throw new AccessError(409, message("CrmForms.errors.stale"), { reason: "stale" });
      const definition = form.definition;
      if (formIssues(definition).length || definition.blocks.some(block => block.required && block.type === "upload")
        || (definition.destination?.type === "organizations" && !definition.blocks.some(block => block.mapTo === "organization"))) {
        throw new AccessError(400, message("Errors.checkTheSuppliedDetails"), { reason: "invalid_definition" });
      }
      await checkDestination(tx, tenantId, definition.destination);
    }
    const { rows: [result] } = await tx.execute<{ outcome: string }>(
      sql`select public.crm_form_transition(${tenantId}, ${id}, ${input.action}, ${slug}, ${revision}) as outcome`);
    if (result.outcome === "not_found") throw new AccessError(404, message("CrmForms.errors.notFound"));
    if (["stale", "slug_taken", "immutable_slug"].includes(result.outcome)) {
      throw new AccessError(409, message("Errors.checkTheSuppliedDetails"), { reason: result.outcome });
    }
    if (result.outcome !== "ok" && result.outcome !== "unchanged") {
      throw new AccessError(400, message("Errors.checkTheSuppliedDetails"), { reason: result.outcome });
    }
    return (await loadCrmForm(tx, tenantId, id)).form.publication;
  });
}

const cursorInput = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[a-f0-9-]{36}$/);
const pageInput = z.object({ cursor: cursorInput.optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();
export function listCrmFormResponses(db: Database, userId: string, workspace: string, formId: string, raw: unknown) {
  const input = pageInput.parse(raw);
  const [before, beforeId] = input.cursor?.split("|") ?? [];
  if (before && !Number.isFinite(Date.parse(before))) throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
  if (beforeId) uuidInput.parse(beforeId);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:forms_manage", async (tx, tenantId) => {
    const { form } = await loadCrmForm(tx, tenantId, uuidInput.parse(formId));
    // Keep microsecond precision in the cursor, even though JavaScript Dates round to milliseconds.
    const { rows } = await tx.execute<{ id: string; submittedAt: string }>(sql`
      select r.id, r.version_id as "versionId", r.contact_id as "contactId", r.company_id as "companyId",
        r.campaign_id as "campaignId", r.qr_link_id as "qrLinkId", r.owner_id as "ownerId", r.labels, r.answers, r.created_contact as "createdContact",
        r.consent_block_id as "consentBlockId", r.expires_at as "expiresAt", p.notice_version_id as "noticeVersionId",
        to_char(r.submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "submittedAt"
      from crm_form_responses r join crm_form_publications p
        on (p.tenant_id, p.form_id, p.version_id) = (r.tenant_id, r.form_id, r.version_id)
      where r.tenant_id = ${tenantId} and r.form_id = ${form.id}
      ${before ? sql`and (r.submitted_at, r.id) < (${before}::timestamptz, ${beforeId}::uuid)` : sql.empty()}
      order by r.submitted_at desc, r.id desc limit ${input.limit + 1}`);
    const responses = rows.slice(0, input.limit);
    const last = responses.at(-1);
    const nextCursor = rows.length > input.limit && last ? `${last.submittedAt}|${last.id}` : null;
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "crm.form.responses_read", targetId: form.id });
    return { responses, count: form.responseCount, nextCursor };
  });
}

export function purgeCrmFormResponses(db: Database, userId: string, workspace: string) {
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:forms_manage", async (tx, tenantId) => {
    const { rows: [result] } = await tx.execute<{ removed: number }>(sql`select public.crm_form_purge_expired(${tenantId}) as removed`);
    return result;
  });
}
