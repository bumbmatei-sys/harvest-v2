import { healthChecks, type AdLevel } from "./ads";
import { flatten, type AdAccountView, type AdsAlert, type Entity, type ResultsRow, type TreeCampaign } from "./view";

// Ads overview model: the needs-attention list, budget use and rule flags, from stored records only. Nothing here invents a figure: a budget whose spend nobody reported is never "nearly spent".

/** Share of a budget at which it counts as nearly spent. */
export const budgetNearlySpentAt = 0.9;
/** How far back a rule's flag stays on the overview. */
export const flagWindowDays = 7;

export type RuleView = { id: string; adAccountId: string; name: string; level: AdLevel; condition: { metric: string; operator: string; threshold: number; windowDays: number }; action: "pause" | "notify"; enabled: boolean; version: number };
export type RuleRun = { id: string; targetLevel: string; targetId: string; outcome: "triggered" | "failed"; detail: Record<string, unknown>; ranAt: string };
export type RuleFlag = { ruleId: string; ruleName: string; level: string; targetId: string; ranAt: string };

export type AttentionKind = "accountStatus" | "healthCheck" | "syncFailing" | "lastRefusal" | "alert" | "adRejected" | "deliveryIssue" | "budgetNearlySpent" | "ruleFlag";
export type AttentionItem = {
  key: string; kind: AttentionKind; severity: "critical" | "warning";
  /** Entity the item is about, when there is one. */
  subject: { level: AdLevel; id: string; name: string } | null;
  /** Kind-specific detail: the check name, the alert kind, the delivery issue code, the budget share, the rule name. */
  detail: string | null;
  fixUrl: string | null;
  /** Set on items that come from an open alert, so the list can dismiss them. */
  alertId: string | null;
  share?: number;
};

/** Spend per entity: on `today` for daily budgets, and from the budget's start to today for lifetime budgets. Unreported spend stays absent. */
export function spendBy(rows: readonly ResultsRow[], from: (id: string) => string | null, to: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const start = from(row.entityId);
    if (start === null || row.day < start || row.day > to || row.metrics.spend === undefined) continue;
    out.set(row.entityId, (out.get(row.entityId) ?? 0) + row.metrics.spend);
  }
  return out;
}

/** Share of the budget already spent, or null when the entity has no own budget or nobody reported its spend. */
export function budgetShare(entity: Pick<Entity, "level" | "budgetAmount" | "budgetType" | "budgetOn" | "status">, spent: number | undefined): number | null {
  if (entity.level === "ad" || entity.status !== "active" || entity.budgetAmount === null || entity.budgetAmount <= 0 || spent === undefined) return null;
  if (entity.level === "campaign" && entity.budgetOn === "adset") return null;
  return spent / entity.budgetAmount;
}

/** Entities with their own budget, and the first day their spend counts towards it. */
export function budgetWindows(campaigns: readonly TreeCampaign[], today: string) {
  const flat = flatten(campaigns), start = new Map<string, string>();
  for (const row of [...flat.campaigns, ...flat.adSets]) {
    if (row.budgetAmount === null || row.status !== "active" || (row.level === "campaign" && row.budgetOn === "adset")) continue;
    start.set(row.id, row.budgetType === "lifetime" ? (row.startDate && row.startDate <= today ? row.startDate : today) : today);
  }
  return start;
}

/** The latest triggered run of each rule and target inside the window. A rule that no longer exists is dropped. */
export function ruleFlags(rules: readonly RuleView[], runs: ReadonlyMap<string, readonly RuleRun[]>, now: Date): RuleFlag[] {
  const since = now.getTime() - flagWindowDays * 86_400_000, out = new Map<string, RuleFlag>();
  for (const rule of rules) for (const run of runs.get(rule.id) ?? []) {
    if (run.outcome !== "triggered" || Date.parse(run.ranAt) < since) continue;
    const key = `${rule.id}:${run.targetId}`, seen = out.get(key);
    if (!seen || seen.ranAt < run.ranAt) out.set(key, { ruleId: rule.id, ruleName: rule.name, level: run.targetLevel, targetId: run.targetId, ranAt: run.ranAt });
  }
  return [...out.values()].sort((a, b) => b.ranAt.localeCompare(a.ranAt));
}

const order: Record<AttentionKind, number> = { accountStatus: 0, syncFailing: 1, healthCheck: 2, lastRefusal: 3, alert: 4, adRejected: 5, deliveryIssue: 6, budgetNearlySpent: 7, ruleFlag: 8 };

/**
 * What needs a person on one ad account: account status, failing or warning health checks, a failing refresh, the last refusal, open alerts, rejected ads, delivery issues,
 * budgets nearly spent and rule flags. Critical before warning; an alert and a tree record about the same ad appear once.
 */
