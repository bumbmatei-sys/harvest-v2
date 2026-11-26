import { basicsStep, departmentKeys, leadersStep, moduleKeys, budgetConfig, outreachConfig, placeStep, toolsStep, typeStep, validateDraft, wizardSteps, type DataStep, type Issue, type WizardStep } from "./campaign-wizard";
import type { campaignStructures, campaignTypes } from "./campaigns";
import type { InvitationState } from "./campaign-wizard";

// Client rules for the campaign wizard screens. Pure (no React, no fetch) so the autosave, validation and merge rules are unit-tested.
// The server stays the authority: every value sent here is parsed again there, and completeness is `validateDraft` on both sides.

export type CampaignType = typeof campaignTypes[number];
export type Structure = typeof campaignStructures[number];

/** An invitation as the screens see it (never the link): who it is for, which department and role, and its state. */
export type InvitationView = { id: string; department: string; role: "leader" | "member"; kind: "member" | "email"; userId: string | null; email: string | null; label: string;
  state: InvitationState; createdAt: string; expiresAt: string; respondedAt: string | null; acceptedBy: string | null };

/** What the draft routes return (`view` in the server service). Dates are strings over the wire. */
export type DraftView = {
  id: string; createdBy: string; status: "draft" | "finished" | "discarded"; version: number; currentStep: number; type: CampaignType | null;
  name: string | null; description: string | null; mission: string | null; country: string | null; cityRegion: string | null;
  startDate: string | null; endDate: string | null; timeZone: string | null; structure: Structure | null; departments: string[]; modules: string[];
  budget: { currency: string; estimatedBudgetMinor: number | null; fundraisingEnabled: boolean; fundraisingGoalMinor: number | null; onlineDonations: boolean };
  outreach: { registration: boolean; qrResponse: boolean; accountInvites: boolean; communityDiscovery: boolean; followUp: boolean; churchReferrals: boolean };
  assignments: { userId: string; department: string; role: string }[]; invitations: InvitationView[]; issues: Issue[]; ready: boolean; campaignId: string | null; coverFileId: string | null;
};

/** The steps this screen edits so far (the others are listed in the shell but not yet available). */
export const editableSteps = ["type", "basics", "place", "leaders", "tools", "budget", "connect"] as const satisfies readonly DataStep[];
export type EditableStep = typeof editableSteps[number];
/** The steps a person can open: the seven that take answers, and the review. */
export const isAvailable = (step: WizardStep) => isEditable(step) || step === "review";
export const isEditable = (step: WizardStep): step is EditableStep => (editableSteps as readonly string[]).includes(step);

/** The local, editable copy of the draft: text fields are strings so a half-typed value stays as typed. */
export type WizardForm = {
  type: CampaignType | null;
  basics: { name: string; description: string; mission: string };
  place: { country: string; cityRegion: string; startDate: string; endDate: string; timeZone: string; structure: Structure | "" };
  leaders: { departments: string[] };
  tools: { modules: string[] };
  /** Amounts are typed text so a half-typed figure stays as typed; they become minor units (cents) only when saved. */
  budget: { currency: string; estimated: string; fundraisingEnabled: boolean; goal: string; onlineDonations: boolean };
  connect: DraftView["outreach"];
};
/** Departments and tools in the PRD's order, so two copies with the same choices compare equal. */
const inOrder = (order: readonly string[], list: readonly string[]) => order.filter((key) => list.includes(key));

export function formFromDraft(draft: DraftView): WizardForm {
  return {
    type: draft.type,
    basics: { name: draft.name ?? "", description: draft.description ?? "", mission: draft.mission ?? "" },
    place: { country: draft.country ?? "", cityRegion: draft.cityRegion ?? "", startDate: draft.startDate ?? "", endDate: draft.endDate ?? "", timeZone: draft.timeZone ?? "", structure: draft.structure ?? "" },
    leaders: { departments: inOrder(departmentKeys, draft.departments) }, tools: { modules: inOrder(moduleKeys, draft.modules) }, budget: { currency: draft.budget.currency, estimated: moneyText(draft.budget.estimatedBudgetMinor, draft.budget.currency), fundraisingEnabled: draft.budget.fundraisingEnabled,
      goal: moneyText(draft.budget.fundraisingGoalMinor, draft.budget.currency), onlineDonations: draft.budget.onlineDonations },
    connect: { ...draft.outreach },
  };
}

const orNull = (value: string) => value.trim() || null;

