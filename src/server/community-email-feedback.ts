import { sql } from "drizzle-orm";
import { z } from "zod";
import { message } from "../i18n/messages";
import { createPool } from "../db/pool";
import type { Database } from "../db/client";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";
import { requireWorkerRole, workerDatabaseUrl } from "./worker-role";
import { readCallback } from "./newsletter-campaigns/callback";
import { verifyCommunityEmailFeedback, type TrustedSns } from "./newsletter-campaigns/ses-adapter";

export const COMMUNITY_EMAIL_FEEDBACK_ENABLED = false;
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function acceptCommunityEmailFeedback(request: Request, trusted: TrustedSns, open = createPool, env: Record<string, string | undefined> = process.env, now = new Date()) {
  const accepted = () => new Response(null, { status: 202, headers: privateHeaders });
  const body = await readCallback(request).catch(() => null);
  const event = body && verifyCommunityEmailFeedback(trusted, body, now);
  if (!event) return accepted();

  let pool: ReturnType<typeof createPool> | undefined;
  try {
    pool = open(workerDatabaseUrl(env));
    await requireWorkerRole(pool);
    await pool.query("select public.community_email_apply_feedback($1, $2, $3)", [event.eventId, event.deliveryId, event.outcome]);
    return accepted();
  } catch {
    console.error("community_email_feedback_failed");
    return new Response(null, { status: 503, headers: privateHeaders });
  } finally {
    await pool?.end().catch(() => console.error("community_email_feedback_cleanup_failed"));
  }
}

export function communityEmailFeedback(request: Request, env: Record<string, string | undefined> = process.env) {
  const topicArn = env.HARVEST_COMMUNITY_FEEDBACK_TOPIC;
  const url = env.HARVEST_COMMUNITY_FEEDBACK_CERT_URL;
  const certificate = env.HARVEST_COMMUNITY_FEEDBACK_CERT;
  if (!COMMUNITY_EMAIL_FEEDBACK_ENABLED || !topicArn || !url || !certificate) {
    return new Response(null, { status: 404, headers: privateHeaders });
  }
  return acceptCommunityEmailFeedback(request, { topicArn, certificates: new Map([[url, certificate]]) });
}

export function communityEmailSuppressions(db: Database, actor: string, tenant: string, page: unknown) {
  const number = z.coerce.number().int().min(1).max(1000).parse(page ?? 1);
  return withTenant(db, actor, z.uuid().parse(tenant), "communities:manage", async (tx, tenantId, _role, access) => {
    if (access !== "owner" && access !== "admin") throw new AccessError(403, message("Errors.workspaceAccessDenied"));
    return (await tx.execute<{ report: {
      counts: { soft: number; hard: number; complaints: number };
      page: number;
      items: { id: string; maskedAddress: string; reason: "soft_bounce" | "hard_bounce" | "complaint"; blockedAt: string }[];
    } }>(sql`select public.community_email_suppression_report(${tenantId}::uuid, ${number}) as report`)).rows[0].report;
  });
}

export function removeSoftCommunityEmailSuppression(db: Database, actor: string, tenant: string, id: unknown) {
  const suppression = z.uuid().parse(id);
  return withTenant(db, actor, z.uuid().parse(tenant), "communities:manage", async (tx, tenantId, _role, access) => {
    if (access !== "owner" && access !== "admin") throw new AccessError(403, message("Errors.workspaceAccessDenied"));
    return (await tx.execute<{ removed: boolean }>(sql`select public.community_email_remove_soft_suppression(${tenantId}::uuid, ${suppression}::uuid) as removed`)).rows[0];
  });
}
