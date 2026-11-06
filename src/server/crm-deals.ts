import { message } from "../i18n/messages";
import { and, asc, count, desc, eq, exists, gte, ilike, inArray, isNull, like, lte, or, sql, type SQL } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { auditLogs, companies, contacts, crmPipelineStages, crmPipelines, opportunities, users, workspaceMembers } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import {
  BOARD_LIMIT, DEAL_PAGE_SIZE, crmToday, dealInput, dealMove, dealPatch, defaultStages, MAX_STAGES, pipelineInput, pipelinePatch, stageInput, stageKey, stageOrder, stagePatch,
  type DealInput, type DealMove, type DealPatch, type DealQuery, type Pipeline, type PipelineInput, type PipelinePatch, type Stage, type StageInput, type StagePatch,
} from "../lib/crm-deals";
import { likePattern } from "./crm-filters";
import { AccessError, can } from "./permissions";
import { withTenant } from "./tenancy";
import { z } from "zod";

const missingDeal = () => new AccessError(404, message("Errors.thisDealIsNotAvailable"));
const missingPipeline = () => new AccessError(404, message("Errors.thisPipelineIsNotAvailable"));
const missingStage = () => new AccessError(404, message("Errors.thisStageIsNotAvailable"));
const stale = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
const invalidDeal = () => new AccessError(400, message("Errors.checkTheDealDetails"));
function pgMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const own = "message" in error && typeof error.message === "string" ? error.message : "";
  return "cause" in error ? `${own} ${pgMessage(error.cause)}` : own;
}
/** Translate the database guards' refusals into user-facing errors. */
function guarded(error: unknown): never {
  const text = pgMessage(error);
  if (text.includes("stage has deals")) throw new AccessError(409, message("Errors.moveTheDealsOutOfThisStageFirst"), { reason: "stage_has_deals" });
  if (text.includes("pipeline has deals")) throw new AccessError(409, message("Errors.thisPipelineStillHasDeals"), { reason: "pipeline_has_deals" });
  if (text.includes("owner is not a member")) throw new AccessError(400, message("Errors.theOwnerMustBeAWorkspaceMember"));
  if (text.includes("contact is unavailable")) throw new AccessError(404, message("Errors.theRelatedRecordIsNotAvailable"));
  if (text.includes("stage is archived") || text.includes("stage is unavailable")) throw missingStage();
  throw error;
}
async function audit(tx: Transaction, tenantId: string, actorId: string, action: string, targetId: string, metadata: Record<string, string> = {}) {
  await tx.insert(auditLogs).values({ tenantId, actorId, action, targetId, metadata });
}

// ---------------------------------------------------------------------------
// Pipelines and stages.
async function loadPipelines(tx: Transaction, tenantId: string, includeArchived: boolean): Promise<Pipeline[]> {
  const rows = await tx.select().from(crmPipelines).where(and(eq(crmPipelines.tenantId, tenantId), includeArchived ? undefined : isNull(crmPipelines.archivedAt)))
    .orderBy(desc(crmPipelines.isDefault), asc(crmPipelines.position), asc(crmPipelines.createdAt), asc(crmPipelines.id));
  const stages = rows.length ? await tx.select().from(crmPipelineStages).where(and(eq(crmPipelineStages.tenantId, tenantId), inArray(crmPipelineStages.pipelineId, rows.map((row) => row.id)),
    includeArchived ? undefined : isNull(crmPipelineStages.archivedAt))).orderBy(asc(crmPipelineStages.position), asc(crmPipelineStages.createdAt)) : [];
  return rows.map((row) => ({ id: row.id, name: row.name, isDefault: row.isDefault, position: row.position, archivedAt: row.archivedAt, version: row.version,
    stages: stages.filter((stage) => stage.pipelineId === row.id).map(toStage) }));
}
function toStage(row: typeof crmPipelineStages.$inferSelect): Stage {
  return { id: row.id, pipelineId: row.pipelineId, key: row.key, name: row.name, kind: row.kind, probability: row.probability, color: row.color, position: row.position, archivedAt: row.archivedAt, version: row.version };
}
async function insertStages(tx: Transaction, tenantId: string, userId: string, pipelineId: string) {
  await tx.insert(crmPipelineStages).values(defaultStages.map((stage, position) => ({
    tenantId, pipelineId, key: stage.key, name: message(`Crm.defaultStages.${stage.key}` as "Crm.defaultStages.new"), kind: stage.kind,
    probability: stage.probability, color: stage.color, position, createdBy: userId,
  })));
}
/**
 * The first writer to open Pipelines creates the workspace's default pipeline (lazily,
 * so existing workspaces need no backfill). An advisory lock makes it happen once.
 */