export function attentionItems(input: { account: AdAccountView; alerts: readonly AdsAlert[]; campaigns: readonly TreeCampaign[]; spent: ReadonlyMap<string, number>; flags: readonly RuleFlag[] }): AttentionItem[] {
  const { account } = input, flat = flatten(input.campaigns), items: AttentionItem[] = [];
  const all = [...flat.campaigns, ...flat.adSets, ...flat.ads], byId = new Map(all.map((row) => [row.id, row]));
  const subject = (id: string | null) => { const row = id ? byId.get(id) : undefined; return row ? { level: row.level, id: row.id, name: row.name } : null; };
  const base = { subject: null, detail: null, fixUrl: null, alertId: null } as const;
  if (account.status !== "active" && account.status !== "unknown") items.push({ ...base, key: "account", kind: "accountStatus", severity: "critical", detail: account.status });
  if (account.syncState === "failing") items.push({ ...base, key: "sync", kind: "syncFailing", severity: "warning" });
  for (const name of healthChecks) {
    const check = account.health[name];
    if (check && (check.state === "failing" || check.state === "warning")) items.push({ ...base, key: `check:${name}`, kind: "healthCheck", severity: check.state === "failing" ? "critical" : "warning", detail: `${name}.${check.state}`, fixUrl: check.fixUrl ?? null });
  }
  if (account.lastRefusal) items.push({ ...base, key: "refusal", kind: "lastRefusal", severity: "warning", fixUrl: account.lastRefusal.fixUrl });
  const covered = new Set<string>();
  for (const alert of input.alerts) {
    if (alert.adAccountId !== account.id || alert.state !== "open") continue;
    // The account-level alerts repeat the account status and the failing refresh shown above.
    if ((alert.kind === "account_restricted" && items.some((i) => i.kind === "accountStatus")) || (alert.kind === "sync_failed" && items.some((i) => i.kind === "syncFailing"))) continue;
    if (alert.subjectId) covered.add(`${alert.kind}:${alert.subjectId}`);
    items.push({ ...base, key: `alert:${alert.id}`, kind: "alert", severity: alert.severity === "critical" ? "critical" : "warning", subject: subject(alert.subjectId), detail: alert.kind, alertId: alert.id });
  }
  for (const ad of flat.ads) {
    if (ad.status === "archived" || ad.status === "deleted") continue;
    if (ad.reviewStatus === "rejected" && !covered.has(`ad_rejected:${ad.id}`)) items.push({ ...base, key: `rejected:${ad.id}`, kind: "adRejected", severity: "critical", subject: subject(ad.id), detail: ad.reviewReason });
    else if (ad.deliveryIssue && !covered.has(`delivery_issue:${ad.id}`)) items.push({ ...base, key: `issue:${ad.id}`, kind: "deliveryIssue", severity: "warning", subject: subject(ad.id), detail: ad.deliveryIssue });
  }
  for (const row of [...flat.campaigns, ...flat.adSets]) {
    const share = budgetShare(row, input.spent.get(row.id));
    if (share !== null && share >= budgetNearlySpentAt) items.push({ ...base, key: `budget:${row.id}`, kind: "budgetNearlySpent", severity: share >= 1 ? "critical" : "warning", subject: subject(row.id), detail: row.budgetType ?? "daily", share });
  }
  for (const flag of input.flags) {
    const target = subject(flag.targetId);
    if (target) items.push({ ...base, key: `flag:${flag.ruleId}:${flag.targetId}`, kind: "ruleFlag", severity: "warning", subject: target, detail: flag.ruleName });
  }
  return items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1) || order[a.kind] - order[b.kind]);
}

/** Campaigns that are on and not past their end date. */
export function activeCampaigns(campaigns: readonly TreeCampaign[], today: string) {
  return campaigns.filter((c) => c.status === "active" && !(c.endDate && c.endDate < today)).length;
}

/** Health of one account for the panel: each named check with its state; a check that was never answered reads unknown. */
export function healthRows(account: AdAccountView) {
  return healthChecks.map((name) => ({ name, state: (account.health[name]?.state ?? "unknown") as "ok" | "warning" | "failing" | "unknown", fixUrl: account.health[name]?.fixUrl ?? null }));
}
export function healthSummary(account: AdAccountView): "ok" | "warning" | "failing" | "unknown" {
  if (account.status !== "active" && account.status !== "unknown") return "failing";
  const states = healthRows(account).map((row) => row.state);
  if (states.includes("failing")) return "failing";
  if (states.includes("warning") || account.syncState === "failing") return "warning";
  return account.healthCheckedAt ? "ok" : "unknown";
}

// ---- rules (flag only) ----
export const ruleMetricsOffered = ["spend", "costPerResult", "results", "ctr", "cpc", "cpm", "impressions", "clicks"] as const;
export const ruleOperatorsOffered = ["gt", "gte", "lt", "lte"] as const;
export type RuleDraft = { name: string; level: AdLevel; metric: typeof ruleMetricsOffered[number]; operator: typeof ruleOperatorsOffered[number]; threshold: string; windowDays: string };
export const emptyRuleDraft = (): RuleDraft => ({ name: "", level: "campaign", metric: "spend", operator: "gt", threshold: "", windowDays: "3" });
/** CTR is entered as a percentage and stored as a share. */
export const isPercentMetric = (metric: string) => metric === "ctr";
/**
 * The create payload. A rule made here only flags what matches: the action is always `notify`, so a rule never turns anything off or changes a budget.
 * Returns the field that is wrong instead when the draft is not complete.
 */
export function rulePayload(draft: RuleDraft, adAccountId: string): { ok: true; body: { adAccountId: string; name: string; level: AdLevel; condition: { metric: string; operator: string; threshold: number; windowDays: number }; action: "notify" } } | { ok: false; field: "name" | "threshold" | "windowDays" } {
  const name = draft.name.trim();
  if (!name || name.length > 120) return { ok: false, field: "name" };
  const raw = Number(draft.threshold.replace(",", "."));
  if (draft.threshold.trim() === "" || !Number.isFinite(raw) || raw < 0) return { ok: false, field: "threshold" };
  const threshold = isPercentMetric(draft.metric) ? raw / 100 : raw;
  if (threshold > 1e9) return { ok: false, field: "threshold" };
  const windowDays = Number(draft.windowDays);
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 30) return { ok: false, field: "windowDays" };
  return { ok: true, body: { adAccountId, name, level: draft.level, condition: { metric: draft.metric, operator: draft.operator, threshold, windowDays }, action: "notify" } };
}
