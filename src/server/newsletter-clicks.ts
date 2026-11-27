import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, newsletterSettings } from "../db/schema";
import { verifyClickToken } from "../lib/newsletter-click-token";
import { message } from "../i18n/messages";
import { conflict, withNewsletter } from "./newsletter-campaigns/access";
import { newsletterEnabled } from "./newsletter";
import { newsletterKey } from "./newsletter-public";
import { AccessError } from "./permissions";

/** Where an invalid, unknown or retired click link goes: a neutral page, never the URL the visitor supplied. */
export const clickUnavailablePath = "/newsletter/link";
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
const redirect = (location: string) => new Response(null, { status: 302, headers: { ...headers, Location: location } });

/**
 * GET /api/newsletter/link?t=… The token is verified, the destination is read from the frozen revision (never from the request) and at most one
 * click is counted for the delivery and link. Nothing about the visitor is read or kept: no IP address, user agent or other header. A GET never
 * changes a subscription. HEAD (link scanners often use it) redirects without counting.
 */
export async function newsletterClickRedirect(db: Database, request: Request, count: boolean) {
  if (!newsletterEnabled()) return new Response(null, { status: 404, headers });
  const fallback = new URL(clickUnavailablePath, request.url).href;
  const reference = verifyClickToken(newsletterKey(), new URL(request.url).searchParams.get("t"));
  if (!reference) return redirect(fallback);
  try {
    const { rows: [row] } = await db.execute<{ url: string | null }>(count
      ? sql`select public.newsletter_click(${reference.tenant}::uuid,${reference.campaign}::uuid,${reference.revision}::integer,${reference.delivery}::uuid,${reference.link}::integer) as url`
      : sql`select public.newsletter_click_target(${reference.tenant}::uuid,${reference.campaign}::uuid,${reference.revision}::integer,${reference.link}::integer) as url`);
    const url = row?.url;
    return redirect(url && /^https:\/\//.test(url) ? url : fallback);
  } catch {
    console.error("newsletter_click_failed");
    return redirect(fallback);
  }
}

export type ClickSettings = { clickTracking: boolean; since: string | null; version: number; canEdit: boolean };

const isOwner = async (tx: Transaction, tenant: string, actor: string) => (await tx.execute<{ role: string }>(sql`
  select public.access_role(m.tenant_id,m.user_id,'newsletter',m.role_id) as role from public.workspace_members m
  where m.tenant_id=${tenant}::uuid and m.user_id=${actor}`)).rows[0]?.role === "owner";

/** The ministry's click-counting setting (owners and admins read it; off when never set). Only the owner may change it. */
export function newsletterClickSettings(db: Database, actor: string, workspace: string): Promise<ClickSettings> {
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => {
    const [row] = await tx.select().from(newsletterSettings).where(eq(newsletterSettings.tenantId, tenant));
    return { clickTracking: row?.clickTracking ?? false, since: row?.clickTrackingSince?.toISOString() ?? null, version: row?.version ?? 0,
      canEdit: await isOwner(tx, tenant, actor) };
  });
}

const settingsInput = z.object({ clickTracking: z.boolean(), version: z.number().int().min(0).max(2_147_483_646) }).strict();

/** Owner only (the row-level policy refuses anyone else as well). `version` 0 creates the row. Turning counting off stops new rewriting and counting at once. */
export function saveNewsletterClickSettings(db: Database, actor: string, workspace: string, raw: unknown) {
  const input = settingsInput.parse(raw);
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => {
    if (!await isOwner(tx, tenant, actor)) throw new AccessError(403, message("Errors.youDoNotHavePermissionToDoThat"));
    const [row] = input.version === 0
      ? await tx.insert(newsletterSettings).values({ tenantId: tenant, clickTracking: input.clickTracking, version: 1 }).onConflictDoNothing().returning()
      : await tx.update(newsletterSettings).set({ clickTracking: input.clickTracking, version: input.version + 1 })
        .where(and(eq(newsletterSettings.tenantId, tenant), eq(newsletterSettings.version, input.version))).returning();
    if (!row) throw conflict("STALE_VERSION");
    await tx.insert(auditLogs).values({ tenantId: tenant, actorId: actor, action: "newsletter.settings.click_tracking", targetId: tenant,
      metadata: { version: String(row.version), clickTracking: String(row.clickTracking) } });
    return { clickTracking: row.clickTracking, since: row.clickTrackingSince?.toISOString() ?? null, version: row.version, canEdit: true };
  });
}

/** Whether a hosted sign-up form's ministry counts link clicks, so the page can say so. */
export async function newsletterFormCountsClicks(db: Database, slug: string) {
  const { rows: [row] } = await db.execute<{ counted: boolean }>(sql`select public.newsletter_form_counts_clicks(${slug}) as counted`);
  return row?.counted === true;
}
