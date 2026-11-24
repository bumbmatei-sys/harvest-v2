import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { auditLogs, forms, formVersions } from "../db/schema";
import { message } from "../i18n/messages";
import { uuidInput } from "../lib/contact-input";
import { formDefinitionSchema, type FormDefinition, type FormText } from "../lib/crm-forms";
import { buildNewsletterForm } from "../lib/newsletter-signup";
import { checkNewsletterDefinition, loadCrmForm } from "./crm-forms";
import { requireNewsletterEnabled } from "./newsletter";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

// Newsletter sign-up forms are CRM forms (the same builder, drafts, publication and hosted server) whose definition carries a `newsletter` block.
// This file is the thin layer the Sign-up forms screen needs: create from the preset, list with counts, a per-form summary and archive.
const text: FormText = (key, values) => message(`CrmForms.${key}` as Parameters<typeof message>[0], values);
const gone = () => new AccessError(404, message("CrmForms.errors.notFound"));
const createInput = z.object({ listIds: z.array(uuidInput).min(1).max(10) }).strict();
const LIMIT = 200;

export type SignupFormSummary = {
  id: string; title: string; lists: { id: string; name: string }[]; status: "draft" | "published" | "unpublished"; slug: string | null;
  signups: number; pending: number; confirmed: number; lastSignupAt: string | null; createdAt: string;
};
export type SignupCounts = { total: number; pending: number; confirmed: number; notConfirmed: number; lastSignupAt: string | null };

export function newsletterListChoices(db: Database, userId: string, workspace: string) {
  requireNewsletterEnabled();
  return withTenant(db, userId, uuidInput.parse(workspace), "newsletter:manage", async (tx, tenantId) => {
    const { rows } = await tx.execute<{ id: string; name: string; audience: string }>(sql`select l.id::text as id, l.name, a.name as audience
      from newsletter_lists l join newsletter_audiences a on a.tenant_id = l.tenant_id and a.id = l.audience_id
      where l.tenant_id = ${tenantId} and l.archived_at is null order by lower(a.name), lower(l.name), l.id limit 200`);
    return rows;
  });
}

export function listNewsletterSignupForms(db: Database, userId: string, workspace: string): Promise<SignupFormSummary[]> {
  requireNewsletterEnabled();
  return withTenant(db, userId, uuidInput.parse(workspace), "newsletter:manage", async (tx, tenantId) => {
    const lists = new Map((await tx.execute<{ id: string; name: string }>(sql`select id::text as id, name from newsletter_lists where tenant_id = ${tenantId}`)).rows.map((row) => [row.id, row.name]));
    const { rows } = await tx.execute<{ id: string; name: string; createdAt: Date | string; definition: unknown; slug: string | null; live: boolean; signups: number; pending: number; confirmed: number; last: Date | string | null }>(sql`
      select f.id::text as id, f.name, f.created_at as "createdAt", v.definition, a.slug, a.version_id is not null as live,
        (select count(*)::int from newsletter_form_signups s where s.tenant_id = f.tenant_id and s.form_id = f.id) as signups,
        (select count(*)::int from newsletter_form_signups s where s.tenant_id = f.tenant_id and s.form_id = f.id and s.state = 'pending' and s.expires_at > now()) as pending,
        (select count(*)::int from newsletter_form_signups s where s.tenant_id = f.tenant_id and s.form_id = f.id and s.state = 'confirmed') as confirmed,
        (select max(s.created_at) from newsletter_form_signups s where s.tenant_id = f.tenant_id and s.form_id = f.id) as last
      from forms f
      join lateral (select definition from form_versions where tenant_id = f.tenant_id and form_id = f.id and status = 'draft'
        and definition->>'kind' = 'crm-form-v1' order by version desc limit 1) v on v.definition->'newsletter' is not null
      left join crm_form_addresses a on a.tenant_id = f.tenant_id and a.form_id = f.id
      where f.tenant_id = ${tenantId} and f.archived_at is null order by f.created_at desc, f.id limit ${LIMIT}`);
    return rows.flatMap((row) => {
      const parsed = formDefinitionSchema.safeParse(row.definition);
      if (!parsed.success || !parsed.data.newsletter) return [];
      return [{
        id: row.id, title: parsed.data.title || row.name,
        lists: parsed.data.newsletter.listIds.flatMap((id) => lists.has(id) ? [{ id, name: lists.get(id)! }] : []),
        status: row.slug ? (row.live ? "published" as const : "unpublished" as const) : "draft" as const, slug: row.slug,
        signups: row.signups, pending: row.pending, confirmed: row.confirmed, lastSignupAt: row.last ? new Date(row.last).toISOString() : null,
        createdAt: new Date(row.createdAt).toISOString(),
      }];
    });
  });
}

export function createNewsletterSignupFormDraft(db: Database, userId: string, workspace: string, raw: unknown) {
  requireNewsletterEnabled();
  const input = createInput.parse(raw);
  return withTenant(db, userId, uuidInput.parse(workspace), "newsletter:manage", async (tx, tenantId) => {
    const base = buildNewsletterForm(text, [...new Set(input.listIds)], "", new Date().toISOString());
    const definition: FormDefinition = await checkNewsletterDefinition(tx, tenantId, base);
    const [form] = await tx.insert(forms).values({ tenantId, name: definition.title, createdBy: userId }).returning({ id: forms.id });
    await tx.insert(formVersions).values({ tenantId, formId: form.id, version: 1, definition: definition as unknown as Record<string, unknown>, createdBy: userId });
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "newsletter.signup_form.create", targetId: form.id });
    return { id: form.id };
  });
}

/** Counts only: how many sign-ups are waiting for a confirmation, how many were confirmed and how many were never confirmed. Never a list of people. */
export function newsletterSignupCounts(db: Database, userId: string, workspace: string, formId: string): Promise<SignupCounts> {
  requireNewsletterEnabled();
  return withTenant(db, userId, uuidInput.parse(workspace), "newsletter:manage", async (tx, tenantId) => {
    const { form } = await loadCrmForm(tx, tenantId, uuidInput.parse(formId));
    if (!form.definition.newsletter) throw gone();
    const { rows: [row] } = await tx.execute<{ total: number; pending: number; confirmed: number; last: Date | string | null }>(sql`
      select count(*)::int as total,
        count(*) filter (where state = 'pending' and expires_at > now())::int as pending,
        count(*) filter (where state = 'confirmed')::int as confirmed, max(created_at) as last
      from newsletter_form_signups where tenant_id = ${tenantId} and form_id = ${form.id}`);
    return { total: row.total, pending: row.pending, confirmed: row.confirmed, notConfirmed: row.total - row.pending - row.confirmed,
      lastSignupAt: row.last ? new Date(row.last).toISOString() : null };
  });
}

export function archiveNewsletterSignupForm(db: Database, userId: string, workspace: string, formId: string) {
  requireNewsletterEnabled();
  return withTenant(db, userId, uuidInput.parse(workspace), "newsletter:manage", async (tx, tenantId) => {
    const { rows: [result] } = await tx.execute<{ outcome: string }>(sql`select public.newsletter_form_archive(${tenantId}::uuid, ${uuidInput.parse(formId)}::uuid) as outcome`);
    if (result.outcome !== "ok") throw gone();
    return { archived: true };
  });
}
