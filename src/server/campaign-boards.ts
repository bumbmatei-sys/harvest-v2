import { and, asc, count, eq, max, ne, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { auditLogs, campaignBoards, campaignDrafts, campaignMilestones, campaignTasks, campaigns, users } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { departmentKeys } from "../lib/campaign-wizard";
import {
  boardKeys, MAX_MILESTONES_PER_CAMPAIGN, MAX_TASKS_PER_CAMPAIGN, MAX_TASKS_PER_COLUMN, milestoneCreateInput, milestoneUpdateInput, progressOf, taskCreateInput,
  taskStatuses, taskUpdateInput, versionInput, type BoardKey, type TaskStatus,
} from "../lib/campaign-boards";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

export type BoardTask = {
  id: string; board: BoardKey; status: TaskStatus; position: number; title: string; notes: string; assigneeId: string | null; assigneeName: string | null;
  dueDate: string | null; milestoneId: string | null; completedAt: string | null; version: number; createdAt: string; updatedAt: string;
};
export type BoardMilestone = { id: string; board: BoardKey | null; title: string; dueDate: string | null; reached: boolean; reachedAt: string | null; version: number; tasks: number; tasksDone: number };
/** `assignees`: the people a task can be given to (they can write campaigns here), by name only; empty for someone who cannot change the boards. */
export type CampaignBoardsView = { writable: boolean; boards: { key: BoardKey; tasks: BoardTask[] }[]; milestones: BoardMilestone[]; assignees: { id: string; name: string }[] };
export type CampaignWorkSummary = { tasks: { total: number; done: number; inProgress: number; overdue: number }; milestones: { total: number; reached: number }; progress: number | null };

const writers = ["owner", "admin", "member"];
const statusOrder = (status: string) => taskStatuses.indexOf(status as TaskStatus);

/**
 * The live campaign and the boards it may have: the campaign-wide board, then each department its finished draft included, in the PRD's order. A campaign
 * made without the wizard has only the campaign-wide board. An archived or unknown campaign is not found.
 */
async function campaignBoardsOf(tx: Transaction, tenantId: string, campaignId: string) {
  const [campaign] = await tx.select({ archivedAt: campaigns.archivedAt }).from(campaigns).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, campaignId)));
  if (!campaign || campaign.archivedAt) throw new AccessError(404, message("Campaigns.notFound"));
  const [draft] = await tx.select({ departments: campaignDrafts.departments }).from(campaignDrafts)
    .where(and(eq(campaignDrafts.tenantId, tenantId), eq(campaignDrafts.campaignId, campaignId)));
  const included = draft?.departments ?? [];
  return ["general", ...departmentKeys.filter((key) => included.includes(key))] as BoardKey[];
}

/** The board's row, created the first time something is added to it (idempotent under concurrency). */
async function boardId(tx: Transaction, tenantId: string, campaignId: string, userId: string, allowed: BoardKey[], key: BoardKey) {
  if (!allowed.includes(key)) throw new AccessError(400, message("CampaignBoards.boardUnavailable"));
  await tx.insert(campaignBoards).values({ tenantId, campaignId, department: key, createdBy: userId }).onConflictDoNothing();
  const [row] = await tx.select({ id: campaignBoards.id }).from(campaignBoards)
    .where(and(eq(campaignBoards.tenantId, tenantId), eq(campaignBoards.campaignId, campaignId), eq(campaignBoards.department, key)));
  return row.id;
}

/** A newly chosen assignee must be someone who can write campaigns in this ministry, as the database policy sees them. */
async function checkAssignee(tx: Transaction, tenantId: string, assigneeId: string) {
  const rows = await tx.execute<{ role: string | null }>(sql`select public.access_role(m.tenant_id, m.user_id, 'campaigns', m.role_id) as role
    from public.workspace_members m where m.tenant_id = ${tenantId} and m.user_id = ${assigneeId}`);
  if (!writers.includes(rows.rows[0]?.role ?? "")) throw new AccessError(400, message("CampaignBoards.assigneeIneligible"));
}
async function checkMilestone(tx: Transaction, tenantId: string, campaignId: string, milestoneId: string) {
  const [row] = await tx.select({ id: campaignMilestones.id }).from(campaignMilestones)
    .where(and(eq(campaignMilestones.tenantId, tenantId), eq(campaignMilestones.campaignId, campaignId), eq(campaignMilestones.id, milestoneId)));
  if (!row) throw new AccessError(400, message("CampaignBoards.milestoneUnavailable"));
}
const audit = (tx: Transaction, tenantId: string, userId: string, action: string, target: string, metadata: Record<string, string>) =>
  tx.insert(auditLogs).values({ tenantId, actorId: userId, action, targetId: target, metadata });

