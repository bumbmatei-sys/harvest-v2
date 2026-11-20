import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { newsletterCampaigns } from "../../db/schema";
import { id, unavailable, withNewsletter } from "./access";

const dayMs = 86_400_000;
const minimumCohort = 5;
const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);
const queryInput = z.object({ from: z.iso.date().optional(), until: z.iso.date().optional() }).strict()
  .transform(input => ({ from: input.from ?? utcDay(Date.now() - 29 * dayMs), until: input.until ?? utcDay(Date.now() + dayMs) }))
  .refine(range => Date.parse(range.until) > Date.parse(range.from) && Date.parse(range.until) - Date.parse(range.from) <= 90 * dayMs);

const outcomeFields = ["delivered", "bounced", "complained", "unsubscribed"] as const;
type Totals = { selected: number; skipped: number; queued: number; attempted: number; accepted: number;
  failed: number; delivered: number; bounced: number; complained: number; unsubscribed: number };
type Group = { day: string; counts: Totals | null; reasons: Record<string, number> | null };

const empty = (): Totals => ({ selected: 0, skipped: 0, queued: 0, attempted: 0, accepted: 0,
  failed: 0, delivered: 0, bounced: 0, complained: 0, unsubscribed: 0 });

function shape(totals: Totals, currentlyEligible: number | null, reasons: Record<string, number> | null) {
  if (totals.selected > 0 && totals.selected < minimumCohort) return { visibility: "suppressed" as const };
  const providerMetrics = Object.fromEntries(outcomeFields.map(field => [field,
    totals[field] ? { state: "recorded", count: totals[field] } :
      { state: totals.attempted ? "pending" : "unavailable", count: null }]));
  return { visibility: "visible" as const, selected: totals.selected, currentlyEligible, skipped: totals.skipped,
    skippedByReason: reasons,
    queued: totals.queued, attempted: totals.attempted, failed: totals.failed,
    providerAccepted: totals.accepted ? { state: "recorded", count: totals.accepted } :
      { state: totals.attempted > totals.failed ? "pending" : totals.attempted ? "recorded" : "unavailable",
        count: totals.attempted > 0 && totals.attempted === totals.failed ? 0 : null },
    outcomes: providerMetrics, denominators: { attempt: totals.selected, accept: totals.attempted, delivery: totals.accepted } };
}

function aggregate(rows: Group[]) {
  const totals = empty();
  const reasons: Record<string, number> = {};
  for (const row of rows) {
    if (!row.counts) continue;
    for (const key of Object.keys(totals) as (keyof Totals)[]) totals[key] += row.counts[key];
    for (const [reason, count] of Object.entries(row.reasons ?? {})) reasons[reason] = (reasons[reason] ?? 0) + count;
  }
  return { totals, reasons: rows.some(row => row.reasons === null) ? null : reasons };
}

export function newsletterAnalytics(db: Database, actor: string, workspace: string, raw: unknown, campaignId?: string) {
  return withNewsletter(db, actor, workspace, "newsletter:analytics", async (tx, tenant) => {
    const { from, until } = queryInput.parse(raw);
    const campaign = campaignId ? id(campaignId) : null;
    const [record] = campaign ? await tx.select({ id: newsletterCampaigns.id, state: newsletterCampaigns.state,
      version: newsletterCampaigns.version }).from(newsletterCampaigns).where(and(eq(newsletterCampaigns.id, campaign),
      eq(newsletterCampaigns.tenantId, tenant))) : [];
    if (campaign && !record) throw unavailable();
    const { rows } = await tx.execute<Group>(sql`
      select * from public.newsletter_analytics_groups(${tenant}::uuid,${campaign}::uuid,${from}::date,${until}::date)`);
    const eligibilityRows = await tx.execute<{ day: string; eligible: number }>(sql`
      select cohort::text as "day", eligible from public.newsletter_current_eligibility(${tenant}::uuid,${campaign}::uuid,${from}::date,${until}::date)`);
    const eligibility = new Map(eligibilityRows.rows.map(row => [row.day, row.eligible]));
    const { totals, reasons } = aggregate(rows);
    const days = rows.map(({ day, counts, reasons }) => ({
      day, ...(counts ? shape(counts, eligibility.get(day) ?? null, reasons) : { visibility: "suppressed" as const }),
    }));
    const suppressedDays = days.some(day => day.visibility === "suppressed");
    return { campaign: record ?? null, range: { from, until, timezone: "UTC", cohort: "selected" }, days,
      totals: suppressedDays ? { visibility: "suppressed" as const } :
        shape(totals, totals.selected ? [...eligibility.values()].reduce((a, b) => a + b, 0) : 0, reasons) };
  });
}
