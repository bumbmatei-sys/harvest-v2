import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { H13, hc13Fixture } from "./hc13-fixture";
import { withTenant, withUser } from "../../src/server/tenancy";
import { assignFollowUpCase, getFollowUpCase, listFollowUpCases, openEligibleFollowUpCases, transitionFollowUpCase } from "../../src/server/follow-up-cases";
import { followUpCaseStates, followUpTransitionAllowed, counselorTransitions } from "../../src/lib/follow-up-cases";
import { putMember } from "../../src/server/workspaces";
import { eraseContact } from "../../src/server/contacts";
import { mergeContacts } from "../../src/server/crm-merge";
import { eraseConnectResponse } from "../../src/server/connect-responses";
import { createContact } from "../../src/server/contacts";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../src/db/schema";

// HC-13 server side (case lifecycle and counselor assignment). Nothing here approves an activation decision or sends anything.
vi.mock("server-only", () => ({}));
let ctx: Awaited<ReturnType<typeof hc13Fixture>>;
let currentUser: string | null = null;
vi.mock("@/server/http", async (original) => ({ ...(await original<typeof import("../../src/server/http")>()),
  verifyOrigin: () => {},
  verifiedUser: async () => { if (!currentUser) { const { AccessError } = await import("../../src/server/permissions"); throw new AccessError(401, "Sign in to continue."); } return currentUser; } }));
vi.mock("@/db/client", () => ({ getDb: () => ctx.f.db }));

