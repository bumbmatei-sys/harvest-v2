import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { campaignDraftAssignments, campaignDrafts, campaigns, users } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { departmentKeys, moduleKeys } from "../lib/campaign-wizard";
import { outreachKeys } from "../lib/campaign-wizard-form";
import { message } from "../i18n/messages";
import { workSummaryOf, type CampaignWorkSummary } from "./campaign-boards";
import { checklistOf } from "./campaign-checklist";
import { invitationsOf } from "./campaign-wizard-invitations";
import { campaignEventsOf } from "./campaign-events";
import { budgetSummaryOf } from "./campaign-budget";
import { campaignFundraising, fundraisingEnabled } from "./fundraising";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

export type CampaignOverview = {
  campaignId: string;
  /** What the campaign was set up with, read from its finished draft. Null for a campaign that was not created by the wizard. */
  configuration: null | {
    departments: { key: string; leaders: string[]; members: string[]; pending: number }[];
    modules: string[];
    /** The Registration, Response & Follow-Up options that were turned on in step 7 (choices only: nothing is published or sent). */
    connect: string[];
    /** The unpublished registration form Finish created when registration was on, if the person who finished could create forms. */
    registrationFormId: string | null;
    /** Budget and fundraising settings from step 6. Settings only: nothing here is collected or raised. */
    budget: { currency: string; estimatedBudgetMinor: number | null; fundraisingEnabled: boolean; fundraisingGoalMinor: number | null; onlineDonations: boolean };
  };
  /** Setup checklist progress. */
  checklist: { done: number; total: number };
  /** Tasks and milestones on the campaign's boards, and progress (share of tasks done; null with no tasks). */
  work: CampaignWorkSummary;
  /** Numbers the dashboard cannot show: events (while Events is off) and funding (no linked fundraiser, or the person may not see raised totals). Reported as unavailable, never as zero. */
  unavailable: ("events" | "funding")[];
  /** Campaign budget: planned and spent totals in cents (decimal strings). Null while the campaign has no budget line and no expense. */
  budget: { currency: string; plannedCents: string; spentCents: string; remainingCents: string; expenseCount: number; lines: number } | null;
  /** Raised vs goal from the linked fundraiser, for people who may see raised totals (owners and admins). Null otherwise (then "funding" stays unavailable). */
  funding: { currency: string; goalCents: string; raisedCents: string } | null;
  /** Campaign events: how many linked events this person can see. Null while Events is off (then "events" stays unavailable). */
  events: number | null;
};

/**
 * The read behind the campaign dashboard (founder decision Q6): what the finished draft configured (departments, who leads and who joined each one,
 * the tools that are on) and how far the setup checklist is. Only people who can write campaigns read it, because the draft is theirs to see; it
 * carries no donor, response or Connect data. Tasks, milestones and progress come from the campaign's boards and budget totals from its budget; funding
 * (raised vs goal) comes from the linked fundraiser through campaignFundraising, so only people the fundraising rules let see raised totals get it.
 * Names are shown as stored; an email stands in for a missing name for owners and admins only.
 */
export async function getCampaignOverview(db: Database, userId: string, workspace: string, campaign: string): Promise<CampaignOverview> {
  const id = uuidInput.parse(campaign);
  const overview = await withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId, role) => {
    const [row] = await tx.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, id)));
    if (!row) throw new AccessError(404, message("Campaigns.notFound"));
    const checklist = await checklistOf(tx, tenantId, id), manager = role === "owner" || role === "admin";
    const [draft] = await tx.select({ id: campaignDrafts.id, departments: campaignDrafts.departments, modules: campaignDrafts.modules, outreach: campaignDrafts.outreach, budget: campaignDrafts.budget, registrationFormId: campaignDrafts.registrationFormId }).from(campaignDrafts)
      .where(and(eq(campaignDrafts.tenantId, tenantId), eq(campaignDrafts.campaignId, id)));
    let configuration: CampaignOverview["configuration"] = null;
    if (draft) {
      const placed = await tx.select({ userId: campaignDraftAssignments.userId, department: campaignDraftAssignments.department, role: campaignDraftAssignments.role, name: users.name, email: users.email })
        .from(campaignDraftAssignments).innerJoin(users, eq(users.id, campaignDraftAssignments.userId))
        .where(and(eq(campaignDraftAssignments.tenantId, tenantId), eq(campaignDraftAssignments.draftId, draft.id))).orderBy(campaignDraftAssignments.userId);
      const pending = (await invitationsOf(tx, tenantId, draft.id)).filter((invitation) => invitation.state === "pending");
      const name = (person: { name: string; email: string }) => person.name.trim() || (manager ? person.email : "");
      configuration = {
        departments: departmentKeys.filter((key) => draft.departments.includes(key)).map((key) => ({
          key,
          leaders: placed.filter((p) => p.department === key && p.role === "leader").map(name),
          members: placed.filter((p) => p.department === key && p.role === "member").map(name),
          pending: pending.filter((invitation) => invitation.department === key).length,
        })),
        modules: moduleKeys.filter((key) => draft.modules.includes(key)),
        connect: outreachKeys.filter((key) => draft.outreach[key]),
        budget: draft.budget, registrationFormId: draft.registrationFormId,
      };
    }
    const work = await workSummaryOf(tx, tenantId, id);
    const overview: CampaignOverview = { campaignId: id, configuration, checklist: { done: checklist.filter((item) => item.done).length, total: checklist.length }, work, unavailable: ["events", "funding"], events: null,
      budget: await budgetSummaryOf(tx, tenantId, id), funding: null };
    // Campaign events: once Events is on, the events figure is real and no longer listed as unavailable.
    const linked = await campaignEventsOf(tx, tenantId, id);
    if (linked) Object.assign(overview, { events: linked.events.length, unavailable: overview.unavailable.filter((key) => key !== "events") });
    return overview;
  });
  // Funding: the fundraising rules decide (Giving access for the goal, owners and admins for raised totals). A refusal keeps funding unavailable.
  const linked = fundraisingEnabled() ? await campaignFundraising(db, userId, workspace, id).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; }) : null;
  const raised = linked?.fundraising?.totals ? linked.fundraising : null;
  if (raised) Object.assign(overview, {
    funding: { currency: raised.currency, goalCents: raised.goalCents, raisedCents: raised.totals!.raisedCents },
    unavailable: overview.unavailable.filter((key) => key !== "funding"),
  });
  return overview;
}
