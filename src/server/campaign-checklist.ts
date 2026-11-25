import { and, eq } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { auditLogs, campaignChecklistItems, campaignDraftAssignments, campaignDrafts, campaigns } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { checklistInput, checklistItemKeys, derivedChecklist, type ChecklistItem } from "../lib/campaign-wizard";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

export type ChecklistView = { item: ChecklistItem; done: boolean; automatic: boolean; doneAt: string | null }[];

/**
 * The post-creation setup checklist of a campaign (PRD "Post-Creation Checklist"; founder decision Q8). Completion is stored per item, by whoever last
 * ticked or unticked it. Items that tick themselves from what the finished draft already holds (every included department has an accepted leader; the
 * counseling department has one) are reported done and automatic whatever was stored. Only people who can write campaigns read or change it. It reads the
 * draft's departments and placements and changes nothing else: no board, form, page, payment or message is created or published from here.
 */
export async function getChecklist(db: Database, userId: string, workspace: string, campaign: string): Promise<ChecklistView> {
  const id = uuidInput.parse(campaign);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => view(tx, tenantId, id));
}

export async function setChecklistItem(db: Database, userId: string, workspace: string, campaign: string, raw: unknown): Promise<ChecklistView> {
  const id = uuidInput.parse(campaign), { item, done } = checklistInput.parse(raw);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    await view(tx, tenantId, id);
    const now = new Date(), values = { done, doneBy: done ? userId : null, doneAt: done ? now : null, updatedAt: now };
    await tx.insert(campaignChecklistItems).values({ tenantId, campaignId: id, item, ...values })
      .onConflictDoUpdate({ target: [campaignChecklistItems.tenantId, campaignChecklistItems.campaignId, campaignChecklistItems.item], set: values });
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "campaign.checklist.set", targetId: id, metadata: { item, done: String(done) } });
    return view(tx, tenantId, id);
  });
}

async function view(tx: Transaction, tenantId: string, campaignId: string): Promise<ChecklistView> {
  const [campaign] = await tx.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, campaignId)));
  if (!campaign) throw new AccessError(404, message("Campaigns.notFound"));
  const stored = new Map((await tx.select().from(campaignChecklistItems).where(and(eq(campaignChecklistItems.tenantId, tenantId), eq(campaignChecklistItems.campaignId, campaignId))))
    .map((row) => [row.item, row]));
  const [draft] = await tx.select({ id: campaignDrafts.id, departments: campaignDrafts.departments }).from(campaignDrafts)
    .where(and(eq(campaignDrafts.tenantId, tenantId), eq(campaignDrafts.campaignId, campaignId)));
  const leaders = draft ? (await tx.select({ department: campaignDraftAssignments.department }).from(campaignDraftAssignments)
    .where(and(eq(campaignDraftAssignments.tenantId, tenantId), eq(campaignDraftAssignments.draftId, draft.id), eq(campaignDraftAssignments.role, "leader")))).map((row) => row.department) : [];
  const derived = derivedChecklist(draft?.departments ?? [], leaders);
  return checklistItemKeys.map((item) => {
    const row = stored.get(item), automatic = derived[item];
    return { item, done: automatic || row?.done === true, automatic, doneAt: row?.done && row.doneAt ? row.doneAt.toISOString() : null };
  });
}