const asApp = (user: string, tenant: string, query: ReturnType<typeof sql>) => withTenant(ctx.f.db, user, tenant, "workspace:read", (tx) => tx.execute(query));
const seen = async (user: string, tenant = ctx.tenantA) => ((await asApp(user, tenant, sql`select id from followup_cases order by id`)).rows as { id: string }[]).map((row) => row.id).sort();
const forged = (user: string, tenant: string, query: ReturnType<typeof sql>) => withUser(ctx.f.db, user, async (tx) => { await tx.execute(sql`select set_config('app.tenant_id', ${tenant}, true)`); return tx.execute(query); });
const state = async (id: string) => (await ctx.caseRow(id))!;
const version = async (id: string) => (await state(id)).version;
/** requested -> awaiting_assignment -> assigned to `assignee`. */
async function assigned(assignee: string) {
  const seeded = await ctx.seedCase();
  await transitionFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, seeded.caseId, { to: "awaiting_assignment", version: 1 });
  await assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, seeded.caseId, { assigneeId: assignee, version: 2 });
  return seeded;
}
const move = (user: string, id: string, to: string, expected?: number) => version(id).then((v) => transitionFollowUpCase(ctx.f.db, user, ctx.tenantA, id, { to, version: expected ?? v }));
const status = (promise: Promise<unknown>) => promise.then(() => 200, (error: { status?: number }) => error.status ?? 500);
async function http(user: string | null, method: string, path: string, tenant = ctx.tenantA, body?: unknown, caseId?: string) {
  currentUser = user;
  const init = { method, headers: { origin: "https://example.test" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  if (caseId !== undefined) {
    const { GET, PATCH } = await import("../../src/app/api/workspaces/[tenantId]/followup-cases/[caseId]/route");
    const res = await (method === "GET" ? GET : PATCH)(new Request(`https://example.test/api/${path}`, init), { params: Promise.resolve({ tenantId: tenant, caseId }) });
    return { status: res.status, body: await res.text() };
  }
  const { GET, POST } = await import("../../src/app/api/workspaces/[tenantId]/followup-cases/route");
  const res = await (method === "GET" ? GET : POST)(new Request(`https://example.test/api/${path}`, init), { params: Promise.resolve({ tenantId: tenant }) });
  return { status: res.status, body: await res.text() };
}

beforeAll(async () => { ctx = await hc13Fixture(); });
afterAll(async () => { await ctx?.f.close(); });

describe("schema, privileges and the transition table", () => {
  it("keeps the database transition table identical to the library table", async () => {
    for (const from of followUpCaseStates) for (const to of followUpCaseStates) {
      const { rows } = await ctx.f.admin.query("select public.followup_case_transition_allowed($1, $2) as ok", [from, to]);
      expect(rows[0].ok, `${from} -> ${to}`).toBe(followUpTransitionAllowed(from, to));
    }
    for (const [from, targets] of Object.entries(counselorTransitions)) for (const to of targets!) expect(followUpTransitionAllowed(from as never, to), `${from} -> ${to}`).toBe(true);
  });

  it("forces RLS, grants only minimal columns and no writes, and hides campaign and response ids", async () => {
    expect((await ctx.f.admin.query("select relrowsecurity, relforcerowsecurity from pg_class where relname = 'followup_cases'")).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect((await ctx.f.admin.query("select polname from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'followup_cases' order by 1")).rows.map((row) => row.polname)).toEqual(["followup_cases_read", "followup_definer_tenant"]);
    const columns = (await ctx.f.admin.query("select column_name from information_schema.column_privileges where table_name = 'followup_cases' and grantee = 'harvest_app' and privilege_type = 'SELECT' order by 1")).rows.map((row) => row.column_name);
    expect(columns).toEqual(["assigned_at", "assignee_id", "contact_id", "created_at", "id", "state", "state_changed_at", "tenant_id", "updated_at", "version"]);
    const seeded = await ctx.seedCase();
    for (const column of ["campaign_id", "response_id"]) await expect(asApp("d-owner", ctx.tenantA, sql.raw(`select ${column} from followup_cases`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(asApp("d-owner", ctx.tenantA, sql`select * from followup_cases`)).rejects.toMatchObject({ cause: { code: "42501" } });
    for (const write of [sql`insert into followup_cases (tenant_id, campaign_id, response_id, contact_id) values (${ctx.tenantA}, ${ctx.campaign}, ${randomUUID()}, ${randomUUID()})`,
      sql`update followup_cases set state = 'withdrawn'`, sql`delete from followup_cases`]) {
      for (const user of ["d-owner", "d-admin", "d-member"]) await expect(asApp(user, ctx.tenantA, write)).rejects.toMatchObject({ cause: { code: "42501" } });
    }
    expect((await state(seeded.caseId)).state).toBe("requested");
  });

  it("makes every case function a hardened definer, executable by the application role and not PUBLIC", async () => {
    const { rows } = await ctx.f.admin.query(`select proname, prosecdef, proconfig, has_function_privilege('public', oid, 'EXECUTE') as p, has_function_privilege('harvest_app', oid, 'EXECUTE') as a
      from pg_proc where proname in ('open_eligible_followup_cases', 'assign_followup_case', 'transition_followup_case') order by 1`);
    expect(rows).toEqual(["assign_followup_case", "open_eligible_followup_cases", "transition_followup_case"].map((proname) => ({ proname, prosecdef: true, proconfig: ["search_path=pg_catalog, pg_temp"], p: false, a: true })));
    const internal = await ctx.f.admin.query(`select proname, has_function_privilege('public', oid, 'EXECUTE') as p, has_function_privilege('harvest_app', oid, 'EXECUTE') as a from pg_proc
      where proname in ('followup_actor_role', 'followup_consent_effective', 'followup_case_transition_allowed', 'guard_followup_case', 'followup_case_response_erased', 'followup_case_response_moved', 'followup_member_revoked') order by 1`);
    expect(internal.rows).toHaveLength(7);
    for (const row of internal.rows) expect(row, row.proname).toMatchObject({ p: false, a: false });
    const hooks = (await ctx.f.admin.query("select proname, prosecdef, proconfig from pg_proc where proname in ('followup_case_response_erased', 'followup_case_response_moved', 'followup_member_revoked') order by 1")).rows;
    for (const hook of hooks) expect(hook).toMatchObject({ prosecdef: true, proconfig: ["search_path=pg_catalog, pg_temp"] });
  });
});

describe("opening cases (verified, associated, consent in effect)", () => {
  it("opens one case per eligible response, idempotently, as owner or admin, with a case id unrelated to the response id", async () => {
    const seeded = await ctx.seedAssociated();
    expect(await openEligibleFollowUpCases(ctx.f.db, "d-admin", ctx.tenantA)).toEqual({ opened: 1 });
    expect(await openEligibleFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA)).toEqual({ opened: 0 });
    const id = (await ctx.caseOf(seeded.response))!;
    expect(id).not.toBe(seeded.response);
    expect(await ctx.caseRow(id)).toMatchObject({ state: "requested", assignee_id: null, version: 1, contact_id: seeded.contactId });
    expect((await ctx.audit("followup.case.open")).filter((row) => row.target_id === id)).toEqual([{ actor_id: "d-admin", action: "followup.case.open", target_id: id, metadata: {} }]);
  });

  it("never opens a case from a pending response, a withdrawn purpose, a CRM withdrawal or an unrecorded ledger", async () => {
    const pending = await ctx.seedResponse(["outreach_follow_up"]);
    const noPurpose = await ctx.seedAssociated({ purposes: ["newsletter"] });
    const responseWithdrawn = await ctx.seedAssociated({ withdrawResponse: true });
    const crmWithdrawn = await ctx.seedAssociated({ ledger: "withdrawn" });
    const noLedger = await ctx.seedAssociated({ ledger: "none" });
    await openEligibleFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA, { limit: 200 });
    for (const response of [pending, noPurpose.response, responseWithdrawn.response, crmWithdrawn.response, noLedger.response]) expect(await ctx.caseOf(response)).toBeUndefined();
    // The database refuses the same thing when written directly, whoever writes.
    const direct = (response: string, contactId: string) => ctx.f.admin.query("insert into followup_cases (tenant_id, campaign_id, response_id, contact_id) values ($1,$2,$3,$4)", [ctx.tenantA, ctx.campaign, response, contactId]);
    await expect(direct(crmWithdrawn.response, crmWithdrawn.contactId)).rejects.toThrow("follow-up consent is not in effect");
    await expect(direct(noPurpose.response, noPurpose.contactId)).rejects.toThrow("follow-up consent is not in effect");
    await expect(direct(pending, randomUUID())).rejects.toThrow(/case contact is unavailable|violates foreign key/);
    const ok = await ctx.seedAssociated();
    await expect(direct(ok.response, noPurpose.contactId)).rejects.toThrow("case requires a verified associated response");
    await expect(ctx.f.admin.query("insert into followup_cases (tenant_id, campaign_id, response_id, contact_id, state) values ($1,$2,$3,$4,'assigned')", [ctx.tenantA, ctx.campaign, ok.response, ok.contactId])).rejects.toThrow();
    expect(await openEligibleFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA)).toEqual({ opened: 1 });
  });

  it("denies opening to members, viewers and outsiders", async () => {
    await ctx.seedAssociated();
    for (const user of ["d-member", "d-viewer", "d-other"]) expect(await status(openEligibleFollowUpCases(ctx.f.db, user, ctx.tenantA))).toBe(403);
    await expect(ctx.f.db.execute(sql`select public.open_eligible_followup_cases(${ctx.tenantA}::uuid, 5)`)).rejects.toMatchObject({ cause: { code: "42501" } });
    for (const user of ["d-member", "d-viewer"]) await expect(asApp(user, ctx.tenantA, sql`select public.open_eligible_followup_cases(${ctx.tenantA}::uuid, 5)`)).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(forged("d-other", ctx.tenantA, sql`select public.open_eligible_followup_cases(${ctx.tenantA}::uuid, 5)`)).rejects.toMatchObject({ cause: { code: "42501" } });
    await openEligibleFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA, { limit: 200 });
  });
});

describe("state machine", () => {
  it("accepts exactly the legal transitions and rejects every other pair in the database, whoever writes", async () => {
    const seeded = await ctx.seedCase();
    const subject = seeded.caseId;
    const place = async (from: string) => {
      await ctx.f.admin.query("alter table followup_cases disable trigger followup_case_guard");
      try { await ctx.f.admin.query("update followup_cases set state = $2, assignee_id = $3, assigned_at = now() where id = $1", [subject, from, ["assigned", "attempted"].includes(from) ? "d-member" : null]); }
      finally { await ctx.f.admin.query("alter table followup_cases enable trigger followup_case_guard"); }
    };
    for (const from of followUpCaseStates) for (const to of followUpCaseStates) {
      await place(from);
      // The assignee column must satisfy the target state's own check; the pair itself is judged by the guard. Repeating a state is a
      // reassignment attempt (a different assignee), which only an assigned case allows.
      const target = ["assigned", "attempted"].includes(to) ? "d-member2" : null;
      const result = await ctx.f.admin.query("update followup_cases set state = $2, assignee_id = $3 where id = $1", [subject, to, target]).then(() => "ok", (error: Error) => error.message);
      if (from === to) {
        if (from === "assigned" || from === "attempted") continue; // attempted -> attempted is not legal; checked below.
        expect(result, `${from} -> ${to}`).toBe("ok"); // a no-op update changes nothing
      } else if (followUpTransitionAllowed(from, to)) expect(result, `${from} -> ${to}`).toBe("ok");
      else expect(result, `${from} -> ${to}`).toMatch(/case transition is not allowed/);
    }
    await place("attempted");
    await expect(ctx.f.admin.query("update followup_cases set assignee_id = 'd-member2' where id = $1", [subject])).rejects.toThrow("case assignment is not allowed in this state");
    await place("assigned");
    await ctx.f.admin.query("update followup_cases set assignee_id = 'd-member2' where id = $1", [subject]);
    for (const from of ["requested", "awaiting_assignment", "no_response", "connected"]) {
      await place(from);
      await expect(ctx.f.admin.query("update followup_cases set assignee_id = 'd-member2' where id = $1", [subject]), from).rejects.toThrow();
    }
  }, 120_000);

  it("stamps version and timestamps in the database and keeps identity immutable", async () => {
    const { caseId } = await assigned("d-member");
    const before = (await ctx.f.admin.query("select version, created_at, updated_at, state_changed_at, assigned_at from followup_cases where id = $1", [caseId])).rows[0];
    expect(before.version).toBe(3);
    expect(before.assigned_at).not.toBeNull();
    await expect(ctx.f.admin.query("update followup_cases set response_id = $2 where id = $1", [caseId, randomUUID()])).rejects.toThrow("case identity is immutable");
    await expect(ctx.f.admin.query("update followup_cases set campaign_id = $2 where id = $1", [caseId, ctx.emptyCampaign])).rejects.toThrow("case identity is immutable");
    await expect(ctx.f.admin.query("update followup_cases set created_at = now() - interval '1 year' where id = $1", [caseId])).rejects.toThrow("case identity is immutable");
    await expect(ctx.f.admin.query("update followup_cases set contact_id = $2 where id = $1", [caseId, randomUUID()])).rejects.toThrow("case contact changes only with a merge");
    await expect(ctx.f.admin.query("delete from followup_cases where id = $1", [caseId])).rejects.toThrow("cases are removed only with their response");
    // A caller-supplied version or timestamp is overwritten by the guard.
    await ctx.f.admin.query("update followup_cases set state = 'attempted', version = 99, updated_at = '2001-01-01' where id = $1", [caseId]);
    const after = (await ctx.f.admin.query("select version, updated_at from followup_cases where id = $1", [caseId])).rows[0];
    expect(after.version).toBe(4); expect(new Date(after.updated_at).getFullYear()).toBeGreaterThan(2020);
  });

  it("walks a case through its whole life with the service, refuses terminal moves and keeps the request key used", async () => {
    const { caseId, response } = await ctx.seedCase();
    await move("d-admin", caseId, "awaiting_assignment");
    await assignFollowUpCase(ctx.f.db, "d-admin", ctx.tenantA, caseId, { assigneeId: "d-member", version: 2 });
    await move("d-member", caseId, "attempted");
    await move("d-member", caseId, "no_response");
    await move("d-member", caseId, "attempted");
    await move("d-member", caseId, "connected");
    await move("d-member", caseId, "closed");
    expect(await ctx.caseRow(caseId)).toMatchObject({ state: "closed", assignee_id: "d-member" });
    for (const to of ["awaiting_assignment", "attempted", "withdrawn", "closed"]) expect(await status(move("d-owner", caseId, to))).toBe(409);
    expect(await status(assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, caseId, { assigneeId: "d-member2", version: await version(caseId) }))).toBe(409);
    // A closed or withdrawn case is never re-opened and its response never opens a second one.
    expect(await openEligibleFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA)).toEqual({ opened: 0 });
    expect(await ctx.caseOf(response)).toBe(caseId);
    const trail = (await ctx.audit()).filter((row) => row.target_id === caseId).map((row) => `${row.action}:${row.metadata.from ?? ""}>${row.metadata.to ?? ""}`);
    expect(trail).toEqual(["followup.case.open:>", "followup.case.transition:requested>awaiting_assignment", "followup.case.assign:awaiting_assignment>assigned",
      "followup.case.transition:assigned>attempted", "followup.case.transition:attempted>no_response", "followup.case.transition:no_response>attempted",
      "followup.case.transition:attempted>connected", "followup.case.transition:connected>closed"]);
  });

  it("lets only owners and admins withdraw, which clears the assignee", async () => {
    const { caseId } = await assigned("d-member");
    expect(await status(move("d-member", caseId, "withdrawn"))).toBe(403);
    await move("d-admin", caseId, "withdrawn");
    expect(await ctx.caseRow(caseId)).toMatchObject({ state: "withdrawn", assignee_id: null });
    expect(await status(move("d-owner", caseId, "awaiting_assignment"))).toBe(409);
  });

  it("rejects stale versions and illegal moves with a stable reason and no change", async () => {
    const { caseId } = await ctx.seedCase();
    const stale = await transitionFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, caseId, { to: "connected", version: 1 }).catch((error) => error);
    expect(stale).toMatchObject({ status: 409, details: { reason: "illegal_transition" } });
    await expect(transitionFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, caseId, { to: "awaiting_assignment", version: 7 })).rejects.toMatchObject({ status: 409, details: { reason: "stale" } });
    await expect(transitionFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, caseId, { to: "bogus", version: 1 })).rejects.toThrow();
    await expect(transitionFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, caseId, { to: "assigned", version: 1 })).rejects.toThrow();
    await expect(transitionFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, randomUUID(), { to: "closed", version: 1 })).rejects.toMatchObject({ status: 404 });
    expect(await ctx.caseRow(caseId)).toMatchObject({ state: "requested", version: 1 });
  });
});

