import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { auditLogs, forms, formVersions } from "../db/schema";
import { message } from "../i18n/messages";
import { uuidInput } from "../lib/contact-input";
import { buildForm, FORM_KIND, formDefinitionSchema, isTemplateId, type FormDefinition, type FormDestination, type FormText } from "../lib/crm-forms";
import { z } from "zod";
import { stampNewsletterForm } from "../lib/newsletter-signup";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

// CRM builder drafts use the crm-form-v1 definition. Published versions are kept immutable.
const text: FormText = (key, values) => message(`CrmForms.${key}` as Parameters<typeof message>[0], values);
const gone = () => new AccessError(404, message("CrmForms.errors.notFound"));
const stale = () => new AccessError(409, message("CrmForms.errors.stale"), { reason: "stale" });
const LIMIT = 200;

async function checkOwner(tx: Parameters<Parameters<typeof withTenant>[4]>[0], tenantId: string, ownerId: string | null) {
  if (ownerId === null) return;
  const { rows } = await tx.execute(sql`select 1 from workspace_members where tenant_id = ${tenantId} and user_id = ${ownerId} for share`);
  if (!rows.length) throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
}

/** A sign-up form may only point at this ministry's own live lists, and its texts are always the ones its wording version and the ministry's name give. */
export async function checkNewsletterDefinition(tx: Parameters<Parameters<typeof withTenant>[4]>[0], tenantId: string, definition: FormDefinition): Promise<FormDefinition> {
  if (!definition.newsletter) return definition;
  const ids = definition.newsletter.listIds;
  if (ids.length) {
    const { rows } = await tx.execute<{ id: string }>(sql`select id::text as id from newsletter_lists where tenant_id = ${tenantId}
      and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) and archived_at is null`);
    if (rows.length !== ids.length) throw new AccessError(400, message("CrmForms.errors.lists"), { reason: "invalid_lists" });
  }
  const { rows: [ministry] } = await tx.execute<{ name: string }>(sql`select name from workspaces where tenant_id = ${tenantId}`);
  return stampNewsletterForm(definition, ministry?.name ?? "");
}

export type FormSummary = { id: string; title: string; destination: FormDestination | null; blocks: number; createdAt: string; updatedAt: string; createdBy: string };

const createInput = z.object({ template: z.string().nullable().default(null), destination: z.object({ type: z.enum(["people", "organizations", "pipeline"]), pipelineId: z.uuid().optional() }).strict().nullable().default(null) }).strict();
const saveInput = z.object({ definition: formDefinitionSchema, revision: z.number().int().min(1) }).strict();

const MAX_DEFINITION_BYTES = 65536;
/** The table caps the stored jsonb text at 64 KB; ask the database for the exact size so an oversize form is a clear 400, not a 500 from the check constraint. */
async function checkSize(tx: Parameters<Parameters<typeof withTenant>[4]>[0], definition: FormDefinition) {
  const [row] = (await tx.execute(sql`select octet_length(${JSON.stringify(definition)}::jsonb::text) as bytes`)).rows as { bytes: number }[];
  if (Number(row.bytes) > MAX_DEFINITION_BYTES) throw new AccessError(400, message("CrmForms.errors.tooLarge"), { reason: "too_large" });
}

/** Destinations are checked against the ministry's own pipelines so a form can never point at another ministry's data. */
export async function checkDestination(tx: Parameters<Parameters<typeof withTenant>[4]>[0], tenantId: string, destination: FormDestination | null) {
  if (destination?.type !== "pipeline") return;
  const found = (await tx.execute(sql`select 1 from crm_pipelines where tenant_id = ${tenantId} and id = ${destination.pipelineId} and archived_at is null`)).rows;
  if (!found.length) throw new AccessError(400, message("CrmForms.errors.destination"));
}

