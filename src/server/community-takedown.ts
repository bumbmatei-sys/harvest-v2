import { createHash, createHmac } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { getDb } from "../db/client";
import { communityTakedownAppeals, communityTakedowns } from "../db/schema";
import { appealSchema, communityHarvestReportSchema, contentHarvestReportSchema, takedownSchema, type HarvestReportTarget } from "../lib/community-takedown";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { communitySlug } from "./communities";
import { communitiesEnabled } from "./communities-mode";
import { errorResponse, verifyOrigin } from "./http";
import { bioVisitorKey } from "./link-in-bio-public";
import { readBoundedJson } from "./request-json";
import { withTenant, withUser } from "./tenancy";
import { workerSettings } from "./worker-settings";
import { asStaff, staffAreaResponse, staffInvalid, staffNotFound } from "./platform/staff-area";
import { staffRole } from "./platform/staff";

// Harvest staff takedown for communities, posts and replies (founder, 27 Nov 2026: like the giving takedown, docs/acceptance/community-takedown.md).
export type HarvestReportOutcome = "ok" | "invalid" | "not_found" | "limited";
const reportLimit = 4 * 1024;
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } as const;
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", ...extra } });
const unavailable = () => json({ error: "not_found" }, 404);
class BodyTooLarge extends Error {}

/** Rate-limit key of a signed-in member: a keyed hash of the account id (no address). Lives only in a one-minute counter. */
export function memberReportKey(userId: string, env: Record<string, string | undefined> = process.env) {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) return null;
  return createHmac("sha256", createHash("sha256").update(`community-harvest-report:${secret}`).digest()).update(`member:${userId}`).digest("hex");
}

/** A visitor reports a public community page. No account; the same 404 for a missing, draft, hidden or paused community. A filled honeypot is accepted and dropped. */
export async function submitCommunityHarvestReport(db: Database, slug: string, raw: unknown, visitor: string): Promise<HarvestReportOutcome> {
  const parsed = communityHarvestReportSchema.safeParse(raw);
  if (!parsed.success) return "invalid";
  if (parsed.data.website) return "ok";
  const name = communitySlug.safeParse(slug);
  if (!name.success) return "not_found";
  const { rows: [row] } = await db.execute<{ r: HarvestReportOutcome }>(sql`select public.community_harvest_report_community(${name.data}, ${parsed.data.reason}, ${parsed.data.note ?? null}, ${visitor}) as r`);
  return row.r;
}
/** A member reports a post or reply they can read (never their own). Same 404 for anything they cannot read. */
export async function submitContentHarvestReport(db: Database, userId: string, slug: string, raw: unknown, env: Record<string, string | undefined> = process.env): Promise<HarvestReportOutcome> {
  const parsed = contentHarvestReportSchema.safeParse(raw), name = communitySlug.safeParse(slug), key = memberReportKey(userId, env);
  if (!parsed.success) return "invalid";
  if (!name.success || !key) return "not_found";
  const input = parsed.data;
  return withUser(db, userId, async (tx) => (await tx.execute<{ r: HarvestReportOutcome }>(sql`select public.community_harvest_report_content(${name.data}, ${input.targetType},
    ${input.targetId}::uuid, ${input.reason}, ${input.note ?? null}, ${key}) as r`)).rows[0].r);
}
function outcomeResponse(outcome: HarvestReportOutcome) {
  switch (outcome) {
    case "ok": return json({ accepted: true });
    case "limited": return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    case "invalid": return json({ error: "invalid_submission" }, 400);
    default: return unavailable();
  }
}
async function readReport(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return null;
  if (Number(request.headers.get("content-length")) > reportLimit) throw new BodyTooLarge();
  return readBoundedJson(request, reportLimit, () => new BodyTooLarge());
}
/** POST /api/communities/:slug/harvest-report: any visitor reports the public page. Same origin, JSON, 4 KiB, honeypot, database minute limits; no account. */
export async function respondToCommunityHarvestReport(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    if (!communitiesEnabled(workerSettings.getStore()?.features)) return unavailable();
    const { slug } = await context.params;
    try { verifyOrigin(request); } catch { return unavailable(); }
    const visitor = bioVisitorKey(request);
    if (!visitor) return unavailable();
    const input = await readReport(request);
    if (input === null) return json({ error: "json_required" }, 415);
    return outcomeResponse(await submitCommunityHarvestReport(getDb(), slug, input, visitor));
  } catch (error) {
    if (error instanceof BodyTooLarge) return json({ error: "body_too_large" }, 413);
    return errorResponse(error);
  }
}
export { outcomeResponse as harvestReportResponse };