/** Puts a task at `index` in its column (the end when omitted) and renumbers that column. Only positions change for the other tasks. */
async function place(tx: Transaction, tenantId: string, board: string, status: TaskStatus, taskId: string, index?: number) {
  const column = await tx.select({ id: campaignTasks.id, position: campaignTasks.position }).from(campaignTasks)
    .where(and(eq(campaignTasks.tenantId, tenantId), eq(campaignTasks.boardId, board), eq(campaignTasks.status, status), ne(campaignTasks.id, taskId)))
    .orderBy(asc(campaignTasks.position), asc(campaignTasks.createdAt), asc(campaignTasks.id));
  if (column.length >= MAX_TASKS_PER_COLUMN) throw new AccessError(409, message("CampaignBoards.columnFull"));
  const order = column.map((row) => row.id);
  order.splice(Math.min(index ?? order.length, order.length), 0, taskId);
  const current = new Map(column.map((row) => [row.id, row.position]));
  for (const [position, id] of order.entries()) {
    if (id !== taskId && current.get(id) === position) continue;
    await tx.update(campaignTasks).set({ position }).where(and(eq(campaignTasks.tenantId, tenantId), eq(campaignTasks.id, id)));
  }
}

async function viewOf(tx: Transaction, tenantId: string, campaignId: string, writable: boolean): Promise<CampaignBoardsView> {
  const allowed = await campaignBoardsOf(tx, tenantId, campaignId);
  const boards = await tx.select({ id: campaignBoards.id, key: campaignBoards.department }).from(campaignBoards)
    .where(and(eq(campaignBoards.tenantId, tenantId), eq(campaignBoards.campaignId, campaignId)));
  const keyOf = new Map(boards.map((board) => [board.id, board.key as BoardKey]));
  const tasks = await tx.select({
    id: campaignTasks.id, boardId: campaignTasks.boardId, status: campaignTasks.status, position: campaignTasks.position, title: campaignTasks.title,
    notes: campaignTasks.notes, assigneeId: campaignTasks.assigneeId, assigneeName: users.name, dueDate: campaignTasks.dueDate, milestoneId: campaignTasks.milestoneId,
    completedAt: campaignTasks.completedAt, version: campaignTasks.version, createdAt: campaignTasks.createdAt, updatedAt: campaignTasks.updatedAt,
  }).from(campaignTasks).leftJoin(users, eq(users.id, campaignTasks.assigneeId))
    .where(and(eq(campaignTasks.tenantId, tenantId), eq(campaignTasks.campaignId, campaignId)))
    .orderBy(asc(campaignTasks.position), asc(campaignTasks.createdAt), asc(campaignTasks.id));
  const view = (task: typeof tasks[number]): BoardTask => ({
    id: task.id, board: keyOf.get(task.boardId) as BoardKey, status: task.status, position: task.position, title: task.title, notes: task.notes,
    assigneeId: task.assigneeId, assigneeName: task.assigneeId ? (task.assigneeName?.trim() || null) : null, dueDate: task.dueDate, milestoneId: task.milestoneId,
    completedAt: task.completedAt?.toISOString() ?? null, version: task.version, createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
  });
  const all = tasks.map(view).sort((a, b) => statusOrder(a.status) - statusOrder(b.status));
  const keys = boardKeys.filter((key) => allowed.includes(key) || boards.some((board) => board.key === key));
  const milestones = await tx.select().from(campaignMilestones).where(and(eq(campaignMilestones.tenantId, tenantId), eq(campaignMilestones.campaignId, campaignId)))
    .orderBy(sql`${campaignMilestones.dueDate} asc nulls last`, asc(campaignMilestones.createdAt), asc(campaignMilestones.id));
  const assignees = writable ? (await tx.execute<{ id: string; name: string }>(sql`select m.user_id as id, u.name from public.workspace_members m join public.users u on u.id = m.user_id
    where m.tenant_id = ${tenantId} and public.access_role(m.tenant_id, m.user_id, 'campaigns', m.role_id) in ('owner', 'admin', 'member') order by u.name, m.user_id`)).rows
    .map((row) => ({ id: row.id, name: row.name.trim() })) : [];
  return {
    writable, assignees,
    boards: keys.map((key) => ({ key, tasks: all.filter((task) => task.board === key) })),
    milestones: milestones.map((row) => {
      const linked = all.filter((task) => task.milestoneId === row.id);
      return { id: row.id, board: row.boardId ? keyOf.get(row.boardId) ?? null : null, title: row.title, dueDate: row.dueDate, reached: row.reachedAt !== null,
        reachedAt: row.reachedAt?.toISOString() ?? null, version: row.version, tasks: linked.length, tasksDone: linked.filter((task) => task.status === "done").length };
    }),
  };
}

