import { and, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { auditLogs, campaignDraftAssignments, campaignDrafts, campaigns, workspaceMembers } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import {
  campaignStatusInput, campaignTemplates, createDraftInput, defaultBudget, defaultOutreach, draftClientKey, placeIssues, saveInput, validateDraft,
  versionInput, wizardSteps, type DataStep, type DraftSnapshot, type Issue,
} from "../lib/campaign-wizard";
import { message } from "../i18n/messages";
import { insertCampaign } from "./campaigns";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

const draftColumns = {
  tenantId: campaignDrafts.tenantId, id: campaignDrafts.id, createdBy: campaignDrafts.createdBy, status: campaignDrafts.status, version: campaignDrafts.version,
  currentStep: campaignDrafts.currentStep, type: campaignDrafts.type, name: campaignDrafts.name, description: campaignDrafts.description,
  mission: campaignDrafts.mission, country: campaignDrafts.country, cityRegion: campaignDrafts.cityRegion, startDate: campaignDrafts.startDate,
  endDate: campaignDrafts.endDate, timeZone: campaignDrafts.timeZone, structure: campaignDrafts.structure, departments: campaignDrafts.departments,
  modules: campaignDrafts.modules, budget: campaignDrafts.budget, outreach: campaignDrafts.outreach, campaignId: campaignDrafts.campaignId,
  finishedAt: campaignDrafts.finishedAt, createdAt: campaignDrafts.createdAt, updatedAt: campaignDrafts.updatedAt,
};
type DraftRow = Omit<typeof campaignDrafts.$inferSelect, "clientKey">;
export const DRAFT_LIST_LIMIT = 50;

// Audit rows say what happened and to which draft. Never a name, a note or a person.
const audit = (tx: Transaction, tenantId: string, actorId: string, action: string, targetId: string, metadata: Record<string, string> = {}) =>
  tx.insert(auditLogs).values({ tenantId, actorId, action, targetId, metadata });

const snapshot = (row: DraftRow): DraftSnapshot => row;
async function assignmentsOf(tx: Transaction, tenantId: string, draftId: string) {
  return tx.select({ id: campaignDraftAssignments.id, userId: campaignDraftAssignments.userId, department: campaignDraftAssignments.department, role: campaignDraftAssignments.role })
    .from(campaignDraftAssignments).where(and(eq(campaignDraftAssignments.tenantId, tenantId), eq(campaignDraftAssignments.draftId, draftId)))
    .orderBy(campaignDraftAssignments.department, campaignDraftAssignments.role, campaignDraftAssignments.userId);
}
async function view(tx: Transaction, row: DraftRow) {
  const issues: Issue[] = validateDraft(snapshot(row));
  return { ...row, assignments: await assignmentsOf(tx, row.tenantId, row.id), issues, ready: issues.length === 0 };
}
// No row lock: the update policies hide a closed draft from a locking read, which would turn "already finished" into "not found". Every write below
// is a conditional update on the version and status instead, so concurrent writers still serialise.
async function visibleDraft(tx: Transaction, tenantId: string, id: string) {
  const [row] = await tx.select(draftColumns).from(campaignDrafts).where(and(eq(campaignDrafts.tenantId, tenantId), eq(campaignDrafts.id, id)));
  if (!row) throw new AccessError(404, message("Campaigns.draftNotFound"));
  return row as DraftRow;
}
// An open draft is edited and finished by the person who started it. Anyone else who can see it (an owner or admin) can only read or discard it.
function ownOpenDraft(row: DraftRow, userId: string) {
  if (row.createdBy !== userId) throw new AccessError(403, message("Campaigns.draftNotYours"));
  if (row.status !== "draft") throw new AccessError(409, message("Campaigns.draftClosed"));
}
const stale = () => new AccessError(409, message("Campaigns.draftChanged"), { reason: "stale" });

export async function createDraft(db: Database, userId: string, workspace: string, data: unknown, key: unknown) {
  const { type } = createDraftInput.parse(data ?? {}), clientKey = draftClientKey.parse(key);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    const template = type ? campaignTemplates[type] : null;
    const [inserted] = await tx.insert(campaignDrafts).values({
      tenantId, createdBy: userId, clientKey, type, departments: template ? [...template.departments] : [], modules: template ? [...template.modules] : [],
      budget: { ...defaultBudget }, outreach: { ...defaultOutreach }, currentStep: type ? 2 : 1,
    }).onConflictDoNothing({ target: [campaignDrafts.tenantId, campaignDrafts.createdBy, campaignDrafts.clientKey] }).returning(draftColumns);
    if (inserted) await audit(tx, tenantId, userId, "campaign.draft.create", inserted.id);
    // A retried create returns the draft the first call made.
    const row = inserted ?? (await tx.select(draftColumns).from(campaignDrafts)
      .where(and(eq(campaignDrafts.tenantId, tenantId), eq(campaignDrafts.createdBy, userId), eq(campaignDrafts.clientKey, clientKey))))[0];
    return { created: Boolean(inserted), draft: await view(tx, row as DraftRow) };
  });
}