/** A member of a community Harvest paused: its name, and the reason for its owners and admins. Null for everyone else. */
export type HarvestPaused = { slug: string; name: string; manager: boolean; reason: string | null };
export async function harvestPaused(db: Database, userId: string, slug: string): Promise<HarvestPaused | null> {
  const name = communitySlug.safeParse(slug);
  if (!name.success) return null;
  return withUser(db, userId, async (tx) => (await tx.execute<{ v: HarvestPaused | null }>(sql`select public.community_harvest_paused(${name.data}) as v`)).rows[0]?.v ?? null);
}
/** What the ministry's owners and admins see on the community's settings page: paused by Harvest, with the staff reason. Nothing for anyone else. */
export type TakedownAppeal = { status: "open" | "declined" | "restored"; createdAt: string };
export async function communityTakedownFor(db: Database, userId: string, tenantId: string, communityId: string): Promise<{ hidden: boolean; reason: string | null; appeal: TakedownAppeal | null }> {
  // Row security shows the row to the ministry's owners and admins only (Communities at manage); everyone else reads "not hidden".
  return withTenant(db, userId, z.uuid().parse(tenantId), "communities:read", async (tx) => {
    const [row] = await tx.select({ hidden: communityTakedowns.hidden, reason: communityTakedowns.reason }).from(communityTakedowns)
      .where(and(eq(communityTakedowns.targetType, "community"), eq(communityTakedowns.targetId, communityId), eq(communityTakedowns.tenantId, tenantId)));
    if (!row?.hidden) return { hidden: false, reason: null, appeal: null };
    const [appeal] = await tx.select({ status: communityTakedownAppeals.status, createdAt: communityTakedownAppeals.createdAt }).from(communityTakedownAppeals)
      .where(and(eq(communityTakedownAppeals.communityId, communityId), eq(communityTakedownAppeals.tenantId, tenantId))).orderBy(desc(communityTakedownAppeals.createdAt)).limit(1);
    return { hidden: true, reason: row.reason, appeal: appeal ? { status: appeal.status, createdAt: appeal.createdAt.toISOString() } : null };
  });
}

/** Owners and admins ask Harvest to review a paused community: one open request at a time, three a day, a short message. Audited in the ministry. */
export async function requestHarvestReview(db: Database, userId: string, tenantId: string, communityId: string, raw: unknown) {
  const body = appealSchema.safeParse(raw), tenant = z.uuid().safeParse(tenantId), community = z.uuid().safeParse(communityId);
  if (!body.success) throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
  if (!tenant.success || !community.success) throw new AccessError(404, message("Errors.communityNotFound"));
  const outcome = await withUser(db, userId, async (tx) => (await tx.execute<{ r: string }>(sql`select public.community_harvest_appeal(${tenant.data}::uuid, ${community.data}::uuid, ${body.data.message}) as r`)).rows[0].r);
  if (outcome === "ok") return { requested: true };
  if (outcome === "open") throw new AccessError(409, message("Errors.reviewAlreadyRequested"));
  if (outcome === "limited") throw new AccessError(429, message("Errors.reviewRequestLimited"));
  if (outcome === "invalid") throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
  throw new AccessError(404, message("Errors.communityNotFound"));
}

