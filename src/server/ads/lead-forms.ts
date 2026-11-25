import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { adsFormPublications, adsLeadForms, formVersions, forms } from "../../db/schema";
import { message } from "../../i18n/messages";
import { adNetworks, uuidKey } from "../../lib/ads/ads";
import { adFormIssues, adFormSpec, stampAdsForm, type AdFormIssue } from "../../lib/ads/lead-form";
import { buildAdLeadForm } from "../../lib/ads/lead-form-builder";
import { formDefinitionSchema, type FormDefinition, type FormText } from "../../lib/crm-forms";
import { loadCrmForm, lockCrmForm } from "../crm-forms";
import { audit, failureCode, invalid, loadAccount, parse, providerAccess, recordId, stale, unavailable, withAds } from "./access";
import { adsFeature, type AdsDeps } from "./registry";

// Ad lead forms are built in Harvest on the shared forms model (an `ads` preset of the CRM form definition: the same blocks, validation and builder as hosted forms) and then published
// to a network's instant form through the Ads port. Drafting and editing never reach a network. Publishing is hard-off (ADS_LEAD_FORM_PUBLISH_ENABLED = false), fake provider in tests.
// A published version is frozen by the database; editing afterwards starts a new version, and every lead keeps the version it answered.

const text: FormText = (key, values) => message(`CrmForms.${key}` as Parameters<typeof message>[0], values);
const MAX_BYTES = 65536;
const createInput = z.object({ network: z.enum(adNetworks), privacyUrl: z.url({ protocol: /^https$/ }).max(500) }).strict();
const saveInput = z.object({ definition: formDefinitionSchema, revision: z.number().int().min(1) }).strict();
const publishInput = z.object({ adAccountId: uuidKey, revision: z.number().int().min(1) }).strict();

async function ministryName(tx: Transaction, tenant: string) {
  const { rows: [row] } = await tx.execute<{ name: string }>(sql`select name from workspaces where tenant_id = ${tenant}`);
  return row?.name ?? "";
}
async function checkSize(tx: Transaction, definition: FormDefinition) {
  const { rows: [row] } = await tx.execute<{ bytes: number }>(sql`select octet_length(${JSON.stringify(definition)}::jsonb::text) as bytes`);
  if (Number(row.bytes) > MAX_BYTES) throw invalid("FORM_TOO_LARGE");
}
const view = (form: FormDefinition) => ({ definition: form, issues: adFormIssues(form) as AdFormIssue[] });

export async function createAdLeadForm(db: Database, user: string, workspace: string, data: unknown, deps: AdsDeps) {
  const input = parse(createInput, data);
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const definition = buildAdLeadForm(text, input.network, input.privacyUrl, await ministryName(tx, tenant), new Date().toISOString());
    await checkSize(tx, definition);
    const [form] = await tx.insert(forms).values({ tenantId: tenant, name: definition.title, createdBy: user }).returning({ id: forms.id });
    await tx.insert(formVersions).values({ tenantId: tenant, formId: form.id, version: 1, definition: definition as unknown as Record<string, unknown>, createdBy: user });
    await audit(tx, tenant, user, "lead_form_draft_create", form.id);
    return { id: form.id, ...view(definition) };
  });
}

export async function listAdLeadFormDrafts(db: Database, user: string, workspace: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const { rows } = await tx.execute<{ id: string; title: string; network: string; revision: number; versions: number; published: number }>(sql`
      select f.id::text as id, v.definition->>'title' as title, v.definition->'ads'->>'network' as network, (v.definition->>'revision')::int as revision,
        (select count(*)::int from form_versions x where x.tenant_id = f.tenant_id and x.form_id = f.id) as versions,
        (select count(*)::int from ads_form_publications p where p.tenant_id = f.tenant_id and p.form_id = f.id) as published
      from forms f join lateral (select definition from form_versions where tenant_id = f.tenant_id and form_id = f.id and status = 'draft'
        and definition->>'kind' = 'crm-form-v1' and definition ? 'ads' order by version desc limit 1) v on true
      where f.tenant_id = ${tenant} and f.archived_at is null order by f.created_at desc, f.id limit 200`);
    return { forms: rows.map((r) => ({ id: r.id, title: r.title, network: r.network, revision: Number(r.revision), versions: Number(r.versions), publishedVersions: Number(r.published) })) };
  });
}

export async function getAdLeadForm(db: Database, user: string, workspace: string, formId: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const { form, frozen } = await loadAd(tx, tenant, formId);
    const publications = await tx.select({ versionId: adsFormPublications.versionId, leadFormId: adsFormPublications.leadFormId, publishedAt: adsFormPublications.publishedAt })
      .from(adsFormPublications).where(and(eq(adsFormPublications.tenantId, tenant), eq(adsFormPublications.formId, form.id)));
    return { id: form.id, ...view(form.definition), frozen, publications: publications.map((p) => ({ ...p, publishedAt: p.publishedAt.toISOString() })) };
  });
}

async function loadAd(tx: Transaction, tenant: string, formId: string) {
  try { return await loadCrmForm(tx, tenant, recordId(formId), { ads: true }); }
  catch (error) { if ((error as { status?: number }).status === 404) throw unavailable(); throw error; }
}

