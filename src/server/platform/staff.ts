import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { message } from "../../i18n/messages";
import { decisionInput, discoverTypes } from "../../lib/discover";
import { DiscoverValidationError, invalid } from "../discover/owner";
import { AccessError } from "../permissions";
import { withUser } from "../tenancy";

// Harvest staff Discover review. Staff are a separate population from ministry members: a row in platform_staff (granted only by an ops script) plus a recent sign-in.
// Every function below calls a database function that re-checks the active role and writes a staff audit row; none returns member, application, payment or private ministry data.
export const STAFF_FRESH_SIGN_IN_MINUTES = 15;
const notFound = () => new AccessError(404, message("Errors.workspaceUnavailable"));

/** Staff routes need a sign-in within the last N minutes (the session's creation time is the sign-in time). A stale session is told to sign in again; nothing else is revealed. */
export function assertFreshSignIn(signedInAt: Date | string | number | null | undefined, now: Date, maxMinutes = STAFF_FRESH_SIGN_IN_MINUTES) {
  const at = signedInAt === null || signedInAt === undefined ? NaN : new Date(signedInAt).getTime();
  if (!Number.isFinite(at) || now.getTime() - at > maxMinutes * 60_000 || at > now.getTime() + 60_000) throw new AccessError(401, message("Errors.signInToContinue"), { code: "REAUTH_REQUIRED" });
}
function isNotStaff(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === "P0001" && typeof e.message === "string" && e.message.includes("not staff")) return true;
  return isNotStaff(e.cause);
}
async function staff<T>(db: Database, user: string, run: (tx: Parameters<Parameters<typeof withUser>[2]>[0]) => Promise<T>) {
  try { return await withUser(db, user, run); }
  catch (error) { if (isNotStaff(error)) throw notFound(); throw error; }
}

/** The caller's staff role, or null. Never an error: the web layer uses it only to decide between a page and a neutral 404. */
export async function staffRole(db: Database, user: string): Promise<"reviewer" | "admin" | null> {
  return withUser(db, user, async tx => ((await tx.execute<{ r: string | null }>(sql`select public.platform_staff_me() as r`)).rows[0].r as "reviewer" | "admin" | null));
}
const states = z.enum(["pending", "approved", "rejected", "suspended"]);
export async function staffQueue(db: Database, user: string, rawState: string | undefined, limit = 25) {
  const state = states.safeParse(rawState ?? "pending");
  if (!state.success) throw invalid("DISCOVER_INVALID_QUERY");
  return staff(db, user, async tx => ({ items: (await tx.execute<{ q: unknown[] }>(sql`select public.platform_discover_queue(${state.data}, ${Math.min(Math.max(limit, 1), 100)}) as q`)).rows[0].q }));
}
export async function staffReports(db: Database, user: string, limit = 25) {
  return staff(db, user, async tx => ({ reports: (await tx.execute<{ r: unknown[] }>(sql`select public.platform_discover_reports(${Math.min(Math.max(limit, 1), 100)}) as r`)).rows[0].r }));
}
const decisionBody = z.object({ type: z.enum(discoverTypes), version: z.number().int().min(1).max(2_147_483_646) }).and(decisionInput);
/** `id` is the listing's resource id; the type and the version the reviewer saw come in the body. Returns the new state, or stale / not_found / not_reviewable. */
export async function staffDecide(db: Database, user: string, id: string, raw: unknown) {
  const listing = z.uuid().safeParse(id), body = decisionBody.safeParse(raw);
  if (!listing.success || !body.success) throw invalid("DISCOVER_INVALID_DECISION");
  const reason = "reason" in body.data ? body.data.reason : null;
  const outcome = await staff(db, user, async tx => (await tx.execute<{ r: string }>(sql`select public.platform_discover_decide(${body.data.type}, ${listing.data}::uuid, ${body.data.decision}, ${reason}, ${body.data.version}) as r`)).rows[0].r);
  if (outcome === "not_found") throw notFound();
  if (outcome === "stale") throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { code: "STALE_VERSION" });
  if (outcome === "not_reviewable") throw new DiscoverValidationError({ code: "NOT_REVIEWABLE" });
  return { state: outcome };
}
export async function staffResolveReport(db: Database, user: string, id: string, raw: unknown) {
  const body = z.object({ status: z.enum(["reviewed", "dismissed"]) }).strict().safeParse(raw), report = z.uuid().safeParse(id);
  if (!body.success || !report.success) throw invalid("DISCOVER_INVALID_REPORT");
  const done = await staff(db, user, async tx => (await tx.execute<{ r: boolean }>(sql`select public.platform_discover_resolve_report(${report.data}::uuid, ${body.data.status}) as r`)).rows[0].r);
  if (!done) throw notFound();
  return { resolved: true };
}
/** Admin only: hide or restore every Discover listing of a ministry. */
export async function staffStanding(db: Database, user: string, tenant: string, raw: unknown) {
  const body = z.object({ suspended: z.boolean(), reason: z.string().trim().min(1).max(500).optional() }).strict().refine(v => !v.suspended || v.reason !== undefined).safeParse(raw), id = z.uuid().safeParse(tenant);
  if (!body.success || !id.success) throw invalid("DISCOVER_INVALID_STANDING");
  await staff(db, user, async tx => { await tx.execute(sql`select public.platform_discover_standing(${id.data}::uuid, ${body.data.suspended}, ${body.data.reason ?? null})`); });
  return { suspended: body.data.suspended };
}
