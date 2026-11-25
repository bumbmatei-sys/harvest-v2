import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity, getCommunity, publishCommunity, updateCommunity } from "../../src/server/communities";
import { listDiscover } from "../../src/server/community-joining";
import { withTenant, withUser } from "../../src/server/tenancy";
import { reportListing } from "../../src/server/discover/public";
import { searchDiscover } from "../../src/server/discover/public";
import { assertFreshSignIn, staffDecide, staffQueue, staffReports, staffResolveReport, staffRole, staffStanding } from "../../src/server/platform/staff";
import { platformResponse } from "../../src/server/platform/http";
import { defaultDiscoverDeps, type DiscoverDeps } from "../../src/server/discover/registry";

const deps: DiscoverDeps = { enabled: true, now: () => new Date() };
const people = ["ps-owner", "ps-reviewer", "ps-admin", "ps-nobody", "ps-reader", "ps-gone"];
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, community: string;
const q = (query: string, values?: unknown[]) => f.admin.query(query, values);
const grant = (user: string, role: string, by = "ops@harvest") => q("select public.platform_staff_grant($1, $2, $3)", [user, role, by]);
const control = async () => (await q("select * from discover_controls where resource_id=$1", [community])).rows[0];

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values(people.map(id => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, "ps-owner", "Staff Test Church", "church")).tenantId;
  community = (await createCommunity(f.db, "ps-owner", tenant, { name: "Reviewed circle", slug: "reviewed-circle", tagline: "Weekly study" })).id;
  const v = (await getCommunity(f.db, "ps-owner", tenant, community)).version;
  await updateCommunity(f.db, "ps-owner", tenant, community, { version: v, allowOpen: true, visibility: "listed", rulesList: ["Be kind."], description: "Weekly study.", discoverOptIn: true });
  await publishCommunity(f.db, "ps-owner", tenant, community, { version: (await getCommunity(f.db, "ps-owner", tenant, community)).version, published: true });
  await grant("ps-reviewer", "reviewer"); await grant("ps-admin", "admin"); await grant("ps-gone", "reviewer");
  await q("select public.platform_staff_revoke('ps-gone', 'ops@harvest')");
}, 60_000);
afterAll(async () => { await f?.close(); });

