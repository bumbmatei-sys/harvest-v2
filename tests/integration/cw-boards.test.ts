import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { withTenant } from "../../src/server/tenancy";
import { createCampaign } from "../../src/server/campaigns";
import { createDraft, finishDraft, saveDraftStep } from "../../src/server/campaign-wizard";
import { getCampaignOverview } from "../../src/server/campaign-overview";
import {
  createCampaignMilestone, createCampaignTask, deleteCampaignMilestone, deleteCampaignTask, getCampaignBoards, updateCampaignMilestone, updateCampaignTask,
} from "../../src/server/campaign-boards";

// Campaign boards, tasks and milestones (founder approval, 26 Nov): campaign-scoped department boards; CRM-05 crm_tasks are untouched.
vi.mock("server-only", () => ({}));
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenantA: string, tenantB: string, campaign: string, plain: string;
const status = (promise: Promise<unknown>) => promise.then(() => 200, (error: { status?: number; name?: string }) => error.status ?? (error.name === "ZodError" ? 400 : 500));
const place = { country: "Kenya", cityRegion: "Nairobi", startDate: "2027-05-01", endDate: "2027-05-03", timeZone: "Africa/Nairobi", structure: "single" };
const tasksOf = (view: Awaited<ReturnType<typeof getCampaignBoards>>, board: string) => view.boards.find((entry) => entry.key === board)?.tasks ?? [];

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "admin-a", "member-a", "viewer-a", "outsider", "owner-b"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "Boards A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "Boards B")).tenantId;
  for (const [user, role] of [["admin-a", "admin"], ["member-a", "member"], ["viewer-a", "viewer"]] as const) await putMember(fixture.db, "owner-a", tenantA, `${user}@example.test`, role);
  const { draft } = await createDraft(fixture.db, "member-a", tenantA, { type: "conference" }, "boards-1");
  let version = (await saveDraftStep(fixture.db, "member-a", tenantA, draft.id, { version: 1, step: "leaders", data: { departments: ["volunteers", "counseling"] } })).version;
  version = (await saveDraftStep(fixture.db, "member-a", tenantA, draft.id, { version, step: "basics", data: { name: "Synthetic conference" } })).version;
  version = (await saveDraftStep(fixture.db, "member-a", tenantA, draft.id, { version, step: "place", data: place })).version;
  campaign = (await finishDraft(fixture.db, "member-a", tenantA, draft.id, { version })).campaignId;
  plain = (await createCampaign(fixture.db, "owner-a", tenantA, { name: "Plain campaign", type: "local_outreach" }, randomUUID())).id;
});
afterAll(async () => { await fixture?.close(); });

describe("database shape", () => {
  it("forces RLS, grants no board update or delete and no whole-row update, and adds no definer function", async () => {
    const rls = await fixture.admin.query("select relname, relrowsecurity as r, relforcerowsecurity as f from pg_class where relname in ('campaign_boards','campaign_milestones','campaign_tasks') order by relname");
    expect(rls.rows).toEqual(["campaign_boards", "campaign_milestones", "campaign_tasks"].map((relname) => ({ relname, r: true, f: true })));
    const grants = await fixture.admin.query(`select has_table_privilege('harvest_app','campaign_boards','UPDATE') as board_update, has_table_privilege('harvest_app','campaign_boards','DELETE') as board_delete,
      has_table_privilege('harvest_app','campaign_tasks','UPDATE') as task_update, has_table_privilege('harvest_app','campaign_tasks','DELETE') as task_delete,
      has_table_privilege('public','campaign_tasks','SELECT') as public_read`);
    expect(grants.rows).toEqual([{ board_update: false, board_delete: false, task_update: false, task_delete: true, public_read: false }]);
    const columns = await fixture.admin.query("select column_name from information_schema.column_privileges where grantee='harvest_app' and table_name='campaign_tasks' and privilege_type='UPDATE' order by 1");
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(expect.arrayContaining(["tenant_id", "campaign_id", "created_by", "id"]));
    expect((await fixture.admin.query("select count(*)::int as n from pg_proc where prosecdef and prosrc ilike '%campaign_tasks%'")).rows[0].n).toBe(0);
    const policies = await fixture.admin.query("select policyname, coalesce(qual, '') || coalesce(with_check, '') as body from pg_policies where tablename in ('campaign_boards','campaign_milestones','campaign_tasks')");
    expect(policies.rows.length).toBe(10);
    for (const row of policies.rows) expect(row.body, row.policyname).toMatch(/access_role/);
    const refs = await fixture.admin.query("select distinct confrelid::regclass::text as target from pg_constraint where contype = 'f' and conrelid in ('campaign_tasks'::regclass, 'campaign_milestones'::regclass, 'campaign_boards'::regclass)");
    expect(refs.rows.map((row) => row.target).sort()).toEqual(["campaign_boards", "campaign_milestones", "campaigns", "users"]); // no CRM contact, no crm_tasks
  });
});