/** Saves the draft. After a publication the edit becomes a new version (the published one is untouched). Texts are re-stamped for the ministry's name and the wording versions, so a request can never choose its own consent words. */
export async function saveAdLeadForm(db: Database, user: string, workspace: string, formId: string, data: unknown, deps: AdsDeps) {
  const input = parse(saveInput, data);
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const id = recordId(formId);
    await lockCrmForm(tx, tenant, id);
    const draft = await loadAd(tx, tenant, id);
    if (draft.form.definition.revision !== input.revision) throw stale();
    if (!input.definition.ads || input.definition.ads.network !== draft.form.definition.ads?.network) throw invalid("NETWORK_IMMUTABLE");
    const next: FormDefinition = { ...stampAdsForm(input.definition, await ministryName(tx, tenant)), revision: input.revision + 1, updatedAt: new Date().toISOString() };
    await checkSize(tx, next);
    if (draft.frozen) {
      await tx.insert(formVersions).values({ tenantId: tenant, formId: id, version: draft.draftVersion + 1, definition: next as unknown as Record<string, unknown>, createdBy: user });
    } else {
      const { rows } = await tx.execute(sql`update form_versions set definition = ${JSON.stringify(next)}::jsonb where tenant_id = ${tenant} and id = ${draft.draftId}
        and status = 'draft' and (definition->>'revision')::int = ${input.revision} returning 1`);
      if (!rows.length) throw stale();
    }
    await audit(tx, tenant, user, "lead_form_draft_save", id);
    return { revision: next.revision, ...view(next) };
  });
}

/**
 * Publishes the current draft version to the account's network as an instant form, then records the provider form with the exact version, question mapping and consent wording. Hard-off: with the
 * switch false nothing is read or sent. Idempotent per version: a second publish of an unchanged version answers `already`.
 */
export async function publishAdLeadForm(db: Database, user: string, workspace: string, formId: string, data: unknown, idempotencyKey: string, deps: AdsDeps) {
  const input = parse(publishInput, data), key = parse(uuidKey, idempotencyKey);
  if (!adsFeature(deps, "leadFormPublish")) throw unavailable();
  const prepared = await withAds(db, user, workspace, deps, async (tx, tenant) => {
    const id = recordId(formId);
    await lockCrmForm(tx, tenant, id);
    const draft = await loadAd(tx, tenant, id);
    const already = await tx.select({ leadFormId: adsFormPublications.leadFormId }).from(adsFormPublications)
      .where(and(eq(adsFormPublications.tenantId, tenant), eq(adsFormPublications.versionId, draft.draftId)));
    if (already.length) return { already: already[0].leadFormId } as const;
    if (draft.form.definition.revision !== input.revision) throw stale();
    const stamped = stampAdsForm(draft.form.definition, await ministryName(tx, tenant));
    if (adFormIssues(stamped).length) throw invalid("FORM_NOT_READY", { issues: adFormIssues(stamped) });
    const ctx = await loadAccount(tx, tenant, input.adAccountId);
    if (ctx.account.network !== stamped.ads!.network) throw invalid("NETWORK_MISMATCH");
    return { id, draftId: draft.draftId, definition: stamped, ctx, access: providerAccess(ctx, deps) } as const;
  });
  if ("already" in prepared) return { outcome: "already" as const, leadFormId: prepared.already };
  const spec = adFormSpec(prepared.definition)!;
  let remote;
  try {
    remote = await prepared.access.provider.createLeadForm(prepared.access.credential, { ...prepared.access.query, idempotencyKey: key, name: prepared.definition.title.slice(0, 120),
      consentText: spec.notice, privacyUrl: spec.privacyUrl, questions: spec.questions.map((q) => q.key) });
  } catch (error) { throw invalid(`PROVIDER_${failureCode(error)}`); }
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    await lockCrmForm(tx, tenant, prepared.id);
    // The version may have been published by a concurrent request with the same draft: keep the first record.
    const { rows } = await tx.execute<{ leadFormId: string }>(sql`select lead_form_id::text as "leadFormId" from ads_form_publications where tenant_id = ${tenant} and version_id = ${prepared.draftId}`);
    if (rows.length) return { outcome: "already" as const, leadFormId: rows[0].leadFormId };
    const [row] = await tx.insert(adsLeadForms).values({ tenantId: tenant, adAccountId: prepared.ctx.account.id, externalRef: remote.ref, name: prepared.definition.title.slice(0, 120), consentText: spec.notice,
      privacyUrl: spec.privacyUrl, questions: spec.questions.map((q) => q.key), consentQuestions: spec.consentQuestions, consentTexts: spec.consentTexts, formId: prepared.id, formVersionId: prepared.draftId, createdBy: user })
      .onConflictDoUpdate({ target: [adsLeadForms.tenantId, adsLeadForms.adAccountId, adsLeadForms.externalRef], set: { name: prepared.definition.title.slice(0, 120) } }).returning();
    if (row.formVersionId !== prepared.draftId) throw invalid("PROVIDER_FORM_CONFLICT");
    await tx.insert(adsFormPublications).values({ tenantId: tenant, formId: prepared.id, versionId: prepared.draftId, leadFormId: row.id, publishedBy: user, definition: prepared.definition as unknown as Record<string, unknown> });
    await audit(tx, tenant, user, "lead_form_publish", row.id, { formId: prepared.id });
    return { outcome: "published" as const, leadFormId: row.id };
  });
}
