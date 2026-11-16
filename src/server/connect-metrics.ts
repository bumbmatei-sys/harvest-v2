import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { message } from "../i18n/messages";
import { suppressSmall } from "../lib/connect-retention";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";
export const metricKeys = ["scans", "pending", "associated", "erased", "verifiedClaims", "requested", "awaiting_assignment", "no_response", "assigned", "attempted", "connected", "closed", "withdrawn"] as const;
export type CampaignConnectMetrics = Record<typeof metricKeys[number], number | null>;
/** Defense in depth matching SQL, including complementary cells. Never return raw counts. */
export function suppressCampaignMetrics(input: CampaignConnectMetrics): CampaignConnectMetrics {
  const values = metricKeys.map(k => input[k]);
  let hidden = values.some(v => v === null || !Number.isSafeInteger(v) || v > Number.MAX_SAFE_INTEGER / metricKeys.length || suppressSmall(v) === null);
  if (!hidden) {
    const sums = new Set<number>([0]);
    for (const value of values) for (const sum of [...sums]) sums.add(sum + value!);
    const sorted = [...sums].sort((a,b)=>a-b);
    hidden = sorted.some((sum,i)=>i>0 && suppressSmall(sum-sorted[i-1]) === null);
  }
  return Object.fromEntries(metricKeys.map(k => [k, hidden ? null : suppressSmall(input[k]!)])) as CampaignConnectMetrics;
}
export async function getCampaignConnectMetrics(db: Database, userId: string, workspace: string, campaign: string) {
  try {
    return await withTenant(db, userId, z.uuid().parse(workspace), "connect:publish", async (tx, tenant) => {
      const { rows } = await tx.execute<{ metrics: CampaignConnectMetrics }>(sql`select public.connect_campaign_metrics(${tenant}::uuid, ${z.uuid().parse(campaign)}::uuid) as metrics`);
      return { metrics: suppressCampaignMetrics(rows[0].metrics) };
    });
  } catch (error) {
    let current: unknown = error;
    for (let i=0; i<5 && current && typeof current === "object"; i++) {
      if ("code" in current && current.code === "42501") throw new AccessError(403,message("Errors.workspaceAccessDenied"));
      if ("code" in current && current.code === "P0002") throw new AccessError(404,message("Errors.requestFailed"));
      current = "cause" in current ? current.cause : undefined;
    }
    throw error;
  }
}