describe("assignment", () => {
  it("assigns, reassigns and unassigns active members only, and audits each change with ids and states", async () => {
    const { caseId } = await ctx.seedCase();
    await move("d-owner", caseId, "awaiting_assignment");
    const first = await assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, caseId, { assigneeId: "d-member", version: 2 });
    expect(first).toMatchObject({ state: "assigned", assigneeId: "d-member", version: 3 });
    // Same assignee again: no change, no new version, no audit row.
    const rows = (await ctx.audit()).length;
    expect(await assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, caseId, { assigneeId: "d-member", version: 3 })).toMatchObject({ version: 3 });
    expect((await ctx.audit()).length).toBe(rows);
    const second = await assignFollowUpCase(ctx.f.db, "d-admin", ctx.tenantA, caseId, { assigneeId: "d-member2", version: 3 });
    expect(second).toMatchObject({ state: "assigned", assigneeId: "d-member2", version: 4 });
    // An owner or admin may be assigned too.
    expect(await assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, caseId, { assigneeId: "d-admin2", version: 4 })).toMatchObject({ assigneeId: "d-admin2" });
    const un = await assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, caseId, { assigneeId: null, version: 5 });
    expect(un).toMatchObject({ state: "awaiting_assignment", assigneeId: null, version: 6 });
    expect((await ctx.audit()).filter((row) => row.target_id === caseId).slice(2).map((row) => ({ action: row.action, metadata: row.metadata }))).toEqual([
      { action: "followup.case.assign", metadata: { from: "awaiting_assignment", to: "assigned", assignee: "d-member" } },
      { action: "followup.case.assign", metadata: { from: "assigned", to: "assigned", assignee: "d-member2", previousAssignee: "d-member" } },
      { action: "followup.case.assign", metadata: { from: "assigned", to: "assigned", assignee: "d-admin2", previousAssignee: "d-member2" } },
      { action: "followup.case.unassign", metadata: { from: "assigned", to: "awaiting_assignment", previousAssignee: "d-admin2" } }]);
  });

  it("refuses viewers, outsiders, unknown users and other ministries' members as assignees", async () => {
    const { caseId } = await ctx.seedCase();
    await move("d-owner", caseId, "awaiting_assignment");
    for (const assignee of ["d-viewer", "d-other", "d-stranger", "nobody", "d-owner-of-nothing"]) {
      expect(await assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, caseId, { assigneeId: assignee, version: 2 }).catch((error) => error)).toMatchObject({ status: 400, details: { reason: "assignee_not_eligible" } });
    }
    // The database says the same to a direct write.
    await expect(ctx.f.admin.query("update followup_cases set state = 'assigned', assignee_id = 'd-viewer' where id = $1", [caseId])).rejects.toThrow("assignee is not an eligible member");
    await expect(ctx.f.admin.query("update followup_cases set state = 'assigned', assignee_id = 'd-other' where id = $1", [caseId])).rejects.toThrow("assignee is not an eligible member");
    // With the guard out of the way the composite foreign key still ties an assignee to this ministry's membership.
    await ctx.f.admin.query("alter table followup_cases disable trigger followup_case_guard");
    try { await expect(ctx.f.admin.query("update followup_cases set state = 'assigned', assignee_id = 'd-other', assigned_at = now() where id = $1", [caseId])).rejects.toThrow(/violates foreign key/); }
    finally { await ctx.f.admin.query("alter table followup_cases enable trigger followup_case_guard"); }
    expect(await ctx.caseRow(caseId)).toMatchObject({ state: "awaiting_assignment", assignee_id: null });
  });

  it("allows only owners and admins to assign or unassign, with one 403 for everyone else", async () => {
    const { caseId } = await assigned("d-member");
    const v = await version(caseId);
    const denials = [];
    for (const user of ["d-member", "d-member2", "d-viewer", "d-other"]) denials.push(await assignFollowUpCase(ctx.f.db, user, ctx.tenantA, caseId, { assigneeId: "d-member2", version: v }).catch((error) => error));
    for (const denial of denials) expect(denial).toMatchObject({ status: 403, message: denials[0].message });
    for (const user of ["d-member", "d-viewer"]) await expect(asApp(user, ctx.tenantA, sql`select public.assign_followup_case(${ctx.tenantA}::uuid, ${caseId}::uuid, 'd-member2', ${v}::integer)`)).rejects.toMatchObject({ cause: { code: "42501" } });
    expect(await ctx.caseRow(caseId)).toMatchObject({ assignee_id: "d-member", version: v });
  });

  it("refuses to assign while follow-up consent is withdrawn, and to make an attempt", async () => {
    const seeded = await ctx.seedCase();
    await move("d-owner", seeded.caseId, "awaiting_assignment");
    await ctx.withdrawCrm(seeded.contactId);
    expect(await assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, seeded.caseId, { assigneeId: "d-member", version: 2 }).catch((error) => error)).toMatchObject({ status: 409, details: { reason: "consent_not_in_effect" } });
    // Staff can still record the person's withdrawal on the case.
    await move("d-owner", seeded.caseId, "withdrawn");
    expect((await ctx.caseRow(seeded.caseId))?.state).toBe("withdrawn");
    const second = await assigned("d-member");
    await ctx.withdrawCrm(second.contactId);
    expect(await move("d-member", second.caseId, "attempted").catch((error) => error)).toMatchObject({ status: 409, details: { reason: "consent_not_in_effect" } });
  });
});