export async function listDrafts(db: Database, userId: string, workspace: string) {
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:read", async (tx, tenantId) => {
    const rows = await tx.select({ id: campaignDrafts.id, createdBy: campaignDrafts.createdBy, name: campaignDrafts.name, type: campaignDrafts.type,
      currentStep: campaignDrafts.currentStep, version: campaignDrafts.version, updatedAt: campaignDrafts.updatedAt }).from(campaignDrafts)
      .where(and(eq(campaignDrafts.tenantId, tenantId), eq(campaignDrafts.status, "draft")))
      .orderBy(desc(campaignDrafts.updatedAt), desc(campaignDrafts.id)).limit(DRAFT_LIST_LIMIT);
    return { drafts: rows };
  });
}

export async function getDraft(db: Database, userId: string, workspace: string, draft: string) {
  const id = uuidInput.parse(draft);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:read", async (tx, tenantId) => view(tx, await visibleDraft(tx, tenantId, id)));
}

/** Autosave one step. The version the client last saw must still be current: otherwise 409 and nothing is written. */
export async function saveDraftStep(db: Database, userId: string, workspace: string, draft: string, raw: unknown) {
  const id = uuidInput.parse(draft), { version, step, data } = saveInput.parse(raw);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    const current = await visibleDraft(tx, tenantId, id);
    ownOpenDraft(current, userId);
    if (current.version !== version) throw stale();
    const changes = await stepChanges(tx, tenantId, current, step, data);
    const reached = Math.max(current.currentStep, Math.min(wizardSteps.length, wizardSteps.indexOf(step) + 2));
    const [row] = await tx.update(campaignDrafts).set({ ...changes.columns, currentStep: reached, version: version + 1, updatedAt: new Date() })
      .where(and(eq(campaignDrafts.tenantId, tenantId), eq(campaignDrafts.id, id), eq(campaignDrafts.version, version), eq(campaignDrafts.status, "draft")))
      .returning(draftColumns);
    // A concurrent save won the race: the conditional update touched nothing, so no assignment below runs.
    if (!row) throw stale();
    if (changes.assignments) await replaceAssignments(tx, tenantId, id, changes.assignments);
    if (changes.dropDepartmentsOutside) await tx.delete(campaignDraftAssignments).where(and(eq(campaignDraftAssignments.tenantId, tenantId),
      eq(campaignDraftAssignments.draftId, id), notInArray(campaignDraftAssignments.department, changes.dropDepartmentsOutside)));
    await audit(tx, tenantId, userId, "campaign.draft.save", id, { step, version: String(row.version) });
    return view(tx, row as DraftRow);
  });
}

type StepChange = { columns: Partial<typeof campaignDrafts.$inferInsert>; assignments?: { userId: string; department: string; role: "leader" | "member" }[]; dropDepartmentsOutside?: string[] };
async function stepChanges(tx: Transaction, tenantId: string, current: DraftRow, step: DataStep, data: Record<string, unknown>): Promise<StepChange> {
  switch (step) {
    case "type": {
      const type = data.type as NonNullable<DraftRow["type"]>;
      if (type === current.type) return { columns: {} };
      // A different type loads that type's template again. People already placed in a department the template drops are removed with it.
      const template = campaignTemplates[type];
      return { columns: { type, departments: [...template.departments], modules: [...template.modules] }, dropDepartmentsOutside: [...template.departments] };
    }
    case "basics": return { columns: { name: data.name as string, description: data.description as string | null, mission: data.mission as string | null } };
    case "place": return { columns: data as StepChange["columns"] };
    case "tools": return { columns: { modules: data.modules as string[] } };
    case "budget": return { columns: { budget: data as DraftRow["budget"] } };
    case "connect": return { columns: { outreach: data as DraftRow["outreach"] } };
    case "leaders": {
      const assignments = data.assignments as NonNullable<StepChange["assignments"]>;
      const people = [...new Set(assignments.map((a) => a.userId))];
      if (people.length) {
        // Leaders and team members are existing ministry members who can edit. A viewer or an outsider cannot be placed.
        const found = await tx.select({ userId: workspaceMembers.userId }).from(workspaceMembers)
          .where(and(eq(workspaceMembers.tenantId, tenantId), inArray(workspaceMembers.userId, people), notInArray(workspaceMembers.roleId, ["viewer", "guest", "campaign_guest"])));
        if (found.length !== people.length) throw new AccessError(400, message("Campaigns.assigneeInvalid"));
      }
      return { columns: { departments: data.departments as string[] }, assignments };
    }
  }
}
async function replaceAssignments(tx: Transaction, tenantId: string, draftId: string, list: NonNullable<StepChange["assignments"]>) {
  await tx.delete(campaignDraftAssignments).where(and(eq(campaignDraftAssignments.tenantId, tenantId), eq(campaignDraftAssignments.draftId, draftId)));
  if (list.length) await tx.insert(campaignDraftAssignments).values(list.map((a) => ({ tenantId, draftId, ...a })));
}