describe("boards and tasks", () => {
  it("offers the campaign-wide board plus each included department, and only the campaign-wide board without the wizard", async () => {
    const view = await getCampaignBoards(fixture.db, "member-a", tenantA, campaign);
    expect(view.boards.map((board) => board.key)).toEqual(["general", "volunteers", "counseling"]);
    expect(view.writable).toBe(true);
    expect(view.assignees.map((person) => person.id).sort()).toEqual(["admin-a", "member-a", "owner-a"]);
    expect(JSON.stringify(view)).not.toMatch(/example\.test/);
    expect((await getCampaignBoards(fixture.db, "owner-a", tenantA, plain)).boards.map((board) => board.key)).toEqual(["general"]);
    expect(await status(createCampaignTask(fixture.db, "owner-a", tenantA, plain, { board: "volunteers", title: "Not here" }))).toBe(400);
  });

  it("adds, orders, moves, reorders and completes tasks, checked against the loaded version", async () => {
    const first = await createCampaignTask(fixture.db, "member-a", tenantA, campaign, { board: "volunteers", title: "Recruit ushers", assigneeId: "admin-a", dueDate: "2027-04-01" });
    const second = await createCampaignTask(fixture.db, "member-a", tenantA, campaign, { board: "volunteers", title: "Print badges" });
    const third = await createCampaignTask(fixture.db, "admin-a", tenantA, campaign, { board: "volunteers", title: "Brief team" });
    let view = await getCampaignBoards(fixture.db, "member-a", tenantA, campaign);
    expect(tasksOf(view, "volunteers").map((task) => [task.title, task.status, task.position])).toEqual([["Recruit ushers", "todo", 0], ["Print badges", "todo", 1], ["Brief team", "todo", 2]]);
    expect(tasksOf(view, "volunteers")[0]).toMatchObject({ assigneeId: "admin-a", assigneeName: "admin-a", dueDate: "2027-04-01", version: 1, completedAt: null });
    // Reorder within the column: the third card to the top.
    view = await updateCampaignTask(fixture.db, "member-a", tenantA, campaign, third.id, { version: 1, position: 0 });
    expect(tasksOf(view, "volunteers").filter((task) => task.status === "todo").map((task) => task.title)).toEqual(["Brief team", "Recruit ushers", "Print badges"]);
    // Move across columns, then complete.
    view = await updateCampaignTask(fixture.db, "member-a", tenantA, campaign, first.id, { version: 1, status: "in_progress" });
    view = await updateCampaignTask(fixture.db, "admin-a", tenantA, campaign, first.id, { version: 2, status: "done" });
    const done = tasksOf(view, "volunteers").find((task) => task.id === first.id)!;
    expect(done).toMatchObject({ status: "done", version: 3, position: 0 });
    expect(done.completedAt).not.toBeNull();
    // An old version is refused and changes nothing.
    expect(await status(updateCampaignTask(fixture.db, "member-a", tenantA, campaign, first.id, { version: 2, title: "Stale" }))).toBe(409);
    // Moving back out of done clears the completion; moving to another department's board works.
    view = await updateCampaignTask(fixture.db, "member-a", tenantA, campaign, first.id, { version: 3, status: "todo", board: "counseling" });
    expect(tasksOf(view, "counseling")[0]).toMatchObject({ id: first.id, status: "todo", completedAt: null });
    // Clearing optional fields with null.
    view = await updateCampaignTask(fixture.db, "member-a", tenantA, campaign, first.id, { version: 4, assigneeId: null, dueDate: null, notes: "Call churches" });
    expect(tasksOf(view, "counseling")[0]).toMatchObject({ assigneeId: null, assigneeName: null, dueDate: null, notes: "Call churches" });
    expect(await status(deleteCampaignTask(fixture.db, "member-a", tenantA, campaign, second.id, { version: 9 }))).toBe(409);
    view = await deleteCampaignTask(fixture.db, "member-a", tenantA, campaign, second.id, { version: 1 });
    expect(tasksOf(view, "volunteers").map((task) => task.id)).not.toContain(second.id);
    const { rows } = await fixture.admin.query("select action, metadata from audit_logs where tenant_id = $1 and action like 'campaign.task.%' and target_id = $2 order by created_at", [tenantA, first.id]);
    expect(rows.map((row) => row.action)).toEqual(["campaign.task.create", "campaign.task.update", "campaign.task.update", "campaign.task.update", "campaign.task.update"]);
    expect(JSON.stringify(rows)).not.toMatch(/Recruit|Call churches/); // content-free audit
  });

  it("assigns only people who can write campaigns here", async () => {
    for (const assigneeId of ["viewer-a", "outsider", "owner-b"]) {
      expect(await status(createCampaignTask(fixture.db, "member-a", tenantA, campaign, { board: "general", title: "Assign", assigneeId })), assigneeId).toBe(400);
    }
    const ok = await createCampaignTask(fixture.db, "member-a", tenantA, campaign, { board: "general", title: "Assign", assigneeId: "owner-a" });
    expect(await status(updateCampaignTask(fixture.db, "member-a", tenantA, campaign, ok.id, { version: 1, assigneeId: "viewer-a" }))).toBe(400);
  });
});