describe("access: database level", () => {
  it("shows owners and admins every case and a counselor only their own open ones, at once on reassignment", async () => {
    const a = await assigned("d-member"), b = await assigned("d-member2"), c = await ctx.seedCase();
    const all = [a.caseId, b.caseId, c.caseId];
    for (const user of ["d-owner", "d-admin"]) expect(await seen(user)).toEqual(expect.arrayContaining(all));
    expect(await seen("d-member")).toContain(a.caseId);
    expect(await seen("d-member")).not.toContain(b.caseId); expect(await seen("d-member")).not.toContain(c.caseId);
    expect(await seen("d-member2")).toContain(b.caseId); expect(await seen("d-member2")).not.toContain(a.caseId);
    for (const user of ["d-viewer"]) expect(await seen(user)).toEqual([]);
    expect(await seen("d-other", ctx.tenantB)).toEqual([]);
    expect(await forged("d-other", ctx.tenantA, sql`select id from followup_cases`).then((r) => r.rows)).toEqual([]);
    expect(await forged("d-stranger", ctx.tenantA, sql`select id from followup_cases`).then((r) => r.rows)).toEqual([]);
    expect(await ctx.f.db.execute(sql`select count(*) from information_schema.tables`).then(() => "ok")).toBe("ok");
    await expect(ctx.f.db.execute(sql`select id from followup_cases`)).resolves.toMatchObject({ rows: [] });
    // Reassignment ends the former counselor's access immediately; the new one gains it.
    await assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, a.caseId, { assigneeId: "d-member2", version: await version(a.caseId) });
    expect(await seen("d-member")).not.toContain(a.caseId); expect(await seen("d-member2")).toContain(a.caseId);
    // A finished case leaves the counselor's view; owners and admins keep it.
    for (const to of ["attempted", "connected", "closed"]) await move("d-member2", a.caseId, to);
    expect(await seen("d-member2")).not.toContain(a.caseId); expect(await seen("d-admin")).toContain(a.caseId);
  });

  it("returns the same rows to a counselor whose role is demoted or who is removed, and returns their cases to the queue", async () => {
    await ctx.f.admin.query("insert into users (id,name,email) values ('d-temp','Temp','d-temp@example.test') on conflict do nothing");
    await putMember(ctx.f.db, "d-owner", ctx.tenantA, "d-temp@example.test", "member");
    const a = await assigned("d-temp"), b = await assigned("d-temp");
    await move("d-temp", b.caseId, "attempted");
    await move("d-temp", b.caseId, "no_response");
    expect(await seen("d-temp")).toEqual(expect.arrayContaining([a.caseId, b.caseId]));
    await putMember(ctx.f.db, "d-owner", ctx.tenantA, "d-temp@example.test", "viewer");
    expect(await seen("d-temp")).toEqual([]);
    expect(await ctx.caseRow(a.caseId)).toMatchObject({ state: "awaiting_assignment", assignee_id: null });
    expect(await ctx.caseRow(b.caseId)).toMatchObject({ state: "no_response", assignee_id: null });
    expect((await ctx.audit("followup.case.revoke")).filter((row) => row.target_id === a.caseId)).toEqual([
      { actor_id: "d-owner", action: "followup.case.revoke", target_id: a.caseId, metadata: { from: "assigned", to: "awaiting_assignment", previousAssignee: "d-temp" } }]);
    expect(await status(getFollowUpCase(ctx.f.db, "d-temp", ctx.tenantA, a.caseId))).toBe(403);
    // Promoting again does not restore anything; a removed member cannot be assigned or see cases.
    await putMember(ctx.f.db, "d-owner", ctx.tenantA, "d-temp@example.test", "member");
    expect(await seen("d-temp")).toEqual([]);
    const c = await assigned("d-temp");
    await ctx.f.admin.query("delete from workspace_members where user_id = 'd-temp' and tenant_id = $1", [ctx.tenantA]);
    expect(await ctx.caseRow(c.caseId)).toMatchObject({ state: "awaiting_assignment", assignee_id: null });
    expect(await status(getFollowUpCase(ctx.f.db, "d-temp", ctx.tenantA, c.caseId))).toBe(403);
  });
});

