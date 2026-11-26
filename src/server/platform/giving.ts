import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { getDb } from "../../db/client";
import { message } from "../../i18n/messages";
import { getAuth } from "../auth-instance";
import { errorResponse, verifyOrigin } from "../http";
import { AccessError } from "../permissions";
import { readBoundedJson } from "../request-json";
import { withUser } from "../tenancy";
import { waysToGiveEnabled } from "../ways-to-give-mode";
import { assertFreshSignIn, staffRole } from "./staff";

// Harvest staff review of Ways to give reports (CW-10): the same platform_staff role and fresh-sign-in rule as Discover review. Staff list reports, resolve them
// and hide or restore a ministry's public giving details at once. Every database function re-checks the active staff role and writes a staff audit row.
const notFound = () => new AccessError(404, message("Errors.workspaceUnavailable"));
const invalid = () => new AccessError(400, message("Errors.checkTheSuppliedDetails"));
function isNotStaff(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === "P0001" && typeof e.message === "string" && e.message.includes("not staff")) return true;
  return isNotStaff(e.cause);
}
async function staff<T>(db: Database, user: string, run: (tx: Parameters<Parameters<typeof withUser>[2]>[0]) => Promise<T>) {
  try { return await withUser(db, user, run); } catch (error) { if (isNotStaff(error)) throw notFound(); throw error; }
}

export type StaffGivingReport = { id: string; tenantId: string; ministry: string; page: "bio"; ref: string; reason: string; note: string | null; status: "open" | "reviewed" | "dismissed"; createdAt: string; hidden: boolean };
const statuses = z.enum(["open", "reviewed", "dismissed"]);
export async function staffGivingReports(db: Database, user: string, rawStatus: string | undefined, limit = 50): Promise<{ reports: StaffGivingReport[] }> {
  const status = statuses.safeParse(rawStatus ?? "open");
  if (!status.success) throw invalid();
  return staff(db, user, async (tx) => ({ reports: (await tx.execute<{ r: StaffGivingReport[] }>(sql`select public.platform_giving_reports(${status.data}, ${Math.min(Math.max(limit, 1), 100)}) as r`)).rows[0].r }));
}
export async function staffResolveGivingReport(db: Database, user: string, id: string, raw: unknown) {
  const body = z.object({ status: z.enum(["reviewed", "dismissed"]) }).strict().safeParse(raw), report = z.uuid().safeParse(id);
  if (!body.success || !report.success) throw invalid();
  const done = await staff(db, user, async (tx) => (await tx.execute<{ r: boolean }>(sql`select public.platform_giving_resolve_report(${report.data}::uuid, ${body.data.status}) as r`)).rows[0].r);
  if (!done) throw notFound();
  return { resolved: true };
}
/** Hide (a reason is required) or restore every public giving detail of a ministry at once. */
export async function staffGivingStanding(db: Database, user: string, tenant: string, raw: unknown) {
  const body = z.object({ hidden: z.boolean(), reason: z.string().trim().min(1).max(500).optional() }).strict().refine((v) => !v.hidden || v.reason !== undefined).safeParse(raw), id = z.uuid().safeParse(tenant);
  if (!body.success || !id.success) throw invalid();
  const done = await staff(db, user, async (tx) => (await tx.execute<{ r: boolean }>(sql`select public.platform_giving_standing(${id.data}::uuid, ${body.data.hidden}, ${body.data.reason ?? null}) as r`)).rows[0].r);
  if (!done) throw notFound();
  return { hidden: body.data.hidden };
}

const headers = { "Cache-Control": "private, no-store" };
/** Staff route wrapper: off with Ways to give, origin on writes, a session, a sign-in within 15 minutes and an active staff role; anyone else gets a neutral 404. */
export async function givingStaffResponse(request: Request, write: boolean, run: (db: Database, user: string) => Promise<unknown>, now = () => new Date()) {
  try {
    if (!waysToGiveEnabled()) throw notFound();
    if (write) verifyOrigin(request);
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) throw new AccessError(401, message("Errors.signInToContinue"));
    const db = getDb();
    if (!(await staffRole(db, session.user.id))) throw notFound();
    assertFreshSignIn(session.session.createdAt, now());
    const response = Response.json(await run(db, session.user.id), { headers });
    return response;
  } catch (error) {
    const response = errorResponse(error);
    Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }
}
export const givingStaffBody = (request: Request) => readBoundedJson(request, 4_096, invalid) as Promise<unknown>;