/**
 * A campaign's boards, tasks and milestones (founder approval, 26 Nov). Everyone who can read campaigns in the ministry reads them; `writable` says
 * whether this person can change them. Assignees are shown by name only, never by email. Nothing here reads a CRM contact or sends anything.
 */
export function getCampaignBoards(db: Database, userId: string, workspace: string, campaign: string) {
  const id = uuidInput.parse(campaign);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:read", (tx, tenantId, role) => viewOf(tx, tenantId, id, writers.includes(role)));
}

export function createCampaignTask(db: Database, userId: string, workspace: string, campaign: string, raw: unknown) {
  const id = uuidInput.parse(campaign), input = taskCreateInput.parse(raw);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    const allowed = await campaignBoardsOf(tx, tenantId, id);
    const [{ total }] = await tx.select({ total: count() }).from(campaignTasks).where(and(eq(campaignTasks.tenantId, tenantId), eq(campaignTasks.campaignId, id)));
    if (total >= MAX_TASKS_PER_CAMPAIGN) throw new AccessError(409, message("CampaignBoards.tooManyTasks"));
    if (input.assigneeId) await checkAssignee(tx, tenantId, input.assigneeId);
    if (input.milestoneId) await checkMilestone(tx, tenantId, id, input.milestoneId);
    const board = await boardId(tx, tenantId, id, userId, allowed, input.board);
    const [{ last }] = await tx.select({ last: max(campaignTasks.position) }).from(campaignTasks)
      .where(and(eq(campaignTasks.tenantId, tenantId), eq(campaignTasks.boardId, board), eq(campaignTasks.status, input.status)));
    const [{ inColumn }] = await tx.select({ inColumn: count() }).from(campaignTasks)
      .where(and(eq(campaignTasks.tenantId, tenantId), eq(campaignTasks.boardId, board), eq(campaignTasks.status, input.status)));
    if (inColumn >= MAX_TASKS_PER_COLUMN) throw new AccessError(409, message("CampaignBoards.columnFull"));
    const done = input.status === "done", now = new Date();
    const [task] = await tx.insert(campaignTasks).values({
      tenantId, campaignId: id, boardId: board, title: input.title, notes: input.notes, status: input.status, position: last === null ? 0 : last + 1,
      assigneeId: input.assigneeId, dueDate: input.dueDate, milestoneId: input.milestoneId, completedAt: done ? now : null, completedBy: done ? userId : null, createdBy: userId,
    }).returning({ id: campaignTasks.id });
    await audit(tx, tenantId, userId, "campaign.task.create", task.id, { campaign: id, board: input.board });
    return { id: task.id, ...(await viewOf(tx, tenantId, id, true)) };
  });
}