/** Currencies offered for the budget. A draft's saved currency is always offered too, whatever it is. */
export const currencyOptions = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "UAH", "TRY", "ILS", "AED", "EGP", "ZAR", "NGN", "KES", "GHS", "UGX", "TZS",
  "INR", "PKR", "BDT", "LKR", "NPR", "THB", "VND", "PHP", "IDR", "MYR", "SGD", "JPY", "KRW", "CNY", "BRL", "MXN", "COP", "CLP", "ARS", "PEN"] as const;
/** How many decimal places a currency has (2 for dollars, 0 for yen). */
export const currencyDigits = (currency: string) => { try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; } };
/** Typed text to minor units: digits with an optional decimal part no longer than the currency allows, no separators. Empty is no figure. */
export function parseMoney(text: string, currency: string): { ok: true; minor: number | null } | { ok: false } {
  const value = text.trim();
  if (!value) return { ok: true, minor: null };
  const digits = currencyDigits(currency), match = /^(\d{1,13})(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2]?.length ?? 0) > digits) return { ok: false };
  const minor = Number(match[1] + (match[2] ?? "").padEnd(digits, "0"));
  return Number.isSafeInteger(minor) ? { ok: true, minor } : { ok: false };
}
/** Minor units back to the plain text a person types, without trailing noise ("1250", "1250.5"). */
export function moneyText(minor: number | null, currency: string): string {
  if (minor === null) return "";
  const digits = currencyDigits(currency), text = String(minor).padStart(digits + 1, "0");
  const whole = digits ? text.slice(0, -digits) : text, fraction = digits ? text.slice(-digits).replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole;
}
const budgetFields: Record<string, string> = { estimatedBudgetMinor: "estimated", fundraisingGoalMinor: "goal", fundraisingEnabled: "fundraisingEnabled", onlineDonations: "onlineDonations", currency: "currency" };
function budgetPayload(budget: WizardForm["budget"]) {
  const estimated = parseMoney(budget.estimated, budget.currency), goal = parseMoney(budget.goal, budget.currency);
  const bad: Record<string, string> = {};
  if (!estimated.ok) bad.estimated = "INVALID";
  if (!goal.ok) bad.goal = "INVALID";
  const parsed = estimated.ok && goal.ok ? budgetConfig.safeParse({ currency: budget.currency, estimatedBudgetMinor: estimated.minor, fundraisingEnabled: budget.fundraisingEnabled,
    fundraisingGoalMinor: goal.minor, onlineDonations: budget.onlineDonations }) : null;
  if (parsed?.success) return parsed;
  const issues = parsed ? parsed.error.issues.map((issue) => ({ path: [budgetFields[String(issue.path[0])] ?? String(issue.path[0] ?? "form")], code: issue.code, message: issue.message })) : [];
  for (const [field, message] of Object.entries(bad)) issues.push({ path: [field], code: "custom", message });
  return { success: false as const, error: { issues } };
}
export type StepPayload = { ok: true; data: Record<string, unknown> } | { ok: false; problems: Record<string, string> };

/** The exact body a save would send for one step, parsed with the server's own schema; or the field problems that stop it being sent. */
export function stepPayload(step: EditableStep, form: WizardForm): StepPayload {
  const parsed = step === "type" ? typeStep.safeParse({ type: form.type })
    : step === "basics" ? basicsStep.safeParse({ name: form.basics.name, description: orNull(form.basics.description), mission: orNull(form.basics.mission) })
    : step === "leaders" ? leadersStep.safeParse({ departments: inOrder(departmentKeys, form.leaders.departments) })
    : step === "tools" ? toolsStep.safeParse({ modules: inOrder(moduleKeys, form.tools.modules) })
    : step === "connect" ? outreachConfig.safeParse(form.connect)
    : step === "budget" ? budgetPayload(form.budget)
    : placeStep.safeParse({ country: orNull(form.place.country), cityRegion: orNull(form.place.cityRegion), startDate: orNull(form.place.startDate), endDate: orNull(form.place.endDate),
      timeZone: orNull(form.place.timeZone), structure: form.place.structure || null });
  if (parsed.success) return { ok: true, data: parsed.data as Record<string, unknown> };
  const problems: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "form");
    problems[field] ??= issue.message === "INVALID_DATE_RANGE" ? "INVALID_DATE_RANGE" : issue.code === "too_small" ? "REQUIRED" : "INVALID";
  }
  return { ok: false, problems };
}