async function seedDefaultPipeline(tx: Transaction, tenantId: string, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`crm_pipeline_seed:${tenantId}`}))`);
  const [{ total }] = await tx.select({ total: count() }).from(crmPipelines).where(eq(crmPipelines.tenantId, tenantId));
  if (total > 0) return;
  const [pipeline] = await tx.insert(crmPipelines).values({ tenantId, name: message("Crm.defaultPipeline"), isDefault: true, createdBy: userId }).returning();
  await insertStages(tx, tenantId, userId, pipeline.id);
  await audit(tx, tenantId, userId, "crm.pipeline_seed", pipeline.id);
}

/** Pipelines with their stages. Readers see them; writers also trigger the one-time default seed. */
export function listPipelines(db: Database, userId: string, workspace: string, options: { includeArchived?: boolean } = {}) {
  return withTenant(db, userId, uuidInput.parse(workspace), "opportunities:read", async (tx, tenantId, role) => {
    if (can(role, "opportunities:write")) await seedDefaultPipeline(tx, tenantId, userId);
    return loadPipelines(tx, tenantId, options.includeArchived ?? false);
  });
}

export function createPipeline(db: Database, userId: string, workspace: string, data: PipelineInput) {
  const input = pipelineInput.parse(data);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:pipelines_write", async (tx, tenantId) => {
    const [{ total, live }] = await tx.select({ total: count(), live: sql<number>`count(*) filter (where ${crmPipelines.isDefault} and ${crmPipelines.archivedAt} is null)::int` }).from(crmPipelines).where(eq(crmPipelines.tenantId, tenantId));
    const [pipeline] = await tx.insert(crmPipelines).values({ tenantId, name: input.name, isDefault: live === 0, position: total, createdBy: userId }).returning();
    await insertStages(tx, tenantId, userId, pipeline.id);
    await audit(tx, tenantId, userId, "crm.pipeline_create", pipeline.id);
    return (await loadPipelines(tx, tenantId, true)).find((item) => item.id === pipeline.id)!;
  });
}

export function updatePipeline(db: Database, userId: string, workspace: string, pipeline: string, data: PipelinePatch) {
  const id = uuidInput.parse(pipeline), { version, archived, isDefault, ...input } = pipelinePatch.parse(data);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:pipelines_write", async (tx, tenantId) => {
    const [current] = await tx.select().from(crmPipelines).where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, id))).for("update");
    if (!current) throw missingPipeline();
    if (current.version !== version) throw stale();
    const archive = archived === undefined ? null : archived && !current.archivedAt ? "archive" : !archived && current.archivedAt ? "restore" : null;
    if (archive === "archive" && current.isDefault) throw new AccessError(409, message("Errors.chooseAnotherDefaultPipelineFirst"));
    if (isDefault && (current.archivedAt && archive !== "restore")) throw missingPipeline();
    const makeDefault = !!isDefault && !current.isDefault;
    if (makeDefault) await tx.update(crmPipelines).set({ isDefault: false, updatedAt: new Date(), version: sql`${crmPipelines.version} + 1` })
      .where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.isDefault, true)));
    const renamed = input.name !== undefined && input.name !== current.name;
    if (!renamed && !archive && !makeDefault) return current;
    const [row] = await tx.update(crmPipelines).set({
      ...(renamed ? { name: input.name } : {}), ...(makeDefault ? { isDefault: true } : {}),
      ...(archive ? { archivedAt: archive === "archive" ? new Date() : null } : {}),
      updatedAt: new Date(), version: sql`${crmPipelines.version} + 1`,
    }).where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, id), eq(crmPipelines.version, version))).returning().catch(guarded);
    if (!row) throw stale();
    await audit(tx, tenantId, userId, archive === "archive" ? "crm.pipeline_archive" : archive === "restore" ? "crm.pipeline_restore" : "crm.pipeline_update", id,
      { fields: [renamed && "name", makeDefault && "default"].filter(Boolean).join(",") });
    return row;
  });
}

async function lockLivePipeline(tx: Transaction, tenantId: string, id: string) {
  const [row] = await tx.select().from(crmPipelines).where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, id), isNull(crmPipelines.archivedAt))).for("update");
  if (!row) throw missingPipeline();
  return row;
}

/** New open stages go before the first closed stage, so Won and Lost stay at the end. */
export function createStage(db: Database, userId: string, workspace: string, pipeline: string, data: StageInput) {
  const pipelineId = uuidInput.parse(pipeline), input = stageInput.parse(data);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:pipelines_write", async (tx, tenantId) => {
    await lockLivePipeline(tx, tenantId, pipelineId);
    const stages = await tx.select().from(crmPipelineStages).where(and(eq(crmPipelineStages.tenantId, tenantId), eq(crmPipelineStages.pipelineId, pipelineId))).orderBy(asc(crmPipelineStages.position));
    if (stages.filter((stage) => !stage.archivedAt).length >= MAX_STAGES) throw new AccessError(409, message("Errors.aPipelineCanHaveAtMostTwentyStages"));
    const base = input.key ?? stageKey(input.name);
    let key = base, suffix = 2;
    while (stages.some((stage) => stage.key === key)) key = `${base.slice(0, 36)}_${suffix++}`;
    const live = stages.filter((stage) => !stage.archivedAt);
    const firstClosed = live.find((stage) => stage.kind !== "open");
    const position = input.kind === "open" && firstClosed ? firstClosed.position : (live.at(-1)?.position ?? -1) + 1;
    if (input.kind === "open" && firstClosed) {
      await tx.update(crmPipelineStages).set({ position: sql`${crmPipelineStages.position} + 1`, updatedAt: new Date() })
        .where(and(eq(crmPipelineStages.tenantId, tenantId), eq(crmPipelineStages.pipelineId, pipelineId), gte(crmPipelineStages.position, position)));
    }
    const [row] = await tx.insert(crmPipelineStages).values({ tenantId, pipelineId, key, name: input.name, kind: input.kind, probability: input.probability, color: input.color, position, createdBy: userId }).returning();
    await audit(tx, tenantId, userId, "crm.stage_create", row.id, { pipelineId });
    return toStage(row);
  });
}

export function updateStage(db: Database, userId: string, workspace: string, stage: string, data: StagePatch) {
  const id = uuidInput.parse(stage), { version, archived, ...input } = stagePatch.parse(data);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:pipelines_write", async (tx, tenantId) => {
    const [current] = await tx.select().from(crmPipelineStages).where(and(eq(crmPipelineStages.tenantId, tenantId), eq(crmPipelineStages.id, id))).for("update");
    if (!current) throw missingStage();
    await lockLivePipeline(tx, tenantId, current.pipelineId);
    if (current.version !== version) throw stale();
    const archive = archived === undefined ? null : archived && !current.archivedAt ? "archive" : !archived && current.archivedAt ? "restore" : null;
    if (archive === "archive" && current.kind === "open") {
      const [{ open }] = await tx.select({ open: count() }).from(crmPipelineStages).where(and(eq(crmPipelineStages.tenantId, tenantId), eq(crmPipelineStages.pipelineId, current.pipelineId), eq(crmPipelineStages.kind, "open"), isNull(crmPipelineStages.archivedAt)));
      if (open <= 1) throw new AccessError(409, message("Errors.aPipelineNeedsAnOpenStage"));
    }
    const changed = (["name", "probability", "color"] as const).filter((key) => input[key] !== undefined && input[key] !== current[key]);
    if (!changed.length && !archive) return toStage(current);
    let position = current.position;
    if (archive === "restore") {
      const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${crmPipelineStages.position}), -1)::int` }).from(crmPipelineStages).where(and(eq(crmPipelineStages.tenantId, tenantId), eq(crmPipelineStages.pipelineId, current.pipelineId), isNull(crmPipelineStages.archivedAt)));
      position = max + 1;
    }
    const [row] = await tx.update(crmPipelineStages).set({
      ...Object.fromEntries(changed.map((key) => [key, input[key]])), position,
      ...(archive ? { archivedAt: archive === "archive" ? new Date() : null } : {}),
      updatedAt: new Date(), version: sql`${crmPipelineStages.version} + 1`,
    }).where(and(eq(crmPipelineStages.tenantId, tenantId), eq(crmPipelineStages.id, id), eq(crmPipelineStages.version, version))).returning().catch(guarded);
    if (!row) throw stale();
    await audit(tx, tenantId, userId, archive === "archive" ? "crm.stage_archive" : archive === "restore" ? "crm.stage_restore" : "crm.stage_update", id, { pipelineId: current.pipelineId, fields: changed.join(",") });
    return toStage(row);
  });
}