export async function discardDraft(db: Database, userId: string, workspace: string, draft: string, raw: unknown) {
  const id = uuidInput.parse(draft), { version } = versionInput.parse(raw);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:read", async (tx, tenantId, role) => {
    const current = await visibleDraft(tx, tenantId, id);
    if (current.status === "discarded") return view(tx, current);
    if (current.status === "finished") throw new AccessError(409, message("Campaigns.draftClosed"));
    // The creator (while still allowed to edit) or an owner/admin may discard; the policies enforce the same.
    if (current.createdBy !== userId && role !== "owner" && role !== "admin") throw new AccessError(403, message("Campaigns.draftNotYours"));
    if (current.version !== version) throw stale();
    const [row] = await tx.update(campaignDrafts).set({ status: "discarded", version: version + 1, updatedAt: new Date() })
      .where(and(eq(campaignDrafts.tenantId, tenantId), eq(campaignDrafts.id, id), eq(campaignDrafts.version, version), eq(campaignDrafts.status, "draft")))
      .returning(draftColumns);
    if (!row) throw stale();
    await audit(tx, tenantId, userId, "campaign.draft.discard", id);
    return view(tx, row as DraftRow);
  });
}

/**
 * Finish: one transaction creates the campaign (status draft, so nothing is public) and closes the draft. Idempotent: finishing a draft that is
 * already finished returns the same campaign without a second one. The campaign row never gets the draft's budget or outreach settings;
 * those stay on the finished draft until the setup that reads them exists.
 */
export async function finishDraft(db: Database, userId: string, workspace: string, draft: string, raw: unknown) {
  const id = uuidInput.parse(draft), { version } = versionInput.parse(raw);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    const current = await visibleDraft(tx, tenantId, id);
    if (current.createdBy !== userId) throw new AccessError(403, message("Campaigns.draftNotYours"));
    if (current.status === "finished") return { draft: await view(tx, current), campaignId: current.campaignId as string };
    ownOpenDraft(current, userId);
    if (current.version !== version) throw stale();
    const issues = validateDraft(snapshot(current));
    if (issues.length) throw new AccessError(400, message("Campaigns.draftIncomplete"), { issues: issues.map((issue) => `${issue.step}:${issue.code}`).join(",") });
    const campaign = await insertCampaign(tx, userId, tenantId, {
      name: current.name, type: current.type, description: current.description, mission: current.mission, country: current.country,
      cityRegion: current.cityRegion, startDate: current.startDate, endDate: current.endDate, timeZone: current.timeZone, structure: current.structure,
    }, `wizard-${id}`);
    const [row] = await tx.update(campaignDrafts).set({ status: "finished", campaignId: campaign.id, finishedAt: new Date(), version: version + 1, updatedAt: new Date() })
      .where(and(eq(campaignDrafts.tenantId, tenantId), eq(campaignDrafts.id, id), eq(campaignDrafts.version, version), eq(campaignDrafts.status, "draft")))
      .returning(draftColumns);
    if (!row) {
      // A concurrent finish of this same draft won: the campaign above is that one (same key), so report it rather than an error.
      const settled = await visibleDraft(tx, tenantId, id);
      if (settled.status === "finished" && settled.campaignId === campaign.id) return { draft: await view(tx, settled), campaignId: campaign.id };
      throw stale();
    }
    await audit(tx, tenantId, userId, "campaign.draft.finish", id, { campaign: campaign.id });
    return { draft: await view(tx, row as DraftRow), campaignId: campaign.id };
  });
}

/**
 * Activate or return a campaign to draft. State only: this never publishes a page, form, QR link or donation page and sends nothing. It needs
 * the place, dates and time zone, so a half-set-up campaign cannot be marked active.
 */
export async function setCampaignStatus(db: Database, userId: string, workspace: string, campaign: string, raw: unknown) {
  const id = uuidInput.parse(campaign), { status } = campaignStatusInput.parse(raw);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:activate", async (tx, tenantId) => {
    const [current] = await tx.select({ id: campaigns.id, status: campaigns.status, country: campaigns.country, cityRegion: campaigns.cityRegion,
      startDate: campaigns.startDate, endDate: campaigns.endDate, timeZone: campaigns.timeZone, structure: campaigns.structure }).from(campaigns)
      .where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, id), isNull(campaigns.archivedAt))).for("update");
    if (!current) throw new AccessError(404, message("Campaigns.notFound"));
    if (current.status === status) return { id, status };
    if (status === "active") {
      const issues = placeIssues(current);
      if (issues.length) throw new AccessError(409, message("Campaigns.notReady"), { issues: issues.map((issue) => issue.code).join(",") });
    }
    const [row] = await tx.update(campaigns).set({ status, updatedAt: new Date() })
      .where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, id), isNull(campaigns.archivedAt))).returning({ id: campaigns.id, status: campaigns.status });
    if (!row) throw new AccessError(404, message("Campaigns.notFound"));
    await audit(tx, tenantId, userId, status === "active" ? "campaign.activate" : "campaign.deactivate", id);
    return row;
  });
}
