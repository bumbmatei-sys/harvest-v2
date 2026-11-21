import { autoDmRuleInput, autoDmTriggers, type AutoDmRule, type AutoDmTrigger } from "./auto-dm";
import type { JobCount, JobReason, JobState } from "./auto-dm-api";
import type { SocialPlatform } from "./platforms";

// Pure helpers for the Auto-DM screens. Nothing here decides what the server accepts: it only shapes what the screens show and offers.

/** Why a trigger is not offered for an account. Codes are fixed; the screens turn them into catalogue text. */
export type TriggerReason = "PLATFORM" | "INSTAGRAM_ONLY" | "FACEBOOK_ONLY" | "NO_LIVE_LOOKUP";
export type TriggerOption = { trigger: AutoDmTrigger; available: boolean; reason: TriggerReason | null };
export function triggerOptions(platform: SocialPlatform | null, capabilities: Record<AutoDmTrigger, "conditional" | "unavailable"> | null): TriggerOption[] {
  return autoDmTriggers.map((trigger) => {
    if (capabilities && capabilities[trigger] === "conditional") return { trigger, available: true, reason: null };
    const reason: TriggerReason = trigger === "live_comment" ? "NO_LIVE_LOOKUP"
      : !platform || (platform !== "instagram" && platform !== "facebook") ? "PLATFORM"
      : trigger === "persistent_menu" ? "FACEBOOK_ONLY" : "INSTAGRAM_ONLY";
    return { trigger, available: false, reason };
  });
}

export const blankRule = (trigger: AutoDmTrigger = "comment"): AutoDmRule => ({
  name: "", trigger, postId: null, postRef: null, entryKey: null,
  match: { mode: "word", caseSensitive: false, keywords: [], exclude: [], stop: [] },
  response: { text: "", publicReply: null, fileId: null, quickReplies: [], followup: null },
  purpose: "service", serviceOnly: false, cooldownMinutes: 1440, recipientDaily: 1, ruleDaily: 50, hours: "skip", handoffUserId: null,
});
/** Triggers that match on text the person wrote. The others fire on an event, so keywords are optional there. */
export const takesKeywords = (trigger: AutoDmTrigger) => trigger === "comment" || trigger === "dm";
export const takesPost = (trigger: AutoDmTrigger) => trigger === "comment";
export const takesEntry = (trigger: AutoDmTrigger) => trigger === "ice_breaker" || trigger === "persistent_menu";

/** What changes when the trigger changes: fields that only belong to another trigger are dropped so the rule stays valid. */
export function withTrigger(rule: AutoDmRule, trigger: AutoDmTrigger): AutoDmRule {
  const comment = trigger === "comment";
  return { ...rule, trigger, postId: comment ? rule.postId : null, postRef: comment ? rule.postRef : null, entryKey: takesEntry(trigger) ? rule.entryKey : null,
    response: { ...rule.response, publicReply: comment ? rule.response.publicReply : null, fileId: comment ? null : rule.response.fileId, followup: comment ? null : rule.response.followup } };
}

export type StepId = "trigger" | "match" | "response" | "limits" | "review";
export const steps: readonly StepId[] = ["trigger", "match", "response", "limits", "review"];
const stepOf: Record<string, StepId> = { name: "trigger", trigger: "trigger", postId: "trigger", postRef: "trigger", entryKey: "trigger", match: "match",
  response: "response", purpose: "response", serviceOnly: "response", cooldownMinutes: "limits", recipientDaily: "limits", ruleDaily: "limits", hours: "limits", handoffUserId: "limits" };
/** Per step, the field names the shared rule schema rejects (an empty list means the step is complete). Uses the same schema as the server. */
export function stepIssues(rule: AutoDmRule): Record<StepId, string[]> {
  const issues: Record<StepId, string[]> = { trigger: [], match: [], response: [], limits: [], review: [] };
  const parsed = autoDmRuleInput.safeParse(rule);
  if (parsed.success) return issues;
  for (const issue of parsed.error.issues) {
    const head = String(issue.path[0] ?? ""), step = stepOf[head] ?? "review";
    const field = issue.path.length > 1 ? issue.path.join(".") : head;
    if (!issues[step].includes(field)) issues[step].push(field);
  }
  return issues;
}