/** Reorder a pipeline's live stages. The list must name exactly those stages. */
export function reorderStages(db: Database, userId: string, workspace: string, pipeline: string, data: z.input<typeof stageOrder>) {
  const pipelineId = uuidInput.parse(pipeline), { stageIds } = stageOrder.parse(data);
  return withTenant(db, userId, uuidInput.parse(workspace), "crm:pipelines_write", async (tx, tenantId) => {
    await lockLivePipeline(tx, tenantId, pipelineId);
    const live = await tx.select({ id: crmPipelineStages.id }).from(crmPipelineStages).where(and(eq(crmPipelineStages.tenantId, tenantId), eq(crmPipelineStages.pipelineId, pipelineId), isNull(crmPipelineStages.archivedAt))).for("update");
    if (live.length !== stageIds.length || new Set(stageIds).size !== stageIds.length || !live.every((stage) => stageIds.includes(stage.id))) throw new AccessError(409, message("Errors.theStagesChangedReloadAndTryAgain"), { reason: "stale" });
    for (const [position, stageId] of stageIds.entries()) {
      await tx.update(crmPipelineStages).set({ position, updatedAt: new Date(), version: sql`${crmPipelineStages.version} + 1` })
        .where(and(eq(crmPipelineStages.tenantId, tenantId), eq(crmPipelineStages.id, stageId)));
    }
    await audit(tx, tenantId, userId, "crm.stage_reorder", pipelineId);
    return (await loadPipelines(tx, tenantId, true)).find((item) => item.id === pipelineId)!;
  });
}