// ---- Harvest staff ---------------------------------------------------------------------------------------------------------------------------------------
export type StaffCommunityReport = { id: string; tenantId: string; communityId: string; ministry: string | null; community: string | null; slug: string | null;
  targetType: HarvestReportTarget; targetId: string; reason: string; note: string | null; excerpt: string | null; removed: boolean;
  status: "open" | "reviewed" | "dismissed"; createdAt: string; hidden: boolean;
  /** The ministry's latest review request (community reports only). */
  appeal: { id: string; message: string; status: "open" | "declined" | "restored"; createdAt: string } | null };
const statuses = z.enum(["open", "reviewed", "dismissed"]);
/** One status page of reports plus the open count (the in-app badge; no email or other alert). Reviewers and admins. */
export async function staffCommunityReports(db: Database, user: string, rawStatus: string | undefined, limit = 50): Promise<{ reports: StaffCommunityReport[]; openCount: number }> {
  const status = statuses.safeParse(rawStatus ?? "open");
  if (!status.success) throw staffInvalid();
  return asStaff(db, user, async (tx) => ({
    reports: (await tx.execute<{ r: StaffCommunityReport[] }>(sql`select public.platform_community_reports(${status.data}, ${Math.min(Math.max(limit, 1), 100)}) as r`)).rows[0].r,
    openCount: Number((await tx.execute<{ n: number }>(sql`select public.platform_community_open_count() as n`)).rows[0].n),
  }));
}
export async function staffCommunityOpenCount(db: Database, user: string): Promise<number> {
  return asStaff(db, user, async (tx) => Number((await tx.execute<{ n: number }>(sql`select public.platform_community_open_count() as n`)).rows[0].n));
}
export async function staffResolveCommunityReport(db: Database, user: string, id: string, raw: unknown) {
  const body = z.object({ status: z.enum(["reviewed", "dismissed"]) }).strict().safeParse(raw), report = z.uuid().safeParse(id);
  if (!body.success || !report.success) throw staffInvalid();
  const done = await asStaff(db, user, async (tx) => (await tx.execute<{ r: boolean }>(sql`select public.platform_community_resolve_report(${report.data}::uuid, ${body.data.status}) as r`)).rows[0].r);
  if (!done) throw staffNotFound();
  return { resolved: true };
}
/** Staff admins only: hide (a reason is required) or restore one reported community, post or reply. */
export async function staffCommunityTakedown(db: Database, user: string, raw: unknown) {
  const body = takedownSchema.safeParse(raw);
  if (!body.success) throw staffInvalid();
  if ((await staffRole(db, user)) !== "admin") throw staffNotFound();
  const { targetType, targetId, hidden, reason } = body.data;
  const done = await asStaff(db, user, async (tx) => (await tx.execute<{ r: boolean }>(sql`select public.platform_community_takedown(${targetType}, ${targetId}::uuid, ${hidden}, ${reason ?? null}) as r`)).rows[0].r);
  if (!done) throw staffNotFound();
  return { hidden };
}
/** Staff admins only: keep the pause and close the ministry's open review request (restoring the community closes it too). */
export async function staffDeclineAppeal(db: Database, user: string, id: string) {
  const appeal = z.uuid().safeParse(id);
  if (!appeal.success) throw staffInvalid();
  if ((await staffRole(db, user)) !== "admin") throw staffNotFound();
  const done = await asStaff(db, user, async (tx) => (await tx.execute<{ r: boolean }>(sql`select public.platform_community_appeal_decline(${appeal.data}::uuid) as r`)).rows[0].r);
  if (!done) throw staffNotFound();
  return { declined: true };
}
/** Staff route wrapper: off with Communities; otherwise the shared staff rules (origin on writes, fresh sign-in, active staff role, neutral 404). */
export const communityStaffResponse = (request: Request, write: boolean, run: (db: Database, user: string) => Promise<unknown>, now = () => new Date()) =>
  staffAreaResponse(() => communitiesEnabled(), request, write, run, now);
