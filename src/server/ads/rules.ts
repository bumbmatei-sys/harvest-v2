import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { adsRuleRuns, adsRules } from "../../db/schema";
import { deriveRatios, evaluateRule, projectResults, ruleInput, versionInput, type AdLevel, type ResultMetrics } from "../../lib/ads/ads";
import { audit, invalid, loadAccount, parse, recordId, stale, unavailable, withAds } from "./access";
import type { AdsDeps } from "./registry";
import { entityTables } from "./access";

type Rule = typeof adsRules.$inferSelect;
type Condition = { metric: Parameters<typeof evaluateRule>[0]["metric"]; operator: Parameters<typeof evaluateRule>[0]["operator"]; threshold: number; windowDays: number };
export const ruleView = (r: Rule) => ({ id: r.id, adAccountId: r.adAccountId, name: r.name, level: r.level, condition: r.condition, action: r.action, enabled: r.enabled, version: r.version });

/** Rules are created disabled. Enabling is a separate, audited step after a preview. */
export async function createRule(db: Database, user: string, workspace: string, data: unknown, deps: AdsDeps) {
  const input = parse(ruleInput, data);
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    await loadAccount(tx, tenant, input.adAccountId);
    const [row] = await tx.insert(adsRules).values({ tenantId: tenant, adAccountId: input.adAccountId, name: input.name, level: input.level, condition: input.condition, action: input.action, createdBy: user }).returning();
    await audit(tx, tenant, user, "rule_create", row.id);
    return { rule: ruleView(row) };
  });
}
export async function listRules(db: Database, user: string, workspace: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => ({ rules: (await tx.select().from(adsRules).where(eq(adsRules.tenantId, tenant)).orderBy(asc(adsRules.name), asc(adsRules.id))).map(ruleView) }));
}
export async function setRuleEnabled(db: Database, user: string, workspace: string, ruleId: string, data: unknown, deps: AdsDeps) {
  const input = parse(z.object({ enabled: z.boolean(), version: versionInput }).strict(), data);
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    // A rule stored with an action other than flag (before 0125) can be switched off or removed, never on.
    if (input.enabled) {
      const [current] = await tx.select({ action: adsRules.action }).from(adsRules).where(and(eq(adsRules.tenantId, tenant), eq(adsRules.id, recordId(ruleId))));
      if (current && current.action !== "notify") throw invalid("ADS_RULE_FLAG_ONLY");
    }
    const [row] = await tx.update(adsRules).set({ enabled: input.enabled, version: sql`${adsRules.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(adsRules.tenantId, tenant), eq(adsRules.id, recordId(ruleId)), eq(adsRules.version, input.version))).returning();
    if (!row) { const [e] = await tx.select({ id: adsRules.id }).from(adsRules).where(and(eq(adsRules.tenantId, tenant), eq(adsRules.id, recordId(ruleId)))); throw e ? stale() : unavailable(); }
    await audit(tx, tenant, user, input.enabled ? "rule_enable" : "rule_disable", row.id);
    return { rule: ruleView(row) };
  });
}
export async function deleteRule(db: Database, user: string, workspace: string, ruleId: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const [row] = await tx.delete(adsRules).where(and(eq(adsRules.tenantId, tenant), eq(adsRules.id, recordId(ruleId)))).returning({ id: adsRules.id });
    if (!row) throw unavailable();
    await audit(tx, tenant, user, "rule_delete", row.id);
    return { deleted: true };
  });
}
export async function listRuleRuns(db: Database, user: string, workspace: string, ruleId: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => ({ runs: (await tx.select().from(adsRuleRuns).where(and(eq(adsRuleRuns.tenantId, tenant), eq(adsRuleRuns.ruleId, recordId(ruleId)))).orderBy(desc(adsRuleRuns.ranAt)).limit(200))
    .map(r => ({ id: r.id, targetLevel: r.targetLevel, targetId: r.targetId, outcome: r.outcome, detail: r.detail, ranAt: r.ranAt.toISOString() })) }));
}

async function matches(tx: Transaction, tenant: string, rule: Rule, today: string) {
  const c = rule.condition as Condition, level = rule.level as AdLevel;
  const table = entityTables[level] as typeof entityTables.campaign;
  const targets = await tx.select({ id: table.id, status: table.status, version: table.version, name: table.name }).from(table).where(and(eq(table.tenantId, tenant), eq(table.adAccountId, rule.adAccountId), eq(table.status, "active")));
  const out: { id: string; version: number; name: string; metrics: ResultMetrics }[] = [];
  for (const t of targets) {
    const { rows } = await tx.execute<{ metrics: ResultMetrics }>(sql`
      select jsonb_build_object('spend', sum((metrics->>'spend')::numeric), 'impressions', sum((metrics->>'impressions')::numeric), 'clicks', sum((metrics->>'clicks')::numeric),
        'results', sum((metrics->>'results')::numeric), 'conversions', sum((metrics->>'conversions')::numeric), 'leads', sum((metrics->>'leads')::numeric)) as metrics
      from ads_results where tenant_id = ${tenant} and level = ${level} and entity_id = ${t.id} and day between (${today}::date - ${c.windowDays - 1}::int) and ${today}::date and attribution_model = 'default'`);
    // sum() over no reported value is null; a missing count stays absent (unavailable), never zero.
    const raw = Object.fromEntries(Object.entries(rows[0]?.metrics ?? {}).filter(([, v]) => v !== null).map(([k, v]) => [k, Number(v)]));
    const metrics = deriveRatios(projectResults(raw));
    if (evaluateRule(c, metrics)) out.push({ id: t.id, version: t.version, name: t.name, metrics });
  }
  return out;
}
const utcToday = (deps: AdsDeps) => deps.now().toISOString().slice(0, 10);

/** Preview: which targets the rule would act on right now. Changes nothing. */
export async function previewRule(db: Database, user: string, workspace: string, ruleId: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const [rule] = await tx.select().from(adsRules).where(and(eq(adsRules.tenantId, tenant), eq(adsRules.id, recordId(ruleId))));
    if (!rule) throw unavailable();
    const found = await matches(tx, tenant, rule, utcToday(deps));
    return { wouldAct: found.map(f => ({ id: f.id, name: f.name, metrics: f.metrics })), action: rule.action };
  });
}

/** Runs the account's enabled rules once. Rules only flag (founder decision 26 Nov): a match is recorded and nothing on the ad account changes. A stored non-flag rule is skipped, never executed. */
export async function runRules(db: Database, user: string, workspace: string, adAccountId: string, deps: AdsDeps) {
  const today = utcToday(deps);
  const plan = await withAds(db, user, workspace, deps, async (tx, tenant) => {
    await loadAccount(tx, tenant, adAccountId);
    const rules = await tx.select().from(adsRules).where(and(eq(adsRules.tenantId, tenant), eq(adsRules.adAccountId, recordId(adAccountId)), eq(adsRules.enabled, true)));
    return Promise.all(rules.map(async rule => ({ rule, found: rule.action === "notify" ? await matches(tx, tenant, rule, today) : [] })));
  });
  const log: { ruleId: string; level: string; id: string; outcome: "triggered"; detail: Record<string, unknown> }[] = [];
  for (const { rule, found } of plan) for (const f of found) log.push({ ruleId: rule.id, level: rule.level, id: f.id, outcome: "triggered", detail: { action: "notify" } });
  await withAds(db, user, workspace, deps, async (tx, tenant) => {
    for (const l of log) await tx.insert(adsRuleRuns).values({ tenantId: tenant, ruleId: l.ruleId, targetLevel: l.level, targetId: l.id, outcome: l.outcome, detail: l.detail });
    if (log.length) await audit(tx, tenant, user, "rules_run", adAccountId, { triggered: String(log.length), failed: "0" });
  });
  return { ran: plan.filter(p => p.rule.action === "notify").length, triggered: log.length, failed: 0 };
}
