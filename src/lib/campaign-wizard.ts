import { z } from "zod";
import { campaignStructures, campaignTypes } from "./campaigns";

// Pure rules for the campaign wizard draft. No imports from the server, so screens and services share them.
export const wizardSteps = ["type", "basics", "place", "leaders", "tools", "budget", "connect", "review"] as const;
export type WizardStep = typeof wizardSteps[number];
export const WIZARD_STEP_COUNT = wizardSteps.length;

export const departmentKeys = ["campaign_leadership", "church_mobilization", "evangelistic_outreach", "prayer_intercession", "marketing_media",
  "logistics_equipment", "finance_fundraising", "volunteers", "counseling", "discipleship_follow_up", "worship_production", "security_medical",
  "transportation_hospitality"] as const;
export type DepartmentKey = typeof departmentKeys[number];
export const moduleKeys = ["tasks_boards", "departments_teams", "events_checkin", "volunteer_management", "church_partnerships", "church_maps",
  "outreach_planning", "social_marketing", "budget_expenses", "fundraising_donations", "registration_forms", "qr_response_forms",
  "discipleship_follow_up", "campaign_calendar", "documents_files", "communications", "campaign_analytics", "ai_copilot"] as const;
export type ModuleKey = typeof moduleKeys[number];

type Template = { departments: readonly DepartmentKey[]; modules: readonly ModuleKey[] };
// Step 1 loads a template: suggested departments and recommended tools. Everything stays editable. The copilot is never preselected (deferred).
export const campaignTemplates: Record<typeof campaignTypes[number], Template> = {
  evangelistic_crusade: { departments: departmentKeys,
    modules: ["tasks_boards", "departments_teams", "events_checkin", "volunteer_management", "church_partnerships", "church_maps", "outreach_planning",
      "social_marketing", "budget_expenses", "fundraising_donations", "registration_forms", "qr_response_forms", "discipleship_follow_up",
      "campaign_calendar", "documents_files", "communications", "campaign_analytics"] },
  mission_trip: { departments: ["campaign_leadership", "prayer_intercession", "marketing_media", "logistics_equipment", "finance_fundraising", "volunteers", "transportation_hospitality"],
    modules: ["tasks_boards", "departments_teams", "volunteer_management", "budget_expenses", "fundraising_donations", "campaign_calendar", "documents_files", "communications"] },
  conference: { departments: ["campaign_leadership", "marketing_media", "logistics_equipment", "finance_fundraising", "volunteers", "worship_production", "security_medical", "transportation_hospitality"],
    modules: ["tasks_boards", "departments_teams", "events_checkin", "volunteer_management", "budget_expenses", "registration_forms", "campaign_calendar", "documents_files", "communications", "campaign_analytics"] },
  local_outreach: { departments: ["campaign_leadership", "evangelistic_outreach", "prayer_intercession", "volunteers", "discipleship_follow_up"],
    modules: ["tasks_boards", "volunteer_management", "outreach_planning", "qr_response_forms", "discipleship_follow_up", "campaign_calendar"] },
  custom_project: { departments: ["campaign_leadership"], modules: ["tasks_boards", "campaign_calendar"] },
};

const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((value) => value || null);
const optionalDate = z.iso.date().nullish().transform((value) => value ?? null);
const validZone = (value: string | null) => {
  if (value === null) return true;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
};
const unique = <T extends string>(list: readonly T[]) => new Set(list).size === list.length;

export const typeStep = z.object({ type: z.enum(campaignTypes) }).strict();
export const basicsStep = z.object({ name: z.string().trim().min(1).max(200), description: optionalText(5000), mission: optionalText(5000) }).strict();
export const placeStep = z.object({
  country: optionalText(100), cityRegion: optionalText(200), startDate: optionalDate, endDate: optionalDate,
  timeZone: optionalText(100).refine(validZone), structure: z.enum(campaignStructures).nullish().transform((value) => value ?? null),
}).strict().refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { path: ["endDate"], message: "INVALID_DATE_RANGE" });
// Step 4 saves the departments only. People join a department by an invitation they accept (founder decision Q2); see `invitationInput`.
export const leadersStep = z.object({
  departments: z.array(z.enum(departmentKeys)).max(departmentKeys.length).refine(unique),
}).strict();
export const INVITATION_DAYS = 14;
/** One invitation: an existing ministry member (`userId`) or an email address (`email`; a member's email invites that member). */
export const invitationInput = z.object({
  department: z.enum(departmentKeys), role: z.enum(["leader", "member"]),
  userId: z.string().min(1).max(200).optional(), email: z.string().trim().toLowerCase().pipe(z.email().max(254)).optional(),
}).strict().refine((value) => (value.userId === undefined) !== (value.email === undefined), { message: "ONE_TARGET" });
export const invitationTokenInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export type InvitationState = "pending" | "accepted" | "expired" | "revoked";
export const toolsStep = z.object({ modules: z.array(z.enum(moduleKeys)).max(moduleKeys.length).refine(unique) }).strict();

// Steps 6 and 7 are configuration only: nothing reads them to take an outward action.
const minor = z.number().int().min(0).max(10_000_000_000_000).nullable();
export const budgetConfig = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/), estimatedBudgetMinor: minor, fundraisingEnabled: z.boolean(),
  fundraisingGoalMinor: minor, onlineDonations: z.boolean(),
}).strict().refine((v) => v.fundraisingEnabled || (!v.onlineDonations && v.fundraisingGoalMinor === null), { path: ["fundraisingEnabled"], message: "FUNDRAISING_OFF" });
export const outreachConfig = z.object({
  registration: z.boolean(), qrResponse: z.boolean(), accountInvites: z.boolean(), communityDiscovery: z.boolean(), followUp: z.boolean(), churchReferrals: z.boolean(),
}).strict().refine((v) => !(v.accountInvites || v.followUp || v.churchReferrals) || v.registration || v.qrResponse, { path: ["registration"], message: "NEEDS_REGISTRATION_OR_RESPONSE" })
  .refine((v) => !v.communityDiscovery || v.accountInvites, { path: ["communityDiscovery"], message: "NEEDS_ACCOUNT_INVITES" });
