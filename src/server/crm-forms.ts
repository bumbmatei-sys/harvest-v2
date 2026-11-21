import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { auditLogs, forms, formVersions } from "../db/schema";
import { message } from "../i18n/messages";
import { uuidInput } from "../lib/contact-input";
import { buildForm, FORM_KIND, formDefinitionSchema, isTemplateId, type FormDefinition, type FormDestination, type FormText } from "../lib/crm-forms";
import { z } from "zod";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

// CRM forms builder, drafts only. A form is a `forms` row with one draft `form_versions` row whose definition is kind `crm-form-v1`.
// Existing Connect intake queries only read kinds `connect-intake-*`, so the two never mix. No migration: nothing here can be published or
// receive a response yet (the hosted form and its submission path are not built); see docs/acceptance/crm-forms-builder.md.
const text: FormText = (key, values) => message(`CrmForms.${key}` as Parameters<typeof message>[0], values);
const gone = () => new AccessError(404, message("CrmForms.errors.notFound"));
const stale = () => new AccessError(409, message("CrmForms.errors.stale"), { reason: "stale" });
const LIMIT = 200;

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
async function checkDestination(tx: Parameters<Parameters<typeof withTenant>[4]>[0], tenantId: string, destination: FormDestination | null) {
  if (destination?.type !== "pipeline") return;
  const found = (await tx.execute(sql`select 1 from crm_pipelines where tenant_id = ${tenantId} and id = ${destination.pipelineId} and archived_at is null`)).rows;
  if (!found.length) throw new AccessError(400, message("CrmForms.errors.destination"));
}

export function listCrmForms(db: Database, userId: string, workspace: string): Promise<FormSummary[]> {
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:forms_manage", async (tx, tenantId) => {
    const rows = (await tx.execute(sql`select f.id::text as id, f.name, f.created_at as "createdAt", coalesce(nullif(u.name, ''), u.email) as "createdBy",
        v.definition->>'title' as title, v.definition->'destination' as destination, jsonb_array_length(coalesce(v.definition->'blocks', '[]'::jsonb)) as blocks, v.definition->>'updatedAt' as "updatedAt"
      from forms f join form_versions v on v.tenant_id = f.tenant_id and v.form_id = f.id and v.version = 1
      left join users u on u.id = f.created_by
      where f.tenant_id = ${tenantId} and f.archived_at is null and v.definition->>'kind' = ${FORM_KIND}
      order by f.created_at desc, f.id limit ${LIMIT}`)).rows as { id: string; name: string; createdAt: Date | string; createdBy: string; title: string | null; destination: FormDestination | null; blocks: number; updatedAt: string | null }[];
    return rows.map((row) => ({ id: row.id, title: row.title || row.name, destination: row.destination, blocks: Number(row.blocks), createdAt: new Date(row.createdAt).toISOString(), updatedAt: row.updatedAt ?? new Date(row.createdAt).toISOString(), createdBy: row.createdBy }));
  });
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

export type LoadedForm = { id: string; definition: FormDefinition; createdAt: string; createdBy: string };
async function load(tx: Parameters<Parameters<typeof withTenant>[4]>[0], tenantId: string, formId: string) {
  const [row] = (await tx.execute(sql`select f.id::text as id, f.created_at as "createdAt", coalesce(nullif(u.name, ''), u.email) as "createdBy", v.definition
    from forms f join form_versions v on v.tenant_id = f.tenant_id and v.form_id = f.id and v.version = 1 left join users u on u.id = f.created_by
    where f.tenant_id = ${tenantId} and f.id = ${formId} and f.archived_at is null and v.definition->>'kind' = ${FORM_KIND}`)).rows as { id: string; createdAt: Date | string; createdBy: string; definition: unknown }[];
  if (!row) throw gone();
  const parsed = formDefinitionSchema.safeParse(row.definition);
  if (!parsed.success) throw gone();
  return { id: row.id, definition: parsed.data as FormDefinition, createdAt: new Date(row.createdAt).toISOString(), createdBy: row.createdBy } satisfies LoadedForm;
}

export function getCrmForm(db: Database, userId: string, workspace: string, formId: string): Promise<LoadedForm> {
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:forms_manage", (tx, tenantId) => load(tx, tenantId, uuidInput.parse(formId)));
}

/** Saves the draft. `revision` is the revision the editor last saw; a different one means another editor saved first (409). */
export async function saveCrmForm(db: Database, userId: string, workspace: string, formId: string, raw: unknown) {
  const input = saveInput.parse(raw);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:forms_manage", async (tx, tenantId) => {
    const id = uuidInput.parse(formId);
    await checkDestination(tx, tenantId, input.definition.destination);
    const next: FormDefinition = { ...input.definition, revision: input.revision + 1, updatedAt: new Date().toISOString() };
    await checkSize(tx, next);
    const updated = (await tx.execute(sql`update form_versions set definition = ${JSON.stringify(next)}::jsonb
      where tenant_id = ${tenantId} and form_id = ${id} and version = 1 and status = 'draft' and definition->>'kind' = ${FORM_KIND} and (definition->>'revision')::int = ${input.revision}
      returning 1`)).rows;
    if (!updated.length) { await load(tx, tenantId, id); throw stale(); }
    return { revision: next.revision, updatedAt: next.updatedAt };
  });
}

export function duplicateCrmForm(db: Database, userId: string, workspace: string, formId: string) {
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:forms_manage", async (tx, tenantId) => {
    const source = await load(tx, tenantId, uuidInput.parse(formId));
    const copy: FormDefinition = { ...source.definition, revision: 1, updatedAt: new Date().toISOString(), title: message("CrmForms.copyOf", { title: source.definition.title }).slice(0, 200).trim() };
    await checkSize(tx, copy);
    const [form] = await tx.insert(forms).values({ tenantId, name: copy.title, createdBy: userId }).returning({ id: forms.id });
    await tx.insert(formVersions).values({ tenantId, formId: form.id, version: 1, definition: copy as unknown as Record<string, unknown>, createdBy: userId });
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "crm.form.duplicate", targetId: form.id });
    return { id: form.id };
  });
}