/** Likely promotional or fundraising wording in a template. Advisory: it flags text for the person approving it; it is not a legal review. */
const promotional: { label: string; pattern: RegExp }[] = [
  { label: "free", pattern: /\bfree\b/i }, { label: "discount", pattern: /\bdiscounts?\b/i }, { label: "% off", pattern: /\d+\s*%\s*off/i }, { label: "sale", pattern: /\bsale\b/i },
  { label: "buy", pattern: /\b(buy|purchase|order now|shop)\b/i }, { label: "offer", pattern: /\b(special offer|limited[- ]time|offers?|deals?)\b/i },
  { label: "coupon", pattern: /\b(coupon|promo(?: code)?)\b/i }, { label: "sign up", pattern: /\b(sign up|subscribe|register now)\b/i },
  { label: "donate", pattern: /\b(donate|donation|give today|give now|fundrais\w*|pledge|sponsor)\b/i }, { label: "support us", pattern: /\bsupport (us|our)\b/i },
];
export function promotionalFlags(...texts: (string | null | undefined)[]) {
  const text = texts.filter(Boolean).join("\n");
  return promotional.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}
/** Every template a rule carries, in the order a person meets them. */
export function ruleTemplates(rule: Pick<AutoDmRule, "response">) {
  return [{ kind: "dm" as const, text: rule.response.text }, ...(rule.response.publicReply ? [{ kind: "publicReply" as const, text: rule.response.publicReply }] : []),
    ...(rule.response.followup ? [{ kind: "followup" as const, text: rule.response.followup.text }] : [])];
}
export const ruleFlags = (rule: Pick<AutoDmRule, "response">) => promotionalFlags(...ruleTemplates(rule).map((item) => item.text));
/** The attestation covers the exact text it was given for: when a template changes, the person confirms again. */
export function attestationStillHolds(saved: AutoDmRule | null, next: AutoDmRule) {
  if (!saved || !saved.serviceOnly) return false;
  const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "") === (b ?? "");
  return same(saved.response.text, next.response.text) && same(saved.response.publicReply, next.response.publicReply) && same(saved.response.followup?.text, next.response.followup?.text);
}

export type Totals = { triggered: number; sent: number; handedOff: number; unknown: number; inProgress: number; cancelled: number; skipped: Record<JobReason | "other", number>; skippedTotal: number };
/** Counts are per primary job: the one outcome for each trigger of the rule. */
export function summarize(counts: readonly JobCount[]): Totals {
  const totals: Totals = { triggered: 0, sent: 0, handedOff: 0, unknown: 0, inProgress: 0, cancelled: 0, skipped: { cooldown: 0, limit: 0, outside_hours: 0, ineligible: 0, suppressed: 0, provider_error: 0, other: 0 }, skippedTotal: 0 };
  for (const { state, reason, count } of counts) {
    totals.triggered += count;
    if (state === "sent") totals.sent += count;
    else if (state === "handed_off") totals.handedOff += count;
    else if (state === "unknown") totals.unknown += count;
    else if (state === "cancelled") totals.cancelled += count;
    else if (state === "skipped") { totals.skipped[reason ?? "other"] += count; totals.skippedTotal += count; }
    else totals.inProgress += count;
  }
  return totals;
}
export const addTotals = (a: Totals, b: Totals): Totals => ({ triggered: a.triggered + b.triggered, sent: a.sent + b.sent, handedOff: a.handedOff + b.handedOff, unknown: a.unknown + b.unknown, inProgress: a.inProgress + b.inProgress,
  cancelled: a.cancelled + b.cancelled, skippedTotal: a.skippedTotal + b.skippedTotal, skipped: Object.fromEntries(Object.keys(a.skipped).map((key) => [key, a.skipped[key as JobReason] + b.skipped[key as JobReason]])) as Totals["skipped"] });
export const emptyTotals = (): Totals => summarize([]);
export const jobStates: readonly JobState[] = ["queued", "leased", "dispatching", "unknown", "sent", "skipped", "handed_off", "cancelled"];

export const cooldownChoices = [60, 360, 1440, 4320, 10080, 43200] as const;
/** The cooldown in the largest whole unit: [amount, "minutes" | "hours" | "days"]. */
export function cooldownUnit(minutes: number): ["minutes" | "hours" | "days", number] {
  if (minutes % 1440 === 0) return ["days", minutes / 1440];
  if (minutes % 60 === 0) return ["hours", minutes / 60];
  return ["minutes", minutes];
}
export const weekdays = [1, 2, 3, 4, 5, 6, 7] as const;

/** Separators and placeholders kept out of JSX so the copy guard sees only catalogue text. */
export const sym = { dot: " · ", dash: "-", pending: "…", plus: "+", of: (used: number, max: number) => `${used}/${max}` } as const;