// ---------------------------------------------------------------------------
// Deals.
const dealColumns = {
  id: opportunities.id, name: opportunities.name, pipelineId: opportunities.pipelineId, stageId: opportunities.stageId,
  amount: opportunities.amount, currency: opportunities.currency, expectedCloseDate: opportunities.expectedCloseDate,
  ownerUserId: opportunities.ownerUserId, companyId: opportunities.companyId, contactId: opportunities.contactId,
  position: opportunities.position, closedReason: opportunities.closedReason, stageChangedAt: opportunities.stageChangedAt,
  archivedAt: opportunities.archivedAt, version: opportunities.version, createdAt: opportunities.createdAt, updatedAt: opportunities.updatedAt,
};
export type Deal = Awaited<ReturnType<typeof attachNames>>[number];
type DealRow = {
  id: string; name: string; pipelineId: string; stageId: string; amount: string | null; currency: string; expectedCloseDate: string | null;
  ownerUserId: string | null; companyId: string | null; contactId: string | null; position: number; closedReason: string | null;
  stageChangedAt: Date; archivedAt: Date | null; version: number; createdAt: Date; updatedAt: Date;
};

/** Names for company, person and owner (current members only), tenant-scoped. */
async function attachNames(tx: Transaction, tenantId: string, rows: DealRow[]) {
  const companyIds = [...new Set(rows.map((row) => row.companyId).filter((value): value is string => !!value))];
  const contactIds = [...new Set(rows.map((row) => row.contactId).filter((value): value is string => !!value))];
  const ownerIds = [...new Set(rows.map((row) => row.ownerUserId).filter((value): value is string => !!value))];
  const companyRows = companyIds.length ? await tx.select({ id: companies.id, name: companies.name }).from(companies).where(and(eq(companies.tenantId, tenantId), inArray(companies.id, companyIds))) : [];
  const contactRows = contactIds.length ? await tx.select({ id: contacts.id, name: contacts.name }).from(contacts).where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, contactIds), isNull(contacts.erasedAt))) : [];
  const ownerRows = ownerIds.length ? await tx.select({ id: users.id, name: users.name }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.tenantId, tenantId), inArray(workspaceMembers.userId, ownerIds))) : [];
  return rows.map((row) => ({
    ...row,
    companyName: companyRows.find((item) => item.id === row.companyId)?.name ?? null,
    contactName: contactRows.find((item) => item.id === row.contactId)?.name ?? null,
    ownerName: ownerRows.find((item) => item.id === row.ownerUserId)?.name ?? null,
  }));
}