export function updateCampaignTask(db: Database, userId: string, workspace: string, campaign: string, task: string, raw: unknown) {
  const id = uuidInput.parse(campaign), taskId = uuidInput.parse(task), input = taskUpdateInput.parse(raw);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    const allowed = await campaignBoardsOf(tx, tenantId, id);
    const [current] = await tx.select().from(campaignTasks).where(and(eq(campaignTasks.tenantId, tenantId), eq(campaignTasks.campaignId, id), eq(campaignTasks.id, taskId)));
    if (!current) throw new AccessError(404, message("CampaignBoards.taskNotFound"));
    if (current.version !== input.version) throw new AccessError(409, message("CampaignBoards.versionConflict"));
    if (input.assigneeId && input.assigneeId !== current.assigneeId) await checkAssignee(tx, tenantId, input.assigneeId);
    if (input.milestoneId && input.milestoneId !== current.milestoneId) await checkMilestone(tx, tenantId, id, input.milestoneId);
    const board = input.board ? await boardId(tx, tenantId, id, userId, allowed, input.board) : current.boardId;
    const status = input.status ?? current.status, moved = board !== current.boardId || status !== current.status;
    const completion = status === current.status ? {} : status === "done" ? { completedAt: new Date(), completedBy: userId } : { completedAt: null, completedBy: null };
    const [row] = await tx.update(campaignTasks).set({
      boardId: board, status, ...completion,
      ...(input.title !== undefined ? { title: input.title } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}), ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.milestoneId !== undefined ? { milestoneId: input.milestoneId } : {}),
      version: current.version + 1, updatedAt: new Date(),
    }).where(and(eq(campaignTasks.tenantId, tenantId), eq(campaignTasks.id, taskId), eq(campaignTasks.version, input.version))).returning({ id: campaignTasks.id });
    if (!row) throw new AccessError(409, message("CampaignBoards.versionConflict"));
    if (moved || input.position !== undefined) await place(tx, tenantId, board, status, taskId, input.position);
    const changed = Object.keys(input).filter((key) => key !== "version").sort().join(",");
    await audit(tx, tenantId, userId, "campaign.task.update", taskId, { campaign: id, fields: changed, ...(moved ? { status } : {}) });
    return viewOf(tx, tenantId, id, true);
  });
}

export function deleteCampaignTask(db: Database, userId: string, workspace: string, campaign: string, task: string, raw: unknown) {
  const id = uuidInput.parse(campaign), taskId = uuidInput.parse(task), { version } = versionInput.parse(raw);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    await campaignBoardsOf(tx, tenantId, id);
    const [current] = await tx.select({ version: campaignTasks.version }).from(campaignTasks)
      .where(and(eq(campaignTasks.tenantId, tenantId), eq(campaignTasks.campaignId, id), eq(campaignTasks.id, taskId)));
    if (!current) throw new AccessError(404, message("CampaignBoards.taskNotFound"));
    const [row] = await tx.delete(campaignTasks).where(and(eq(campaignTasks.tenantId, tenantId), eq(campaignTasks.id, taskId), eq(campaignTasks.version, version))).returning({ id: campaignTasks.id });
    if (!row) throw new AccessError(409, message("CampaignBoards.versionConflict"));
    await audit(tx, tenantId, userId, "campaign.task.delete", taskId, { campaign: id });
    return viewOf(tx, tenantId, id, true);
  });
}

export function createCampaignMilestone(db: Database, userId: string, workspace: string, campaign: string, raw: unknown) {
  const id = uuidInput.parse(campaign), input = milestoneCreateInput.parse(raw);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    const allowed = await campaignBoardsOf(tx, tenantId, id);
    const [{ total }] = await tx.select({ total: count() }).from(campaignMilestones).where(and(eq(campaignMilestones.tenantId, tenantId), eq(campaignMilestones.campaignId, id)));
    if (total >= MAX_MILESTONES_PER_CAMPAIGN) throw new AccessError(409, message("CampaignBoards.tooManyMilestones"));
    const board = input.board ? await boardId(tx, tenantId, id, userId, allowed, input.board) : null;
    const [row] = await tx.insert(campaignMilestones).values({ tenantId, campaignId: id, boardId: board, title: input.title, dueDate: input.dueDate, createdBy: userId })
      .returning({ id: campaignMilestones.id });
    await audit(tx, tenantId, userId, "campaign.milestone.create", row.id, { campaign: id, board: input.board ?? "campaign" });
    return { id: row.id, ...(await viewOf(tx, tenantId, id, true)) };
  });
}