export function listCrmForms(db: Database, userId: string, workspace: string): Promise<FormSummary[]> {
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:forms_manage", async (tx, tenantId) => {
    const rows = (await tx.execute(sql`select f.id::text as id, f.name, f.created_at as "createdAt", coalesce(nullif(u.name, ''), u.email) as "createdBy",
        v.definition->>'title' as title, v.definition->'destination' as destination, jsonb_array_length(coalesce(v.definition->'blocks', '[]'::jsonb)) as blocks, v.definition->>'updatedAt' as "updatedAt"
      from forms f join lateral (select definition from form_versions where tenant_id = f.tenant_id and form_id = f.id
        and status = 'draft' and definition->>'kind' = ${FORM_KIND} order by version desc limit 1) v on true
      left join users u on u.id = f.created_by
      where f.tenant_id = ${tenantId} and f.archived_at is null and v.definition->>'kind' = ${FORM_KIND} and v.definition->'newsletter' is null and v.definition->'ads' is null
      order by f.created_at desc, f.id limit ${LIMIT}`)).rows as { id: string; name: string; createdAt: Date | string; createdBy: string; title: string | null; destination: FormDestination | null; blocks: number; updatedAt: string | null }[];
    return rows.map((row) => ({ id: row.id, title: row.title || row.name, destination: row.destination, blocks: Number(row.blocks), createdAt: new Date(row.createdAt).toISOString(), updatedAt: row.updatedAt ?? new Date(row.createdAt).toISOString(), createdBy: row.createdBy }));
  });
}

/**
 * One draft form made from the event template, inside a transaction that already runs as an owner or admin: used by the campaign wizard's Finish for
 * its registration form. It is the same record the forms screen creates (a form with a version 1 draft): unpublished, with no public address, so it
 * accepts nothing until an owner or admin publishes it there. The caller chooses the id so it can be recorded in the same transaction.
 */
export async function createDraftForm(tx: Parameters<Parameters<typeof withTenant>[4]>[0], tenantId: string, userId: string, input: { id: string; title: string }) {
  const definition = { ...buildForm("event", null, text, new Date().toISOString()), title: input.title };
  await checkSize(tx, definition);
  await tx.insert(forms).values({ id: input.id, tenantId, name: input.title, createdBy: userId });
  await tx.insert(formVersions).values({ tenantId, formId: input.id, version: 1, definition: definition as unknown as Record<string, unknown>, createdBy: userId });
  await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "crm.form.create", targetId: input.id, metadata: { source: "campaign_wizard" } });
}

export async function createCrmForm(db: Database, userId: string, workspace: string, raw: unknown) {
  const input = createInput.parse(raw);
  if (input.template !== null && !isTemplateId(input.template)) throw new AccessError(400, message("CrmForms.errors.template"));
  const template = input.template === null ? null : input.template as Parameters<typeof buildForm>[0];
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:forms_manage", async (tx, tenantId) => {
    await checkDestination(tx, tenantId, input.destination);
    const definition = buildForm(template, input.destination, text, new Date().toISOString());
    await checkSize(tx, definition);
    const [form] = await tx.insert(forms).values({ tenantId, name: definition.title, createdBy: userId }).returning({ id: forms.id });
    await tx.insert(formVersions).values({ tenantId, formId: form.id, version: 1, definition: definition as unknown as Record<string, unknown>, createdBy: userId });
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "crm.form.create", targetId: form.id });
    return { id: form.id };
  });
}

export type LoadedForm = {
  id: string; definition: FormDefinition; createdAt: string; createdBy: string; responseCount: number;
  publication: { slug: string; state: "published" | "retired"; versionId: string | null } | null;
  /** True when the form is published and the draft has been edited since (the next publish replaces the live version). */
  unpublishedChanges: boolean;
};
/** Loads the form's current draft. Ad lead forms are their own preset: hosted paths never see them (`gone`), the ad lead form paths ask for them with `ads: true` and see nothing else. */
export async function loadCrmForm(tx: Parameters<Parameters<typeof withTenant>[4]>[0], tenantId: string, formId: string, options: { ads?: boolean } = {}) {
  const [row] = (await tx.execute(sql`select f.id, f.created_at as "createdAt", coalesce(nullif(u.name, ''), u.email) as "createdBy",
      v.definition, v.id as "draftId", v.version as "draftVersion", a.slug, a.version_id as "publishedId",
      (exists (select 1 from crm_form_publications p where p.tenant_id = f.tenant_id and p.form_id = f.id and p.version_id = v.id)
        or exists (select 1 from ads_form_publications p where p.tenant_id = f.tenant_id and p.form_id = f.id and p.version_id = v.id)) as "frozen",
      (select count(*)::int from crm_form_responses r where r.tenant_id = f.tenant_id and r.form_id = f.id and r.expires_at > now()) as "responseCount"
    from forms f
    join lateral (select id, version, definition from form_versions where tenant_id = f.tenant_id and form_id = f.id
      and status = 'draft' and definition->>'kind' = ${FORM_KIND} order by version desc limit 1) v on true
    left join users u on u.id = f.created_by
    left join crm_form_addresses a on a.tenant_id = f.tenant_id and a.form_id = f.id
    where f.tenant_id = ${tenantId} and f.id = ${formId} and f.archived_at is null`)).rows as {
      id: string; createdAt: Date | string; createdBy: string; definition: unknown; draftId: string; draftVersion: number;
      frozen: boolean; slug: string | null; publishedId: string | null; responseCount: number;
    }[];
  if (!row) throw gone();
  const parsed = formDefinitionSchema.safeParse(row.definition);
  if (!parsed.success) throw gone();
  if (Boolean(parsed.data.ads) !== Boolean(options.ads)) throw gone();
  const form: LoadedForm = {
    id: row.id, definition: parsed.data, createdAt: new Date(row.createdAt).toISOString(), createdBy: row.createdBy,
    responseCount: row.responseCount,
    publication: row.slug ? { slug: row.slug, state: row.publishedId ? "published" : "retired", versionId: row.publishedId } : null,
    unpublishedChanges: Boolean(row.publishedId) && !row.frozen,
  };
  return { form, draftId: row.draftId, draftVersion: row.draftVersion, frozen: row.frozen };
}