export const defaultBudget = { currency: "USD", estimatedBudgetMinor: null, fundraisingEnabled: false, fundraisingGoalMinor: null, onlineDonations: false } as const;
export const defaultOutreach = { registration: false, qrResponse: false, accountInvites: false, communityDiscovery: false, followUp: false, churchReferrals: false } as const;
export type BudgetConfig = z.infer<typeof budgetConfig>;
export type OutreachConfig = z.infer<typeof outreachConfig>;

// One autosave: the step id, the version the client last saw and that step's answers. A save checks the shape only; completeness is `validateDraft`.
const stepData = { type: typeStep, basics: basicsStep, place: placeStep, leaders: leadersStep, tools: toolsStep, budget: budgetConfig, connect: outreachConfig } as const;
export type DataStep = keyof typeof stepData;
export const dataSteps = Object.keys(stepData) as DataStep[];
export const saveInput = z.object({ version: z.number().int().min(1), step: z.enum(wizardSteps), data: z.unknown() }).strict()
  .transform((value, ctx) => {
    if (value.step === "review") { ctx.addIssue({ code: "custom", path: ["step"], message: "NOT_A_DATA_STEP" }); return z.NEVER; }
    const parsed = stepData[value.step].safeParse(value.data);
    if (!parsed.success) { parsed.error.issues.forEach((issue) => ctx.addIssue({ ...issue, path: ["data", ...issue.path] })); return z.NEVER; }
    return { version: value.version, step: value.step as DataStep, data: parsed.data as Record<string, unknown> };
  });
export const versionInput = z.object({ version: z.number().int().min(1) }).strict();
export const createDraftInput = z.object({ type: z.enum(campaignTypes).nullish().transform((value) => value ?? null) }).strict();
export const draftClientKey = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/);
export const campaignStatusInput = z.object({ status: z.enum(["draft", "active"]) }).strict();

export type DraftSnapshot = {
  type: typeof campaignTypes[number] | null; name: string | null; country: string | null; cityRegion: string | null;
  startDate: string | null; endDate: string | null; timeZone: string | null; structure: typeof campaignStructures[number] | null;
  departments: string[]; modules: string[]; budget: BudgetConfig; outreach: OutreachConfig;
};
export type Issue = { step: WizardStep; code: string };

/** The place fields a campaign needs before it can go live. Shared by finish (draft) and activate (campaign row). */
export function placeIssues(place: Pick<DraftSnapshot, "country" | "cityRegion" | "startDate" | "endDate" | "timeZone" | "structure">): Issue[] {
  const issues: Issue[] = [];
  if (!place.structure) issues.push({ step: "place", code: "STRUCTURE_REQUIRED" });
  if (!place.startDate || !place.endDate) issues.push({ step: "place", code: "DATES_REQUIRED" });
  if (!place.timeZone) issues.push({ step: "place", code: "TIME_ZONE_REQUIRED" });
  if (place.structure !== "online_hybrid" && !place.country) issues.push({ step: "place", code: "COUNTRY_REQUIRED" });
  return issues;
}

/** Every reason a draft cannot be finished yet, in step order. An empty list means ready. Consistency rules tie steps 5, 6 and 7 together. */
export function validateDraft(draft: DraftSnapshot): Issue[] {
  const issues: Issue[] = [];
  if (!draft.type) issues.push({ step: "type", code: "TYPE_REQUIRED" });
  if (!draft.name) issues.push({ step: "basics", code: "NAME_REQUIRED" });
  issues.push(...placeIssues(draft));
  if (draft.budget.fundraisingEnabled && !draft.modules.includes("fundraising_donations")) issues.push({ step: "tools", code: "FUNDRAISING_MODULE_OFF" });
  if (draft.outreach.qrResponse && !draft.modules.includes("qr_response_forms")) issues.push({ step: "tools", code: "QR_MODULE_OFF" });
  if (draft.outreach.registration && !draft.modules.includes("registration_forms")) issues.push({ step: "tools", code: "REGISTRATION_MODULE_OFF" });
  return issues;
}

/** Which steps hold at least one blocking issue, for the progress indicator. */
export const stepsWithIssues = (issues: Issue[]) => [...new Set(issues.map((issue) => issue.step))];

/** The nine setup items the PRD's Post-Creation Checklist lists, in its order. Completion is stored per item; two of them also tick themselves from what the draft already holds. */
export const checklistItemKeys = ["assign_leaders", "confirm_venues", "define_budget", "connect_payments", "publish_registration", "configure_qr", "assign_counseling", "invite_churches", "create_events"] as const;
export type ChecklistItem = typeof checklistItemKeys[number];
export const checklistInput = z.object({ item: z.enum(checklistItemKeys), done: z.boolean() }).strict();

/**
 * Items that are done because of what is already set up, whatever was stored: every department the campaign includes has an accepted leader, and the
 * counseling department (when included) has one. Anything else can only be ticked by a person.
 */
export function derivedChecklist(departments: readonly string[], leaders: readonly string[]): Record<ChecklistItem, boolean> {
  const led = new Set(leaders);
  return {
    assign_leaders: departments.length > 0 && departments.every((department) => led.has(department)),
    assign_counseling: departments.includes("counseling") && led.has("counseling"),
    confirm_venues: false, define_budget: false, connect_payments: false, publish_registration: false, configure_qr: false, invite_churches: false, create_events: false,
  };
}