const stable = (value: unknown) => JSON.stringify(value, Object.keys(value as object).sort());
/** A step is compared by what would be sent (trimmed, nulled), so a trailing space is never a change. An invalid step compares as typed. */
function comparable(step: EditableStep, form: WizardForm) {
  const payload = stepPayload(step, form);
  return payload.ok ? `ok:${stable(payload.data)}` : `invalid:${stable(form[step] === null ? { type: null } : form[step])}`;
}
export const stepChanged = (step: EditableStep, local: WizardForm, saved: WizardForm) => comparable(step, local) !== comparable(step, saved);
/** Steps whose local answers differ from what is saved, in step order. */
export const dirtySteps = (local: WizardForm, saved: WizardForm) => editableSteps.filter((step) => stepChanged(step, local, saved));

/**
 * After a save succeeds, bring in what the server now holds without overwriting what was typed meanwhile: a step with local edits keeps them,
 * and the step just saved keeps what is on screen (it already matches what was sent).
 */
export function adoptServer(local: WizardForm, before: WizardForm, after: WizardForm, savedStep: EditableStep): WizardForm {
  const next = { ...local };
  for (const step of editableSteps) if (step !== savedStep && !stepChanged(step, local, before)) (next as Record<string, unknown>)[step] = after[step];
  return next;
}

/** A local copy of the draft as the pure completeness rules read it, so the screen shows what is missing before a save returns. */
export function issuesOf(form: WizardForm, draft: DraftView): Issue[] {
  return validateDraft({
    type: form.type, name: form.basics.name.trim() || null, country: orNull(form.place.country), cityRegion: orNull(form.place.cityRegion), startDate: orNull(form.place.startDate),
    endDate: orNull(form.place.endDate), timeZone: orNull(form.place.timeZone), structure: form.place.structure || null, departments: form.leaders.departments, modules: form.tools.modules,
    budget: { ...draft.budget, fundraisingEnabled: form.budget.fundraisingEnabled }, outreach: form.connect,
  });
}

export type StepStatus = "done" | "attention" | "todo";
/**
 * Sidebar state per step. A step the person has moved past is done unless it still holds an issue (then it needs attention); a step they have not
 * reached stays not started. Steps that are not editable yet are never marked.
 */
export function stepStatuses(issues: readonly Issue[], reached: number): Record<WizardStep, StepStatus> {
  const withIssues = new Set(issues.map((issue) => issue.step));
  return Object.fromEntries(wizardSteps.map((step, index) => {
    const passed = isEditable(step) && reached > index + 1;
    return [step, passed ? (withIssues.has(step) ? "attention" : "done") : "todo"];
  })) as Record<WizardStep, StepStatus>;
}

/** Which draft rows a person may act on in the list: anyone who can write campaigns continues an open draft; the creator and owners and admins discard. */
export function draftActions(draft: { createdBy: string }, viewerId: string, role: string) {
  const manager = role === "owner" || role === "admin";
  return { edit: manager || role === "member", discard: draft.createdBy === viewerId || manager };
}

export const outreachKeys = ["registration", "qrResponse", "accountInvites", "communityDiscovery", "followUp", "churchReferrals"] as const;
export type OutreachKey = typeof outreachKeys[number];
/** Follow-up, account invitations and church referrals need registration or the response QR; community discovery needs account invitations. The reason each card is off. */
export function outreachBlocked(outreach: DraftView["outreach"]): Partial<Record<OutreachKey, "NEEDS_REGISTRATION_OR_RESPONSE" | "NEEDS_ACCOUNT_INVITES">> {
  const intake = outreach.registration || outreach.qrResponse;
  return { accountInvites: intake ? undefined : "NEEDS_REGISTRATION_OR_RESPONSE", followUp: intake ? undefined : "NEEDS_REGISTRATION_OR_RESPONSE",
    churchReferrals: intake ? undefined : "NEEDS_REGISTRATION_OR_RESPONSE", communityDiscovery: outreach.accountInvites && intake ? undefined : "NEEDS_ACCOUNT_INVITES" };
}
/** Turns one option on or off; anything that then has no ground to stand on is turned off with it, so the saved answers always satisfy the server's rules. */
export function setOutreach(outreach: DraftView["outreach"], key: OutreachKey, on: boolean): DraftView["outreach"] {
  const next = { ...outreach, [key]: on };
  if (!next.registration && !next.qrResponse) { next.accountInvites = false; next.followUp = false; next.churchReferrals = false; }
  if (!next.accountInvites) next.communityDiscovery = false;
  return next;
}