describe("milestones", () => {
  it("records milestones for the campaign or one board, links tasks, and keeps tasks when a milestone is removed", async () => {
    const launch = await createCampaignMilestone(fixture.db, "member-a", tenantA, campaign, { title: "Volunteers trained", dueDate: "2027-04-20", board: "volunteers" });
    const whole = await createCampaignMilestone(fixture.db, "admin-a", tenantA, campaign, { title: "Venue confirmed" });
    const task = await createCampaignTask(fixture.db, "member-a", tenantA, campaign, { board: "volunteers", title: "Training night", milestoneId: launch.id, status: "done" });
    let view = await getCampaignBoards(fixture.db, "member-a", tenantA, campaign);
    expect(view.milestones.map((milestone) => [milestone.title, milestone.board, milestone.tasks, milestone.tasksDone])).toEqual([["Volunteers trained", "volunteers", 1, 1], ["Venue confirmed", null, 0, 0]]);
    view = await updateCampaignMilestone(fixture.db, "member-a", tenantA, campaign, whole.id, { version: 1, reached: true });
    expect(view.milestones.find((milestone) => milestone.id === whole.id)).toMatchObject({ reached: true, version: 2 });
    expect(await status(updateCampaignMilestone(fixture.db, "member-a", tenantA, campaign, whole.id, { version: 1, title: "Stale" }))).toBe(409);
    // A milestone of another campaign cannot be linked.
    const other = await createCampaignMilestone(fixture.db, "owner-a", tenantA, plain, { title: "Elsewhere" });
    expect(await status(updateCampaignTask(fixture.db, "member-a", tenantA, campaign, task.id, { version: 1, milestoneId: other.id }))).toBe(400);
    view = await deleteCampaignMilestone(fixture.db, "member-a", tenantA, campaign, launch.id, { version: 1 });
    expect(view.milestones.map((milestone) => milestone.id)).not.toContain(launch.id);
    expect(tasksOf(view, "volunteers").find((item) => item.id === task.id)).toMatchObject({ milestoneId: null, status: "done" });
  });
});