describe("access: API level", () => {
  let mine: string, theirs: string, unassigned: string;
  beforeAll(async () => { mine = (await assigned("d-member")).caseId; theirs = (await assigned("d-member2")).caseId; unassigned = (await ctx.seedCase()).caseId; });

  it("answers owners and admins with every case and minimal fields only", async () => {
    for (const user of ["d-owner", "d-admin"]) {
      const { status: code, body } = await http(user, "GET", "followup-cases?limit=200");
      expect(code).toBe(200);
      const { items } = JSON.parse(body) as { items: Record<string, unknown>[]; nextCursor: string | null };
      expect(items.map((item) => item.id)).toEqual(expect.arrayContaining([mine, theirs, unassigned]));
      expect(Object.keys(items[0]).sort()).toEqual(["assignedAt", "assigneeId", "contactId", "createdAt", "id", "state", "stateChangedAt", "updatedAt", "version"]);
      expect(body).not.toMatch(new RegExp(`${H13.name}|example\\.test|campaign|responseId|campaignId`));
      expect(Object.keys(JSON.parse(body))).toEqual(["items", "nextCursor"]);
    }
  });

  it("answers a counselor with only their own case, and the same 403 for every case that is not theirs", async () => {
    const list = JSON.parse((await http("d-member", "GET", "followup-cases?limit=200")).body) as { items: { id: string; assigneeId: string }[] };
    expect(list.items.map((item) => item.id)).toContain(mine);
    expect(list.items.every((item) => item.assigneeId === "d-member")).toBe(true);
    expect((await http("d-member", "GET", `followup-cases/${mine}`, ctx.tenantA, undefined, mine)).status).toBe(200);
    const denials = [await http("d-member", "GET", `followup-cases/${theirs}`, ctx.tenantA, undefined, theirs), await http("d-member", "GET", `followup-cases/${unassigned}`, ctx.tenantA, undefined, unassigned),
      await http("d-member", "GET", "x", ctx.tenantA, undefined, randomUUID()), await http("d-viewer", "GET", `followup-cases/${mine}`, ctx.tenantA, undefined, mine),
      await http("d-other", "GET", `followup-cases/${mine}`, ctx.tenantA, undefined, mine),
      await http("d-stranger", "GET", `followup-cases/${mine}`, ctx.tenantA, undefined, mine)];
    for (const denial of denials) expect(denial).toEqual({ status: 403, body: denials[0].body });
    expect(denials[0].body).not.toMatch(/\d|case|exist|count/i);
    // Owners learn an id is unknown; counselors cannot tell unknown from not theirs.
    expect((await http("d-owner", "GET", "x", ctx.tenantA, undefined, randomUUID())).status).toBe(404);
    expect((await http("d-owner", "GET", `followup-cases/${mine}`, ctx.tenantB, undefined, mine)).status).toBe(403);
    // The other ministry's owner is an owner there: its own ids are 404, and tenant A's case id reveals nothing.
    expect((await http("d-other", "GET", "x", ctx.tenantB, undefined, mine)).status).toBe(404);
    expect((await http("d-owner", "GET", "x", ctx.tenantA, undefined, "not-a-uuid")).status).toBe(400);
  });

  it("answers list requests from viewers, outsiders and anonymous callers without counts or existence signals", async () => {
    const denials = [await http("d-viewer", "GET", "followup-cases"), await http("d-other", "GET", "followup-cases"), await http("d-stranger", "GET", "followup-cases"), await http("d-other", "GET", "followup-cases", randomUUID())];
    for (const denial of denials) expect(denial).toEqual({ status: 403, body: denials[0].body });
    expect(denials[0].body).not.toMatch(/\d|case|count/i);
    expect((await http(null, "GET", "followup-cases")).status).toBe(401);
    expect((await http(null, "POST", "followup-cases", ctx.tenantA, {})).status).toBe(401);
    expect((await http(null, "GET", "x", ctx.tenantA, undefined, mine)).status).toBe(401);
    expect((await http(null, "PATCH", "x", ctx.tenantA, { to: "closed", version: 1 }, mine)).status).toBe(401);
    for (const bad of ["followup-cases?limit=0", "followup-cases?limit=abc", "followup-cases?cursor=%%%", "followup-cases?state=bogus", "followup-cases?limit=-1"]) expect((await http("d-owner", "GET", bad)).status, bad).toBe(400);
    // A counselor's page is empty of other people's cases and carries no total.
    const mineOnly = JSON.parse((await http("d-member2", "GET", "followup-cases")).body);
    expect(mineOnly.items.map((item: { id: string }) => item.id)).not.toContain(mine);
  });

  it("applies the write matrix through PATCH and POST", async () => {
    const v = await version(mine);
    expect((await http("d-member", "PATCH", "x", ctx.tenantA, { assigneeId: "d-member2", version: v }, mine)).status).toBe(403);
    expect((await http("d-member2", "PATCH", "x", ctx.tenantA, { to: "attempted", version: await version(mine) }, mine)).status).toBe(403);
    expect((await http("d-viewer", "PATCH", "x", ctx.tenantA, { to: "attempted", version: v }, mine)).status).toBe(403);
    expect((await http("d-other", "PATCH", "x", ctx.tenantA, { to: "attempted", version: v }, mine)).status).toBe(403);
    expect((await http("d-member", "PATCH", "x", ctx.tenantA, { to: "withdrawn", version: v }, mine)).status).toBe(403);
    expect((await http("d-member", "PATCH", "x", ctx.tenantA, { to: "connected", version: v }, mine)).status).toBe(409);
    expect((await http("d-member", "PATCH", "x", ctx.tenantA, [], mine)).status).toBe(400);
    expect((await http("d-member", "PATCH", "x", ctx.tenantA, { to: "attempted", version: v, extra: 1 }, mine)).status).toBe(400);
    const ok = await http("d-member", "PATCH", "x", ctx.tenantA, { to: "attempted", version: v }, mine);
    expect(ok.status).toBe(200); expect(JSON.parse(ok.body)).toMatchObject({ id: mine, state: "attempted", assigneeId: "d-member", version: v + 1 });
    const reassigned = await http("d-admin", "PATCH", "x", ctx.tenantA, { assigneeId: "d-member2", version: v + 1 }, mine);
    expect(reassigned.status).toBe(200); expect(JSON.parse(reassigned.body)).toMatchObject({ state: "assigned", assigneeId: "d-member2" });
    expect((await http("d-member", "PATCH", "x", ctx.tenantA, { to: "attempted", version: v + 2 }, mine)).status).toBe(403);
    expect((await http("d-member", "POST", "followup-cases", ctx.tenantA, {})).status).toBe(403);
    expect((await http("d-viewer", "POST", "followup-cases", ctx.tenantA, {})).status).toBe(403);
    expect((await http("d-owner", "POST", "followup-cases", ctx.tenantA, { limit: 0 })).status).toBe(400);
    expect((await http("d-owner", "POST", "followup-cases", ctx.tenantA, { surprise: true })).status).toBe(400);
    const open = await http("d-admin", "POST", "followup-cases", ctx.tenantA);
    expect(open.status).toBe(200); expect(Object.keys(JSON.parse(open.body))).toEqual(["opened"]);
  });
});