export function updateCampaignMilestone(db: Database, userId: string, workspace: string, campaign: string, milestone: string, raw: unknown) {
  const id = uuidInput.parse(campaign), milestoneId = uuidInput.parse(milestone), input = milestoneUpdateInput.parse(raw);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    const allowed = await campaignBoardsOf(tx, tenantId, id);
    const [current] = await tx.select().from(campaignMilestones)
      .where(and(eq(campaignMilestones.tenantId, tenantId), eq(campaignMilestones.campaignId, id), eq(campaignMilestones.id, milestoneId)));
    if (!current) throw new AccessError(404, message("CampaignBoards.milestoneNotFound"));
    if (current.version !== input.version) throw new AccessError(409, message("CampaignBoards.versionConflict"));
    const board = input.board === undefined ? current.boardId : input.board === null ? null : await boardId(tx, tenantId, id, userId, allowed, input.board);
    const reached = input.reached === undefined || input.reached === (current.reachedAt !== null) ? {}
      : input.reached ? { reachedAt: new Date(), reachedBy: userId } : { reachedAt: null, reachedBy: null };
    const [row] = await tx.update(campaignMilestones).set({
      boardId: board, ...reached, ...(input.title !== undefined ? { title: input.title } : {}), ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      version: current.version + 1, updatedAt: new Date(),
    }).where(and(eq(campaignMilestones.tenantId, tenantId), eq(campaignMilestones.id, milestoneId), eq(campaignMilestones.version, input.version))).returning({ id: campaignMilestones.id });
    if (!row) throw new AccessError(409, message("CampaignBoards.versionConflict"));
    await audit(tx, tenantId, userId, "campaign.milestone.update", milestoneId, { campaign: id, fields: Object.keys(input).filter((key) => key !== "version").sort().join(",") });
    return viewOf(tx, tenantId, id, true);
  });
}

/** Removes a milestone. Its tasks stay on their boards and simply lose the link. */
export function deleteCampaignMilestone(db: Database, userId: string, workspace: string, campaign: string, milestone: string, raw: unknown) {
  const id = uuidInput.parse(campaign), milestoneId = uuidInput.parse(milestone), { version } = versionInput.parse(raw);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    await campaignBoardsOf(tx, tenantId, id);
    const [current] = await tx.select({ version: campaignMilestones.version }).from(campaignMilestones)
      .where(and(eq(campaignMilestones.tenantId, tenantId), eq(campaignMilestones.campaignId, id), eq(campaignMilestones.id, milestoneId)));
    if (!current) throw new AccessError(404, message("CampaignBoards.milestoneNotFound"));
    if (current.version !== version) throw new AccessError(409, message("CampaignBoards.versionConflict"));
    await tx.update(campaignTasks).set({ milestoneId: null }).where(and(eq(campaignTasks.tenantId, tenantId), eq(campaignTasks.campaignId, id), eq(campaignTasks.milestoneId, milestoneId)));
    const [row] = await tx.delete(campaignMilestones).where(and(eq(campaignMilestones.tenantId, tenantId), eq(campaignMilestones.id, milestoneId), eq(campaignMilestones.version, version)))
      .returning({ id: campaignMilestones.id });
    if (!row) throw new AccessError(409, message("CampaignBoards.versionConflict"));
    await audit(tx, tenantId, userId, "campaign.milestone.delete", milestoneId, { campaign: id });
    return viewOf(tx, tenantId, id, true);
  });
}

/** Counts for the campaign dashboard. Overdue: not done and due before today (UTC). Progress is the share of tasks done, null with no tasks. */
export async function workSummaryOf(tx: Transaction, tenantId: string, campaignId: string): Promise<CampaignWorkSummary> {
  const [tasks] = await tx.select({
    total: count(), done: sql<number>`count(*) filter (where ${campaignTasks.status} = 'done')`.mapWith(Number),
    inProgress: sql<number>`count(*) filter (where ${campaignTasks.status} = 'in_progress')`.mapWith(Number),
    overdue: sql<number>`count(*) filter (where ${campaignTasks.status} <> 'done' and ${campaignTasks.dueDate} < current_date)`.mapWith(Number),
  }).from(campaignTasks).where(and(eq(campaignTasks.tenantId, tenantId), eq(campaignTasks.campaignId, campaignId)));
  const [milestones] = await tx.select({ total: count(), reached: count(campaignMilestones.reachedAt) }).from(campaignMilestones)
    .where(and(eq(campaignMilestones.tenantId, tenantId), eq(campaignMilestones.campaignId, campaignId)));
  return { tasks, milestones, progress: progressOf(tasks.done, tasks.total) };
}