describe("dashboard figures", () => {
  it("reports tasks, overdue, milestones and progress on the overview; progress is null with no tasks, never 0", async () => {
    const before = await getCampaignOverview(fixture.db, "member-a", tenantA, plain);
    expect(before.work.milestones).toEqual({ total: 1, reached: 0 });
    expect(before.unavailable).toEqual(["funding"]); // campaign events (Events on in tests) make events a real figure
    await createCampaignTask(fixture.db, "member-a", tenantA, campaign, { board: "general", title: "Overdue thing", dueDate: "2020-01-01" });
    const overview = await getCampaignOverview(fixture.db, "member-a", tenantA, campaign);
    const view = await getCampaignBoards(fixture.db, "member-a", tenantA, campaign), all = view.boards.flatMap((board) => board.tasks);
    const done = all.filter((task) => task.status === "done").length;
    expect(overview.work.tasks).toEqual({ total: all.length, done, inProgress: all.filter((task) => task.status === "in_progress").length,
      overdue: all.filter((task) => task.status !== "done" && task.dueDate !== null && task.dueDate < new Date().toISOString().slice(0, 10)).length });
    expect(overview.work.tasks.overdue).toBeGreaterThanOrEqual(1);
    expect(overview.work.progress).toBe(Math.floor((done / all.length) * 100));
    expect(overview.work.milestones).toEqual({ total: 1, reached: 1 });
    const fresh = (await createCampaign(fixture.db, "owner-a", tenantA, { name: "Empty", type: "local_outreach" }, randomUUID())).id;
    expect((await getCampaignOverview(fixture.db, "owner-a", tenantA, fresh)).work).toEqual({ tasks: { total: 0, done: 0, inProgress: 0, overdue: 0 }, milestones: { total: 0, reached: 0 }, progress: null });
  });
});

describe("access", () => {
  it("lets viewers read, keeps writes to people who can write campaigns, and stays inside the ministry", async () => {
    const view = await getCampaignBoards(fixture.db, "viewer-a", tenantA, campaign);
    expect(view.writable).toBe(false);
    expect(view.assignees).toEqual([]);
    expect(view.boards.flatMap((board) => board.tasks).length).toBeGreaterThan(0);
    const any = view.boards.flatMap((board) => board.tasks)[0];
    expect(await status(createCampaignTask(fixture.db, "viewer-a", tenantA, campaign, { board: "general", title: "No" }))).toBe(403);
    expect(await status(updateCampaignTask(fixture.db, "viewer-a", tenantA, campaign, any.id, { version: any.version, title: "No" }))).toBe(403);
    expect(await status(createCampaignMilestone(fixture.db, "viewer-a", tenantA, campaign, { title: "No" }))).toBe(403);
    expect(await status(getCampaignBoards(fixture.db, "outsider", tenantA, campaign))).toBe(403);
    expect(await status(getCampaignBoards(fixture.db, "owner-b", tenantB, campaign))).toBe(404);
    expect(await status(createCampaignTask(fixture.db, "owner-b", tenantB, campaign, { board: "general", title: "No" }))).toBe(404);
    expect(await status(updateCampaignTask(fixture.db, "member-a", tenantA, campaign, randomUUID(), { version: 1, title: "No" }))).toBe(404);
  });

  it("enforces the same rules in the database for the application role", async () => {
    const asApp = (user: string, query: ReturnType<typeof sql>) => withTenant(fixture.db, user, tenantA, "workspace:read", (tx) => tx.execute(query));
    const [{ id: board }] = (await fixture.admin.query("select id from campaign_boards where tenant_id = $1 and campaign_id = $2 and department = 'general'", [tenantA, campaign])).rows;
    // A viewer cannot add; a member cannot add as someone else or assign a viewer.
    for (const [user, query] of [
      ["viewer-a", sql`insert into campaign_tasks (tenant_id, campaign_id, board_id, title, created_by) values (${tenantA}, ${campaign}, ${board}, 'x', 'viewer-a')`],
      ["member-a", sql`insert into campaign_tasks (tenant_id, campaign_id, board_id, title, created_by) values (${tenantA}, ${campaign}, ${board}, 'x', 'owner-a')`],
      ["member-a", sql`insert into campaign_tasks (tenant_id, campaign_id, board_id, title, created_by, assignee_id) values (${tenantA}, ${campaign}, ${board}, 'x', 'member-a', 'viewer-a')`],
      ["member-a", sql`update campaign_boards set department = 'counseling'`],
    ] as const) await expect(asApp(user, query), user).rejects.toMatchObject({ cause: { code: "42501" } });
    // A viewer's delete matches no row.
    const deleted = await asApp("viewer-a", sql`delete from campaign_tasks where campaign_id = ${campaign}`);
    expect(deleted.rowCount ?? 0).toBe(0);
    // Another ministry sees nothing.
    const foreign = await withTenant(fixture.db, "owner-b", tenantB, "workspace:read", (tx) => tx.execute(sql`select count(*)::int as n from campaign_tasks`));
    expect(foreign.rows[0]).toEqual({ n: 0 });
  });
});
