import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { waysToGiveEnabled } from "../ways-to-give-mode";
import { staffRole } from "./staff";
import { asStaff, staffAreaBody, staffAreaResponse, staffInvalid, staffNotFound } from "./staff-area";

// Harvest staff review of Ways to give reports (CW-10): the same platform_staff role and fresh-sign-in rule as Discover review. Reviewers and admins list and
// resolve reports; admins only hide or restore a ministry's public giving details at once. Every database function re-checks the active staff role and writes a staff audit row.
const notFound = staffNotFound, invalid = staffInvalid, staff = asStaff;

export type StaffGivingReport = { id: string; tenantId: string; ministry: string; page: "bio"; ref: string; reason: string; note: string | null; status: "open" | "reviewed" | "dismissed"; createdAt: string; hidden: boolean };
const statuses = z.enum(["open", "reviewed", "dismissed"]);
/** One status page of reports plus the open count (the in-app badge; no email or other alert). Reviewers and admins. */
export async function staffGivingReports(db: Database, user: string, rawStatus: string | undefined, limit = 50): Promise<{ reports: StaffGivingReport[]; openCount: number }> {
  const status = statuses.safeParse(rawStatus ?? "open");
  if (!status.success) throw invalid();
  return staff(db, user, async (tx) => ({
    reports: (await tx.execute<{ r: StaffGivingReport[] }>(sql`select public.platform_giving_reports(${status.data}, ${Math.min(Math.max(limit, 1), 100)}) as r`)).rows[0].r,
    openCount: Number((await tx.execute<{ n: number }>(sql`select public.platform_giving_open_count() as n`)).rows[0].n),
  }));
}
/** The open-report count alone, for the page header badge. */
export async function staffGivingOpenCount(db: Database, user: string): Promise<number> {
  return staff(db, user, async (tx) => Number((await tx.execute<{ n: number }>(sql`select public.platform_giving_open_count() as n`)).rows[0].n));
}
export async function staffResolveGivingReport(db: Database, user: string, id: string, raw: unknown) {
  const body = z.object({ status: z.enum(["reviewed", "dismissed"]) }).strict().safeParse(raw), report = z.uuid().safeParse(id);
  if (!body.success || !report.success) throw invalid();
  const done = await staff(db, user, async (tx) => (await tx.execute<{ r: boolean }>(sql`select public.platform_giving_resolve_report(${report.data}::uuid, ${body.data.status}) as r`)).rows[0].r);
  if (!done) throw notFound();
  return { resolved: true };
}
/** Staff admins only (founder, 26 Nov, as for Discover standing): hide (a reason is required) or restore every public giving detail of a ministry at once. */
export async function staffGivingStanding(db: Database, user: string, tenant: string, raw: unknown) {
  const body = z.object({ hidden: z.boolean(), reason: z.string().trim().min(1).max(500).optional() }).strict().refine((v) => !v.hidden || v.reason !== undefined).safeParse(raw), id = z.uuid().safeParse(tenant);
  if (!body.success || !id.success) throw invalid();
  if ((await staffRole(db, user)) !== "admin") throw notFound();
  const done = await staff(db, user, async (tx) => (await tx.execute<{ r: boolean }>(sql`select public.platform_giving_standing(${id.data}::uuid, ${body.data.hidden}, ${body.data.reason ?? null}) as r`)).rows[0].r);
  if (!done) throw notFound();
  return { hidden: body.data.hidden };
}

/** Staff route wrapper: off with Ways to give, origin on writes, a session, a sign-in within 15 minutes and an active staff role; anyone else gets a neutral 404. */
export const givingStaffResponse = (request: Request, write: boolean, run: (db: Database, user: string) => Promise<unknown>, now = () => new Date()) =>
  staffAreaResponse(waysToGiveEnabled, request, write, run, now);
export const givingStaffBody = staffAreaBody;