export function lockCrmForm(tx: Parameters<Parameters<typeof withTenant>[4]>[0], tenantId: string, formId: string) {
  return tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`crm-form:${tenantId}:${formId}`}, 0))`);
}

export function getCrmForm(db: Database, userId: string, workspace: string, formId: string): Promise<LoadedForm> {
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:forms_manage", async (tx, tenantId) => (await loadCrmForm(tx, tenantId, uuidInput.parse(formId))).form);
}

/** Saves the draft. `revision` is the revision the editor last saw; a different one means another editor saved first (409). */
export async function saveCrmForm(db: Database, userId: string, workspace: string, formId: string, raw: unknown) {
  const input = saveInput.parse(raw);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:forms_manage", async (tx, tenantId) => {
    const id = uuidInput.parse(formId);
    await lockCrmForm(tx, tenantId, id);
    const draft = await loadCrmForm(tx, tenantId, id);
    if (draft.form.definition.revision !== input.revision) throw stale();
    await checkDestination(tx, tenantId, input.definition.destination);
    await checkOwner(tx, tenantId, input.definition.settings.ownerId);
    // A form never turns into a sign-up form or back: the two are saved and published through different screens.
    if (Boolean(draft.form.definition.newsletter) !== Boolean(input.definition.newsletter)) throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
    const stamped = await checkNewsletterDefinition(tx, tenantId, input.definition);
    const next: FormDefinition = { ...stamped, revision: input.revision + 1, updatedAt: new Date().toISOString() };
    await checkSize(tx, next);
    if (draft.frozen) {
      await tx.insert(formVersions).values({ tenantId, formId: id, version: draft.draftVersion + 1, definition: next, createdBy: userId });
    } else {
      const updated = (await tx.execute(sql`update form_versions set definition = ${JSON.stringify(next)}::jsonb
        where tenant_id = ${tenantId} and id = ${draft.draftId} and status = 'draft' and (definition->>'revision')::int = ${input.revision}
        returning 1`)).rows;
      if (!updated.length) throw stale();
    }
    return { revision: next.revision, updatedAt: next.updatedAt };
  });
}

export function duplicateCrmForm(db: Database, userId: string, workspace: string, formId: string) {
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:forms_manage", async (tx, tenantId) => {
    const { form: source } = await loadCrmForm(tx, tenantId, uuidInput.parse(formId));
    const copy: FormDefinition = { ...source.definition, revision: 1, updatedAt: new Date().toISOString(), title: message("CrmForms.copyOf", { title: source.definition.title }).slice(0, 200).trim() };
    await checkSize(tx, copy);
    const [form] = await tx.insert(forms).values({ tenantId, name: copy.title, createdBy: userId }).returning({ id: forms.id });
    await tx.insert(formVersions).values({ tenantId, formId: form.id, version: 1, definition: copy as unknown as Record<string, unknown>, createdBy: userId });
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "crm.form.duplicate", targetId: form.id });
    return { id: form.id };
  });
}