describe("paging", () => {
  let ids: string[];
  beforeAll(async () => {
    // 205 associated responses, bulk-seeded; one call opens 200 of them in a single transaction (so every case shares one creation time).
    const n = 205;
    const { rows } = await ctx.f.admin.query(`with c as (insert into contacts (tenant_id, name) select $1, 'Bulk ' || g from generate_series(1, $2) g returning id),
      cn as (select id, row_number() over () as rn from c),
      r as (insert into campaign_responses (tenant_id, campaign_id, link_id, form_version_id, public_submission_id) select $1, $3, $4, $5, gen_random_uuid() from generate_series(1, $2) returning id),
      rn as (select id, row_number() over () as rn from r)
      select cn.id as contact_id, rn.id as response_id from cn join rn using (rn)`, [ctx.tenantA, n, ctx.campaign, ctx.link, ctx.version]);
    if (rows.length !== n) throw new Error("bulk seed failed");
    await ctx.f.admin.query("alter table campaign_responses disable trigger campaign_response_guard"); await ctx.f.admin.query("alter table campaign_response_consents disable trigger campaign_response_consent_guard");
    try {
      await ctx.f.admin.query("update campaign_responses r set status = 'associated', contact_id = x.contact_id, associated_at = now() from (select * from jsonb_to_recordset($1::jsonb) as t(contact_id uuid, response_id uuid)) x where r.id = x.response_id", [JSON.stringify(rows)]);
      await ctx.f.admin.query(`insert into campaign_response_consents (tenant_id, response_id, purpose, status, channel, form_version_id, notice_version_id, actor_kind)
        select $1, response_id, 'outreach_follow_up', 'granted', 'email', $2, $3, 'subject' from jsonb_to_recordset($4::jsonb) as t(contact_id uuid, response_id uuid)`, [ctx.tenantA, ctx.version, ctx.notice, JSON.stringify(rows)]);
      await ctx.f.admin.query("begin");
      await ctx.f.admin.query("select set_config('app.user_id', 'd-owner', true)");
      await ctx.f.admin.query(`insert into contact_consents (tenant_id, contact_id, purpose, notice_version, channel, status, source, evidence, recorded_by, occurred_at)
        select $1, contact_id, 'outreach_follow_up', 'notice-v1', 'email', 'granted', 'Connect', 'Explicit response choice', 'd-owner', now() - interval '1 minute' from jsonb_to_recordset($2::jsonb) as t(contact_id uuid, response_id uuid)`, [ctx.tenantA, JSON.stringify(rows)]);
      await ctx.f.admin.query("commit");
    } finally { await ctx.f.admin.query("alter table campaign_responses enable trigger campaign_response_guard"); await ctx.f.admin.query("alter table campaign_response_consents enable trigger campaign_response_consent_guard"); }
    // Cap: 200 per call, however large the request; the rest on the next call.
    expect(await openEligibleFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA, { limit: 100000 })).toEqual({ opened: 200 });
    expect((await openEligibleFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA, { limit: 100000 })).opened).toBeGreaterThanOrEqual(5);
    ids = (await ctx.f.admin.query("select id from followup_cases where response_id = any($1::uuid[]) order by created_at, id", [rows.map((row: { response_id: string }) => row.response_id)])).rows.map((row) => row.id);
    expect(ids).toHaveLength(n);
  }, 120_000);

  it("returns 50 by default, never more than 200, in a stable created-time then id order, and walks every row once", async () => {
    const first = await listFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA);
    expect(first.items).toHaveLength(50); expect(first.nextCursor).not.toBeNull();
    expect((await listFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA, { limit: 100000 })).items).toHaveLength(200);
    const seenIds: string[] = []; let cursor: string | undefined; let pages = 0;
    do {
      const page = await listFollowUpCases(ctx.f.db, "d-admin", ctx.tenantA, { limit: 60, cursor }); pages += 1;
      seenIds.push(...page.items.map((item) => item.id)); cursor = page.nextCursor ?? undefined;
    } while (cursor && pages < 100);
    expect(new Set(seenIds).size).toBe(seenIds.length);
    // Tied creation times (200 cases from one transaction) are ordered by id, so the walk equals the database order.
    const database = (await ctx.f.admin.query("select id from followup_cases where tenant_id = $1 order by created_at, id", [ctx.tenantA])).rows.map((row) => row.id);
    expect(seenIds).toEqual(database);
    expect(await listFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA, { state: "withdrawn", limit: 5 })).toMatchObject({ nextCursor: null });
    await expect(listFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA, { limit: 0 })).rejects.toBeDefined();
    await expect(listFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA, { cursor: "AAAA" })).rejects.toBeDefined();
  });
});

