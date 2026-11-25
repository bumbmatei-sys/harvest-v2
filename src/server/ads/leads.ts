import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { adsLeadForms, adsLeads } from "../../db/schema";
import { leadFormInput, leadStatuses, leadStatusInput, uuidKey } from "../../lib/ads/ads";
import { audit, failureCode, invalid, loadAccount, parse, providerAccess, recordId, stale, unavailable, withAds } from "./access";
import type { RemoteLead } from "./contract";
import type { AdsDeps } from "./registry";

export async function listLeadForms(db: Database, user: string, workspace: string, adAccountId: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => ({ forms: await tx.select({ id: adsLeadForms.id, name: adsLeadForms.name, status: adsLeadForms.status, questions: adsLeadForms.questions, consentText: adsLeadForms.consentText })
    .from(adsLeadForms).where(and(eq(adsLeadForms.tenantId, tenant), eq(adsLeadForms.adAccountId, recordId(adAccountId)))) }));
}

/** Creates an instant form at the provider. The exact consent text is kept as the evidence every lead from this form carries. */
export async function createLeadForm(db: Database, user: string, workspace: string, data: unknown, idempotencyKey: string, deps: AdsDeps) {
  const input = parse(leadFormInput, data), key = parse(uuidKey, idempotencyKey);
  const prepared = await withAds(db, user, workspace, deps, async (tx, tenant) => {
    const ctx = await loadAccount(tx, tenant, input.adAccountId);
    return { tenant, ctx, access: providerAccess(ctx, deps) };
  });
  let remote;
  try { remote = await prepared.access.provider.createLeadForm(prepared.access.credential, { ...prepared.access.query, idempotencyKey: key, name: input.name, consentText: input.consentText, privacyUrl: input.privacyUrl, questions: input.questions }); }
  catch (error) { throw invalid(`PROVIDER_${failureCode(error)}`); }
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const [row] = await tx.insert(adsLeadForms).values({ tenantId: tenant, adAccountId: input.adAccountId, externalRef: remote.ref, name: input.name, consentText: input.consentText, privacyUrl: input.privacyUrl, questions: input.questions, createdBy: user })
      .onConflictDoUpdate({ target: [adsLeadForms.tenantId, adsLeadForms.adAccountId, adsLeadForms.externalRef], set: { name: input.name } }).returning();
    await audit(tx, tenant, user, "lead_form_create", row.id);
    return { form: { id: row.id, name: row.name, status: row.status, questions: row.questions } };
  });
}

export const leadView = (l: typeof adsLeads.$inferSelect) => ({ id: l.id, adAccountId: l.adAccountId, network: l.network, formRef: l.formRef, campaignRef: l.campaignRef, adRef: l.adRef, status: l.status, fields: l.fields, consentText: l.consentText,
  submittedAt: l.submittedAt?.toISOString() ?? null, version: l.version, crmContactCreated: false });

/** Pulls leads from the provider (the poll path that backs the webhook). Stored as ad-lead records only: no CRM contact and no implied consent. */
export async function syncLeads(db: Database, user: string, workspace: string, adAccountId: string, deps: AdsDeps) {
  const prepared = await withAds(db, user, workspace, deps, async (tx, tenant) => { const ctx = await loadAccount(tx, tenant, adAccountId); return { ctx, access: providerAccess(ctx, deps) }; });
  const leads: RemoteLead[] = [];
  try { let cursor: string | undefined; for (let i = 0; i < 20; i++) { const page = await prepared.access.provider.listLeads(prepared.access.credential, { ...prepared.access.query, cursor }); leads.push(...page.items); if (!page.nextCursor) break; cursor = page.nextCursor; } }
  catch (error) { throw invalid(`PROVIDER_${failureCode(error)}`); }
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const forms = await tx.select({ ref: adsLeadForms.externalRef, consent: adsLeadForms.consentText }).from(adsLeadForms).where(and(eq(adsLeadForms.tenantId, tenant), eq(adsLeadForms.adAccountId, prepared.ctx.account.id)));
    const consent = new Map(forms.map(f => [f.ref, f.consent]));
    let added = 0;
    for (const l of leads.slice(0, 2000)) {
      const fields = Object.fromEntries(Object.entries(l.fields).filter(([, v]) => typeof v === "string").slice(0, 30).map(([k, v]) => [k.slice(0, 60), v.slice(0, 500)]));
      const res = await tx.insert(adsLeads).values({ tenantId: tenant, adAccountId: prepared.ctx.account.id, network: l.network, leadRef: l.ref, formRef: l.formRef, campaignRef: l.campaignRef, adRef: l.adRef, fields,
        consentText: l.formRef ? consent.get(l.formRef) ?? null : null, submittedAt: l.submittedAt }).onConflictDoNothing().returning({ id: adsLeads.id });
      added += res.length;
    }
    await audit(tx, tenant, user, "leads_sync", prepared.ctx.account.id, { added: String(added) });
    return { added };
  });
}

export async function listLeads(db: Database, user: string, workspace: string, query: { adAccountId?: string; status?: string }, deps: AdsDeps) {
  const status = query.status === undefined ? undefined : parse(z.enum(leadStatuses), query.status);
  return withAds(db, user, workspace, deps, async (tx, tenant) => ({ leads: (await tx.select().from(adsLeads).where(and(eq(adsLeads.tenantId, tenant), query.adAccountId ? eq(adsLeads.adAccountId, recordId(query.adAccountId)) : undefined,
    status ? eq(adsLeads.status, status) : undefined)).orderBy(desc(adsLeads.createdAt), desc(adsLeads.id)).limit(200)).map(leadView) }));
}
export async function updateLeadStatus(db: Database, user: string, workspace: string, leadId: string, data: unknown, deps: AdsDeps) {
  const input = parse(leadStatusInput, data);
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const [row] = await tx.update(adsLeads).set({ status: input.status, version: sql`${adsLeads.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(adsLeads.tenantId, tenant), eq(adsLeads.id, recordId(leadId)), eq(adsLeads.version, input.version))).returning();
    if (!row) { const [exists] = await tx.select({ id: adsLeads.id }).from(adsLeads).where(and(eq(adsLeads.tenantId, tenant), eq(adsLeads.id, recordId(leadId)))); throw exists ? stale() : unavailable(); }
    await audit(tx, tenant, user, "lead_status", row.id, { status: input.status });
    return { lead: leadView(row) };
  });
}
/** Removes one lead record (a person's data) on request. */
export async function deleteLead(db: Database, user: string, workspace: string, leadId: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const [row] = await tx.delete(adsLeads).where(and(eq(adsLeads.tenantId, tenant), eq(adsLeads.id, recordId(leadId)))).returning({ id: adsLeads.id });
    if (!row) throw unavailable();
    await audit(tx, tenant, user, "lead_delete", row.id);
    return { deleted: true };
  });
}

/**
 * Rights path: erases every lead of this ministry whose email or phone answer matches the identifier (subject-rights or erase flow, owner/admin). The audit keeps the count only,
 * never the identifier.
 */
export async function eraseAdLeadsByIdentifier(db: Database, user: string, workspace: string, identifier: string, deps: AdsDeps) {
  const value = parse(z.string().trim().min(3).max(320), identifier);
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const { rows } = await tx.execute<{ n: number }>(sql`select public.ads_leads_erase_by_identifier(${value}) as n`);
    const erased = Number(rows[0]?.n ?? 0);
    await audit(tx, tenant, user, "leads_erase", tenant, { erased: String(erased) });
    return { erased };
  });
}