/** Workspace members who can own deals. */
async function loadMembers(tx: Transaction, tenantId: string) {
  return tx.select({ id: users.id, name: users.name }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.tenantId, tenantId)).orderBy(asc(users.name), asc(users.id));
}

function pickPipeline(pipelines: Pipeline[], id?: string | null) {
  const pipeline = id ? pipelines.find((item) => item.id === id) : pipelines.find((item) => item.isDefault) ?? pipelines[0];
  if (!pipeline && id) throw missingPipeline();
  return pipeline ?? null;
}

const sortColumns = { name: sql`lower(${opportunities.name})`, amount: opportunities.amount, close: opportunities.expectedCloseDate, created: opportunities.createdAt, updated: opportunities.updatedAt };

/**
 * One server query feeds both the board and the list, so they can never disagree.
 * Totals and the weighted value cover every matching deal, not just the shown page.
 */
export function listDeals(db: Database, userId: string, workspace: string, pipeline: string | null, query: DealQuery) {
  return withTenant(db, userId, uuidInput.parse(workspace), "opportunities:read", async (tx, tenantId, role) => {
    if (can(role, "opportunities:write")) await seedDefaultPipeline(tx, tenantId, userId);
    const pipelines = await loadPipelines(tx, tenantId, false);
    const current = pickPipeline(pipelines, pipeline ? uuidInput.parse(pipeline) : null);
    const members = await loadMembers(tx, tenantId);
    const today = crmToday();
    if (!current) return { pipelines, pipeline: null, deals: [], total: 0, page: 1, stageTotals: {} as Record<string, { count: number; amount: number }>, openTotal: 0, weightedTotal: 0, today, members, empty: true };
    const stageIds = current.stages.map((stage) => stage.id);
    if (query.stage && !stageIds.includes(query.stage)) throw missingStage();
    const pattern = likePattern(query.q);
    const openStages = current.stages.filter((stage) => stage.kind === "open").map((stage) => stage.id);
    const base = and(eq(opportunities.tenantId, tenantId), eq(opportunities.pipelineId, current.id), isNull(opportunities.archivedAt), stageIds.length ? inArray(opportunities.stageId, stageIds) : sql`false`);
    const filters: (SQL | undefined)[] = [
      query.q ? or(ilike(opportunities.name, pattern),
        exists(tx.select({ one: sql`1` }).from(companies).where(and(eq(companies.tenantId, tenantId), sql`${companies.id} = opportunities.company_id`, ilike(companies.name, pattern)))),
        exists(tx.select({ one: sql`1` }).from(contacts).where(and(eq(contacts.tenantId, tenantId), sql`${contacts.id} = opportunities.contact_id`, isNull(contacts.erasedAt), ilike(contacts.name, pattern))))) : undefined,
      query.stage ? eq(opportunities.stageId, query.stage) : undefined,
      query.owner === "none" ? isNull(opportunities.ownerUserId) : query.owner ? eq(opportunities.ownerUserId, query.owner) : undefined,
      query.stale ? and(openStages.length ? inArray(opportunities.stageId, openStages) : sql`false`, sql`${opportunities.expectedCloseDate} < ${today}::date`) : undefined,
      query.min ? gte(opportunities.amount, query.min) : undefined,
      query.max ? lte(opportunities.amount, query.max) : undefined,
    ];
    const where = and(base, ...filters);
    const totals = await tx.select({ stageId: opportunities.stageId, deals: count(), amount: sql<string>`coalesce(sum(${opportunities.amount}), 0)::text` })
      .from(opportunities).where(where).groupBy(opportunities.stageId);
    const stageTotals = Object.fromEntries(totals.map((row) => [row.stageId, { count: row.deals, amount: Number(row.amount) }]));
    const total = totals.reduce((sum, row) => sum + row.deals, 0);
    let openTotal = 0, weightedTotal = 0;
    for (const stage of current.stages) {
      if (stage.kind !== "open") continue;
      const value = stageTotals[stage.id]?.amount ?? 0;
      openTotal += value;
      if (stage.probability !== null) weightedTotal += (value * stage.probability) / 100;
    }
    const [direction, key] = query.sort.startsWith("-") ? ["desc", query.sort.slice(1)] as const : ["asc", query.sort] as const;
    const sortExpr = sortColumns[key as keyof typeof sortColumns];
    const order = query.mode === "board"
      ? [asc(opportunities.position), desc(opportunities.updatedAt), asc(opportunities.id)]
      : [sql`${sortExpr} ${sql.raw(direction)} nulls last`, sql`${opportunities.id} ${sql.raw(direction)}`];
    const page = query.mode === "board" ? 1 : query.page;
    const rows = await tx.select(dealColumns).from(opportunities).where(where).orderBy(...order)
      .limit(query.mode === "board" ? BOARD_LIMIT : DEAL_PAGE_SIZE).offset(query.mode === "board" ? 0 : (page - 1) * DEAL_PAGE_SIZE);
    const [{ any }] = await tx.select({ any: count() }).from(opportunities).where(base);
    return { pipelines, pipeline: current, deals: await attachNames(tx, tenantId, rows), total, page, stageTotals, openTotal: Math.round(openTotal * 100) / 100, weightedTotal: Math.round(weightedTotal * 100) / 100, today, members, empty: any === 0 };
  });
}