describe("audit without personal data", () => {
  it("records ids and states only, and survives the case without any link to the person", async () => {
    const dump = JSON.stringify((await ctx.f.admin.query("select * from audit_logs where tenant_id = $1 and action like 'followup.%'", [ctx.tenantA])).rows);
    expect(dump.length).toBeGreaterThan(100);
    for (const secret of [H13.name, "example.test", "Synthetic", "Bulk"]) expect(dump.replace(/d-[a-z0-9]+@example\.test/g, "")).not.toContain(secret);
    const rows = (await ctx.audit()).filter((row) => row.actor_id);
    const allowed = new Set(["from", "to", "assignee", "previousAssignee"]);
    for (const row of rows) for (const key of Object.keys(row.metadata)) expect(allowed.has(key), key).toBe(true);
    const people = (await ctx.f.admin.query("select contact_id, response_id, campaign_id from followup_cases limit 20")).rows;
    for (const person of people) for (const value of Object.values(person)) expect(dump).not.toContain(value as string);
  });
});

describe("erasure, merge and retention", () => {
  it("deletes the case when the person is erased, leaving nothing identifying and the kept audit rows unlinkable", async () => {
    const seeded = await ctx.seedCase();
    const other = await ctx.seedCase();
    expect(await eraseContact(ctx.f.db, "d-owner", ctx.tenantA, seeded.contactId)).toEqual({ erased: true });
    expect(await ctx.caseRow(seeded.caseId)).toBeUndefined();
    expect(await ctx.caseRow(other.caseId)).toMatchObject({ state: "requested" });
    const dump = JSON.stringify([(await ctx.f.admin.query("select * from followup_cases")).rows, (await ctx.f.admin.query("select * from audit_logs where tenant_id = $1", [ctx.tenantA])).rows]);
    for (const secret of [seeded.contactId, seeded.response, seeded.email]) expect(dump).not.toContain(secret);
    // The erased person's response key is not reusable: no second case can appear for it.
    expect(await openEligibleFollowUpCases(ctx.f.db, "d-owner", ctx.tenantA)).toEqual({ opened: 0 });
    expect(await status(getFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, seeded.caseId))).toBe(404);
  });

  it("deletes the case when only the response is erased, keeping the person's contact", async () => {
    const seeded = await ctx.seedCase();
    await assignFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, seeded.caseId, { assigneeId: null, version: 1 }).catch(() => undefined);
    expect(await eraseConnectResponse(ctx.f.db, "d-owner", ctx.tenantA, seeded.response)).toEqual({ erased: true });
    expect(await ctx.caseRow(seeded.caseId)).toBeUndefined();
    expect((await ctx.f.admin.query("select erased_at from contacts where id = $1", [seeded.contactId])).rows[0].erased_at).toBeNull();
  });

  it("deletes the case when the retention sweep expires its response", async () => {
    const seeded = await ctx.seedCase();
    await ctx.f.admin.query("alter table campaign_responses disable trigger campaign_response_guard");
    try { await ctx.f.admin.query("update campaign_responses set expires_at = now() - interval '1 minute' where id = $1", [seeded.response]); }
    finally { await ctx.f.admin.query("alter table campaign_responses enable trigger campaign_response_guard"); }
    const result = (await ctx.f.admin.query("select public.connect_retention_sweep(1000) as r")).rows[0].r as { erased: number; failed: number };
    expect(result.failed).toBe(0); expect(result.erased).toBeGreaterThanOrEqual(1);
    expect(await ctx.caseRow(seeded.caseId)).toBeUndefined();
  });

  it("moves the case with the response when two contacts are merged, then erases it with the source contact's remains", async () => {
    const seeded = await ctx.seedCase();
    const target = await createContact(ctx.f.db, "d-owner", ctx.tenantA, { name: "Merge target", email: `merge-target-${randomUUID().slice(0, 6)}@example.test` });
    const [sourceRow] = (await ctx.f.admin.query("select version from contacts where id = $1", [seeded.contactId])).rows;
    const [targetRow] = (await ctx.f.admin.query("select version from contacts where id = $1", [target.id])).rows;
    await mergeContacts(ctx.f.db, "d-owner", ctx.tenantA, target.id, { sourceId: seeded.contactId, sourceVersion: sourceRow.version, targetVersion: targetRow.version });
    expect(await ctx.caseRow(seeded.caseId)).toMatchObject({ contact_id: target.id, state: "requested" });
    expect((await getFollowUpCase(ctx.f.db, "d-owner", ctx.tenantA, seeded.caseId)).contactId).toBe(target.id);
    // Erasing the kept contact now removes the case too.
    await eraseContact(ctx.f.db, "d-owner", ctx.tenantA, target.id);
    expect(await ctx.caseRow(seeded.caseId)).toBeUndefined();
  });
});

