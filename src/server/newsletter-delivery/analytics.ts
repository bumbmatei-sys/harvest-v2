import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { newsletterTimeZone } from "./campaigns";
import { deliveryOutcomes, type DeliveryOutcome } from "./port";
import { newsletterMissing, withNewsletter } from "../newsletter-access";

const analyticsRange = z.object({ from: z.iso.date(), until: z.iso.date(), timeZone: newsletterTimeZone }).strict()
  .refine(({ from, until }) => {
    const days = (Date.parse(until) - Date.parse(from)) / 86_400_000;
    return days >= 1 && days <= 92;
  });
type Metric = DeliveryOutcome | "sent";
type NumericReport = {
  counts: Partial<Record<Metric, number>>;
  cohort: Partial<Record<DeliveryOutcome, number>>;
  hourly: { hour: string; outcome: Metric; count: number }[];
  links: { campaignId: string; revision: number; linkId: number; count: number }[];
  acceptedThrough: string | null;
  callbacksThrough: string | null;
};

export function newsletterAnalytics(db: Database, actor: string, workspace: string, target: { campaignId: string } | { listId: string }, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:analytics", async (tx, tenant) => {
    const range = analyticsRange.parse(raw);
    const campaignId = "campaignId" in target ? target.campaignId : null;
    const listId = "listId" in target ? target.listId : null;
    if (!z.uuid().safeParse(campaignId ?? listId).success) throw newsletterMissing();
    const { rows: [row] } = await tx.execute<{ report: NumericReport | null; measured_at: Date }>(sql`
      select public.newsletter_report(${tenant}::uuid,${campaignId}::uuid,${listId}::uuid,
        ${range.from}::date,${range.until}::date,${range.timeZone}) as report, clock_timestamp() as measured_at`);
    if (!row.report) throw newsletterMissing();
    const { counts, cohort, hourly, links, acceptedThrough, callbacksThrough } = row.report;
    const sent = counts.sent ?? 0;
    return {
      range, openCountsApproximate: true,
      counts: { sent, ...Object.fromEntries(deliveryOutcomes.map(outcome => [outcome, counts[outcome] ?? null])) },
      rates: Object.fromEntries(deliveryOutcomes.map(outcome =>
        [outcome, sent > 0 && cohort[outcome] !== undefined ? cohort[outcome] / sent : null])),
      hourly, links: counts.clicked === undefined ? null : links,
      freshness: { measuredAt: row.measured_at, acceptedThrough, callbacksThrough },
    };
  });
}