async function lockDeal(tx: Transaction, tenantId: string, id: string) {
  const [row] = await tx.select(dealColumns).from(opportunities).where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.id, id))).for("update");
  if (!row) throw missingDeal();
  return row;
}
async function checkRelations(tx: Transaction, tenantId: string, companyId: string | null | undefined, contactId: string | null | undefined, ownerUserId: string | null | undefined) {
  if (companyId) {
    const [row] = await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.id, companyId)));
    if (!row) throw new AccessError(404, message("Errors.theRelatedRecordIsNotAvailable"));
  }
  if (contactId) {
    const [row] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId), isNull(contacts.erasedAt)));
    if (!row) throw new AccessError(404, message("Errors.theRelatedRecordIsNotAvailable"));
  }
  if (ownerUserId) {
    const [row] = await tx.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.tenantId, tenantId), eq(workspaceMembers.userId, ownerUserId)));
    if (!row) throw new AccessError(400, message("Errors.theOwnerMustBeAWorkspaceMember"));
  }
}
async function nextPosition(tx: Transaction, tenantId: string, stageId: string) {
  const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${opportunities.position}), 0)::float8` }).from(opportunities).where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.stageId, stageId)));
  return max + 1;
}

export function createDeal(db: Database, userId: string, workspace: string, data: DealInput) {
  const parsed = dealInput.safeParse(data);
  if (!parsed.success) throw parsed.error.issues.some((issue) => issue.message === "RELATION_REQUIRED") ? new AccessError(400, message("Errors.linkADealToAPersonOrCompany")) : invalidDeal();
  const input = parsed.data;
  return withTenant(db, userId, uuidInput.parse(workspace), "opportunities:write", async (tx, tenantId) => {
    await seedDefaultPipeline(tx, tenantId, userId);
    const pipeline = pickPipeline(await loadPipelines(tx, tenantId, false), input.pipelineId);
    if (!pipeline) throw missingPipeline();
    const stage = input.stageId ? pipeline.stages.find((item) => item.id === input.stageId) : pipeline.stages.find((item) => item.kind === "open") ?? pipeline.stages[0];
    if (!stage) throw missingStage();
    await checkRelations(tx, tenantId, input.companyId, input.contactId, input.ownerUserId);
    const [row] = await tx.insert(opportunities).values({
      tenantId, name: input.name, pipelineId: pipeline.id, stageId: stage.id, amount: input.amount ?? null, currency: input.currency,
      expectedCloseDate: input.expectedCloseDate ?? null, ownerUserId: input.ownerUserId ?? null, companyId: input.companyId ?? null, contactId: input.contactId ?? null,
      position: await nextPosition(tx, tenantId, stage.id), createdBy: userId,
    }).returning({ id: opportunities.id, version: opportunities.version }).catch(guarded);
    await audit(tx, tenantId, userId, "opportunity.create", row.id, { toStageId: stage.id });
    return row;
  });
}

export function updateDeal(db: Database, userId: string, workspace: string, deal: string, data: DealPatch) {
  const id = uuidInput.parse(deal);
  const parsed = dealPatch.safeParse(data);
  if (!parsed.success) throw invalidDeal();
  const { version, archived, ...input } = parsed.data;
  return withTenant(db, userId, uuidInput.parse(workspace), "opportunities:write", async (tx, tenantId) => {
    const current = await lockDeal(tx, tenantId, id);
    if (current.version !== version) throw stale();
    const keys = ["name", "amount", "currency", "expectedCloseDate", "ownerUserId", "companyId", "contactId", "closedReason"] as const;
    const changed = keys.filter((key) => input[key] !== undefined && input[key] !== current[key]);
    const archive = archived === undefined ? null : archived && !current.archivedAt ? "archive" : !archived && current.archivedAt ? "restore" : null;
    if (!changed.length && !archive) return { id, version: current.version };
    const next = { ...current, ...Object.fromEntries(changed.map((key) => [key, input[key]])) };
    if ((changed.includes("companyId") || changed.includes("contactId")) && !next.companyId && !next.contactId) throw new AccessError(400, message("Errors.linkADealToAPersonOrCompany"));
    if (changed.includes("closedReason") && next.closedReason !== null) {
      const [stage] = await tx.select({ kind: crmPipelineStages.kind }).from(crmPipelineStages).where(and(eq(crmPipelineStages.tenantId, tenantId), eq(crmPipelineStages.id, current.stageId)));
      if (stage?.kind === "open") throw new AccessError(400, message("Errors.aReasonCanOnlyBeRecordedOnClosedDeals"));
    }
    await checkRelations(tx, tenantId, changed.includes("companyId") ? next.companyId : null, changed.includes("contactId") ? next.contactId : null, changed.includes("ownerUserId") ? next.ownerUserId : null);
    const [row] = await tx.update(opportunities).set({
      ...Object.fromEntries(changed.map((key) => [key, input[key]])),
      ...(archive ? { archivedAt: archive === "archive" ? new Date() : null } : {}),
      updatedAt: new Date(), version: sql`${opportunities.version} + 1`,
    }).where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.id, id), eq(opportunities.version, version))).returning({ id: opportunities.id, version: opportunities.version }).catch(guarded);
    if (!row) throw stale();
    // Field names only, never amounts, names or reasons.
    await audit(tx, tenantId, userId, archive === "archive" ? "opportunity.archive" : archive === "restore" ? "opportunity.restore" : "opportunity.update", id, changed.length ? { fields: changed.join(",") } : {});
    return row;
  });
}

/**
 * Move a deal to another stage of the same pipeline. The expected version makes a
 * board drop a single transition: a stale or repeated drop changes nothing (409),
 * and moving to the stage it is already in writes nothing.
 */
export function moveDeal(db: Database, userId: string, workspace: string, deal: string, data: DealMove) {
  const id = uuidInput.parse(deal), input = dealMove.parse(data);
  return withTenant(db, userId, uuidInput.parse(workspace), "opportunities:write", async (tx, tenantId) => {
    const current = await lockDeal(tx, tenantId, id);
    if (current.archivedAt) throw missingDeal();
    if (current.version !== input.version) throw stale();
    const [target] = await tx.select().from(crmPipelineStages).where(and(eq(crmPipelineStages.tenantId, tenantId), eq(crmPipelineStages.id, input.stageId)));
    if (!target || target.archivedAt) throw missingStage();
    if (target.pipelineId !== current.pipelineId) throw new AccessError(400, message("Errors.aDealCanOnlyMoveWithinItsPipeline"));
    if (target.id === current.stageId) return { id, version: current.version, stageId: current.stageId };
    const closedReason = target.kind === "open" ? null : input.closedReason ?? null;
    const [row] = await tx.update(opportunities).set({
      stageId: target.id, closedReason, position: await nextPosition(tx, tenantId, target.id), stageChangedAt: new Date(),
      updatedAt: new Date(), version: sql`${opportunities.version} + 1`,
    }).where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.id, id), eq(opportunities.version, input.version))).returning({ id: opportunities.id, version: opportunities.version, stageId: opportunities.stageId }).catch(guarded);
    if (!row) throw stale();
    await audit(tx, tenantId, userId, "opportunity.move", id, { fromStageId: current.stageId, toStageId: target.id, ...(closedReason ? { fields: "closedReason" } : {}) });
    return row;
  });
}

export type DealActivity = { id: string; action: string; createdAt: Date; actor: { name: string | null; isMember: boolean }; fields: string[]; fromStage: string | null; toStage: string | null };

/** A deal with its pipeline (live stages plus its own stage, even if archived), owners and ledger activity. */
export function getDeal(db: Database, userId: string, workspace: string, deal: string) {
  const id = uuidInput.parse(deal);
  return withTenant(db, userId, uuidInput.parse(workspace), "opportunities:read", async (tx, tenantId) => {
    const [row] = await tx.select(dealColumns).from(opportunities).where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.id, id)));
    if (!row) throw missingDeal();
    const [named] = await attachNames(tx, tenantId, [row]);
    const pipeline = (await loadPipelines(tx, tenantId, true)).find((item) => item.id === row.pipelineId)!;
    const stages = pipeline.stages.filter((stage) => !stage.archivedAt || stage.id === row.stageId);
    const logs = await tx.select().from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.targetId, id), like(auditLogs.action, "opportunity.%")))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(50);
    const actorIds = [...new Set(logs.map((log) => log.actorId))];
    const actors = actorIds.length ? await tx.select({ id: users.id, name: users.name }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.tenantId, tenantId), inArray(workspaceMembers.userId, actorIds))) : [];
    const stageName = (stageId?: string) => (stageId ? pipeline.stages.find((stage) => stage.id === stageId)?.name ?? null : null);
    const activity: DealActivity[] = logs.map((log) => {
      const actor = actors.find((item) => item.id === log.actorId);
      return { id: log.id, action: log.action, createdAt: log.createdAt, actor: { name: actor?.name ?? null, isMember: !!actor }, fields: log.metadata.fields ? log.metadata.fields.split(",").filter(Boolean) : [], fromStage: stageName(log.metadata.fromStageId), toStage: stageName(log.metadata.toStageId) };
    });
    return { deal: named, pipeline: { ...pipeline, stages }, members: await loadMembers(tx, tenantId), activity, today: crmToday() };
  });
}

/** Live deals linked to a company or person, for the Related deals card. */
export function listRelatedDeals(db: Database, userId: string, workspace: string, objectType: "person" | "company", record: string) {
  const id = uuidInput.parse(record);
  return withTenant(db, userId, uuidInput.parse(workspace), "opportunities:read", async (tx, tenantId) => {
    const rows = await tx.select({ ...dealColumns, stageName: crmPipelineStages.name, stageKind: crmPipelineStages.kind, stageColor: crmPipelineStages.color })
      .from(opportunities).innerJoin(crmPipelineStages, and(eq(crmPipelineStages.tenantId, opportunities.tenantId), eq(crmPipelineStages.id, opportunities.stageId)))
      .where(and(eq(opportunities.tenantId, tenantId), isNull(opportunities.archivedAt), objectType === "company" ? eq(opportunities.companyId, id) : eq(opportunities.contactId, id)))
      .orderBy(desc(opportunities.updatedAt), asc(opportunities.id)).limit(50);
    return { deals: rows, today: crmToday() };
  });
}