describe("races (two connections)", () => {
  it("lets exactly one of two concurrent assignments with the same version win", async () => {
    const pools = [new Pool({ connectionString: ctx.f.appURL, max: 1 }), new Pool({ connectionString: ctx.f.appURL, max: 1 })];
    try {
      const dbs = pools.map((pool) => drizzle(pool, { schema }));
      for (let round = 0; round < 3; round += 1) {
        const { caseId } = await ctx.seedCase();
        await move("d-owner", caseId, "awaiting_assignment");
        const results = await Promise.all([assignFollowUpCase(dbs[0], "d-owner", ctx.tenantA, caseId, { assigneeId: "d-member", version: 2 }).then(() => 200, (e: { status?: number }) => e.status),
          assignFollowUpCase(dbs[1], "d-admin", ctx.tenantA, caseId, { assigneeId: "d-member2", version: 2 }).then(() => 200, (e: { status?: number }) => e.status)]);
        expect(results.sort()).toEqual([200, 409]);
        expect((await state(caseId)).version).toBe(3);
      }
    } finally { await Promise.all(pools.map((pool) => pool.end())); }
  });

  it("never leaves a case assigned to a member who was demoted while the assignment was being made", async () => {
    await ctx.f.admin.query("insert into users (id,name,email) values ('d-race','Race','d-race@example.test') on conflict do nothing");
    const pools = [new Pool({ connectionString: ctx.f.appURL, max: 1 }), new Pool({ connectionString: ctx.f.appURL, max: 1 })];
    try {
      const dbs = pools.map((pool) => drizzle(pool, { schema }));
      for (let round = 0; round < 4; round += 1) {
        await putMember(ctx.f.db, "d-owner", ctx.tenantA, "d-race@example.test", "member");
        const { caseId } = await ctx.seedCase();
        await move("d-owner", caseId, "awaiting_assignment");
        await Promise.all([assignFollowUpCase(dbs[0], "d-owner", ctx.tenantA, caseId, { assigneeId: "d-race", version: 2 }).catch(() => undefined),
          putMember(dbs[1], "d-admin2", ctx.tenantA, "d-race@example.test", "viewer").catch(() => undefined)]);
        const row = await state(caseId);
        const role = (await ctx.f.admin.query("select role_id from workspace_members where user_id = 'd-race' and tenant_id = $1", [ctx.tenantA])).rows[0]?.role_id;
        // Either the demotion won (no assignee, back in the queue) or the assignment landed first and the demotion then released it.
        if (role === "viewer") expect(row.assignee_id).toBeNull();
        else expect(role).toBe("member");
        expect(["awaiting_assignment", "assigned"]).toContain(row.state);
      }
    } finally { await Promise.all(pools.map((pool) => pool.end())); }
  }, 60_000);

  it("keeps a case from surviving the erasure of its person when opening races the erasure", async () => {
    const seeded = await ctx.seedAssociated();
    const pools = [new Pool({ connectionString: ctx.f.appURL, max: 1 }), new Pool({ connectionString: ctx.f.appURL, max: 1 })];
    try {
      const dbs = pools.map((pool) => drizzle(pool, { schema }));
      await Promise.all([openEligibleFollowUpCases(dbs[0], "d-owner", ctx.tenantA, { limit: 200 }).catch(() => undefined), eraseContact(dbs[1], "d-admin", ctx.tenantA, seeded.contactId).catch(() => undefined)]);
      const leftover = (await ctx.f.admin.query("select count(*)::int as n from followup_cases where response_id = $1 or contact_id = $2", [seeded.response, seeded.contactId])).rows[0].n;
      expect(leftover).toBe(0);
    } finally { await Promise.all(pools.map((pool) => pool.end())); }
  }, 60_000);
});