it("keeps the staff tables out of reach: forced row security, no application or worker access, grants only through ops functions", async () => {
  const rls = await q("select relrowsecurity, relforcerowsecurity from pg_class where relname in ('platform_staff','platform_staff_audit')");
  expect(rls.rows).toHaveLength(2); expect(rls.rows.every(r => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
  for (const stmt of [sql`select * from platform_staff`, sql`insert into platform_staff(user_id,role,granted_by) values ('ps-nobody','admin','me')`, sql`update platform_staff set role='admin'`, sql`delete from platform_staff`,
    sql`select * from platform_staff_audit`, sql`select public.platform_staff_grant('ps-nobody','admin','me')`, sql`select public.platform_staff_revoke('ps-admin','me')`, sql`select public.platform_staff_role('ps-admin')`,
    sql`select public.platform_staff_log('x','y','z','w',null)`])
    await expect(withUser(f.db, "ps-nobody", async tx => { await tx.execute(stmt); }), String(stmt)).rejects.toThrow();
  for (const fn of ["select public.platform_staff_grant('ps-nobody','admin','me')", "select public.platform_staff_role('ps-admin')", "select * from platform_staff"])
    await expect(f.workerPool.query(fn)).rejects.toThrow();
  // The ops path works as the migration owner and rejects a bad role or an empty operator name.
  await expect(q("select public.platform_staff_grant('ps-nobody','root','me')")).rejects.toThrow();
  await expect(q("select public.platform_staff_grant('ps-nobody','admin','  ')")).rejects.toThrow();
  const log = (await q("select actor_id, action, target_id from platform_staff_audit order by created_at")).rows;
  expect(log.map(r => r.action)).toEqual(["staff.grant", "staff.grant", "staff.grant", "staff.revoke"]);
  expect(log[0]).toMatchObject({ actor_id: "ops@harvest", target_id: "ps-reviewer" });
});

it("knows staff by an active role only", async () => {
  expect(await staffRole(f.db, "ps-reviewer")).toBe("reviewer");
  expect(await staffRole(f.db, "ps-admin")).toBe("admin");
  expect(await staffRole(f.db, "ps-owner")).toBeNull();
  expect(await staffRole(f.db, "ps-gone")).toBeNull();
  for (const user of ["ps-owner", "ps-nobody", "ps-gone"]) {
    await expect(staffQueue(f.db, user, "pending")).rejects.toMatchObject({ status: 404 });
    await expect(staffReports(f.db, user)).rejects.toMatchObject({ status: 404 });
    await expect(staffDecide(f.db, user, community, { type: "community", version: 1, decision: "approve" })).rejects.toMatchObject({ status: 404 });
  }
  // A ministry owner has no staff power over their own listing either.
  expect((await control()).review_state).toBe("pending");
});

it("shows staff Discover review data only and writes a staff audit row for every action", async () => {
  const { items } = await staffQueue(f.db, "ps-reviewer", "pending") as { items: Record<string, unknown>[] };
  expect(items).toHaveLength(1);
  expect(Object.keys(items[0]).sort()).toEqual(["audience", "category", "free", "hostName", "id", "language", "materialChange", "name", "openReports", "reason", "requestedAt", "state", "summary", "tenantId", "type", "version"]);
  expect(JSON.stringify(items)).not.toMatch(/email|member|user|owner|payment|answer/i);
  await expect(staffQueue(f.db, "ps-reviewer", "nonsense")).rejects.toMatchObject({ status: 422 });
  const audit = (await q("select actor_id, action from platform_staff_audit where action like 'discover.%'")).rows;
  expect(audit).toContainEqual({ actor_id: "ps-reviewer", action: "discover.queue" });
});

it("lets a reviewer approve and reject, keeps suspension to admins, and checks versions and types", async () => {
  const c = await control();
  await expect(staffDecide(f.db, "ps-reviewer", community, { type: "community", version: c.version, decision: "reject" })).rejects.toMatchObject({ status: 422 });
  await expect(staffDecide(f.db, "ps-reviewer", community, { type: "community", version: c.version, decision: "suspend", reason: "x" })).rejects.toMatchObject({ status: 404 });
  await expect(staffDecide(f.db, "ps-reviewer", community, { type: "community", version: c.version + 5, decision: "approve" })).rejects.toMatchObject({ status: 409 });
  await expect(staffDecide(f.db, "ps-reviewer", randomUUID(), { type: "community", version: 1, decision: "approve" })).rejects.toMatchObject({ status: 404 });
  await expect(staffDecide(f.db, "ps-reviewer", community, { type: "course", version: c.version, decision: "approve" })).rejects.toMatchObject({ status: 404 });
  await expect(staffDecide(f.db, "ps-reviewer", "not-a-uuid", { type: "community", version: 1, decision: "approve" })).rejects.toMatchObject({ status: 422 });
  expect(await staffDecide(f.db, "ps-reviewer", community, { type: "community", version: c.version, decision: "approve" })).toEqual({ state: "approved" });
  expect((await control()).reviewed_by).toBe("ps-reviewer");
  // Attempts are audited too: the stale approve and the real one.
  expect((await q("select action from platform_staff_audit where actor_id='ps-reviewer' and action='discover.decision.approve'")).rows).toHaveLength(2);
  expect((await q("select count(*)::int n from audit_logs where tenant_id=$1 and actor_id='ps-reviewer' and action='discover.review_approve'", [tenant])).rows[0].n).toBe(1);
  const again = await control();
  await expect(staffDecide(f.db, "ps-admin", community, { type: "community", version: again.version, decision: "suspend" })).rejects.toMatchObject({ status: 422 });
  expect(await staffDecide(f.db, "ps-admin", community, { type: "community", version: again.version, decision: "suspend", reason: "Check again" })).toEqual({ state: "suspended" });
  expect(await staffDecide(f.db, "ps-admin", community, { type: "community", version: (await control()).version, decision: "reinstate" })).toEqual({ state: "approved" });
});

it("applies the approval rule to the legacy communities list when the gate is on, and leaves it unchanged when off", async () => {
  expect((await listDiscover(f.db, {}, { requireApproval: true })).items.map(i => i.slug)).toEqual(["reviewed-circle"]);
  expect((await searchDiscover(f.db, new URLSearchParams(), deps)).items).toHaveLength(1);
  await q("update discover_controls set review_state='pending', reviewed_hash=null where resource_id=$1", [community]);
  expect((await listDiscover(f.db, {}, { requireApproval: true })).items).toEqual([]);
  expect((await listDiscover(f.db, {})).items.map(i => i.slug)).toEqual(["reviewed-circle"]);
  await q("update discover_controls set review_state='approved', reviewed_hash=current_hash where resource_id=$1", [community]);
  expect((await listDiscover(f.db, {}, { requireApproval: true })).items.map(i => i.slug)).toEqual(["reviewed-circle"]);
  await staffStanding(f.db, "ps-admin", tenant, { suspended: true, reason: "Under review" });
  expect((await listDiscover(f.db, {}, { requireApproval: true })).items).toEqual([]);
  await staffStanding(f.db, "ps-admin", tenant, { suspended: false });
  expect((await listDiscover(f.db, {}, { requireApproval: true })).items).toHaveLength(1);
});

it("keeps ministry standing to admins and lets staff resolve reports", async () => {
  await expect(staffStanding(f.db, "ps-reviewer", tenant, { suspended: true, reason: "x" })).rejects.toMatchObject({ status: 404 });
  await expect(staffStanding(f.db, "ps-admin", tenant, { suspended: true })).rejects.toMatchObject({ status: 422 });
  await expect(staffStanding(f.db, "ps-admin", "nope", { suspended: false })).rejects.toMatchObject({ status: 422 });
  await expect(reportListing(f.db, "ps-reader", { type: "community", id: community, reason: "spam" }, deps)).resolves.toEqual({ status: "reported" });
  const { reports } = await staffReports(f.db, "ps-reviewer") as { reports: { id: string }[] };
  expect(reports).toHaveLength(1);
  await expect(staffResolveReport(f.db, "ps-owner", reports[0].id, { status: "dismissed" })).rejects.toMatchObject({ status: 404 });
  await expect(staffResolveReport(f.db, "ps-reviewer", reports[0].id, { status: "bogus" })).rejects.toMatchObject({ status: 422 });
  await expect(staffResolveReport(f.db, "ps-reviewer", reports[0].id, { status: "dismissed" })).resolves.toEqual({ resolved: true });
  await expect(staffResolveReport(f.db, "ps-reviewer", reports[0].id, { status: "dismissed" })).rejects.toMatchObject({ status: 404 });
  const actions = (await q("select action from platform_staff_audit")).rows.map(r => r.action);
  expect(actions).toEqual(expect.arrayContaining(["discover.reports", "discover.standing.suspend", "discover.standing.restore", "discover.report.dismissed"]));
});

it("requires a recent sign-in and is hard-off", async () => {
  const now = new Date("2026-11-25T12:00:00Z");
  expect(() => assertFreshSignIn(new Date(now.getTime() - 10 * 60_000), now)).not.toThrow();
  for (const stale of [new Date(now.getTime() - 16 * 60_000), null, undefined, "garbage", new Date(now.getTime() + 10 * 60_000)])
    expect(() => assertFreshSignIn(stale as Date, now), String(stale)).toThrow(expect.objectContaining({ status: 401, details: { code: "REAUTH_REQUIRED" } }));
  const res = await platformResponse(new Request("http://localhost/api/platform/discover/queue"), false, async () => ({}), 200, defaultDiscoverDeps());
  expect(res.status).toBe(404);
  // The members of a ministry can never see staff tables through their own tenant context.
  await expect(withTenant(f.db, "ps-owner", tenant, "catalog:manage", async tx => { await tx.execute(sql`select * from platform_staff`); })).rejects.toThrow();
});

it("removes the staff row with the account, and the audit keeps the user id as plain text", async () => {
  await f.db.insert(users).values({ id: "ps-leaver", name: "ps-leaver", email: "ps-leaver@example.test", emailVerified: true });
  await grant("ps-leaver", "reviewer");
  await q("delete from users where id=$1", ["ps-leaver"]);
  expect((await q("select count(*)::int n from platform_staff where user_id='ps-leaver'")).rows[0].n).toBe(0);
  expect((await q("select count(*)::int n from platform_staff_audit where target_id='ps-leaver' and action='staff.grant'")).rows[0].n).toBe(1);
});
