import { z } from "zod";
import { storedText } from "./composer";

export const autoDmTriggers = ["comment", "dm", "story_reply", "story_mention", "welcome", "ice_breaker", "persistent_menu", "live_comment"] as const;
export type AutoDmTrigger = typeof autoDmTriggers[number];
export const autoDmPlatforms = ["instagram", "facebook"] as const;
export type AutoDmPlatform = typeof autoDmPlatforms[number];
export function autoDmCapabilities(platform: string): Record<AutoDmTrigger, "conditional" | "unavailable"> {
  const meta = platform === "instagram" || platform === "facebook";
  const supported: AutoDmTrigger[] = meta ? ["comment", "dm", "welcome",
    ...(platform === "instagram" ? ["story_reply", "story_mention", "ice_breaker"] as const : ["persistent_menu"] as const)] : [];
  return Object.fromEntries(autoDmTriggers.map(trigger => [trigger, supported.includes(trigger) ? "conditional" : "unavailable"])) as Record<AutoDmTrigger, "conditional" | "unavailable">;
}

const nonempty = (max: number) => storedText(max).transform(value => value.trim()).refine(Boolean);
const template = nonempty(1_000).refine(value => !/{{|}}/.test(value.replace(/{{\s*(firstName)\s*}}/g, "")));
const terms = z.array(nonempty(80)).max(15).default([]);
export const autoDmRuleInput = z.object({
  name: nonempty(120), trigger: z.enum(autoDmTriggers), postId: z.uuid().nullable().default(null),
  postRef: nonempty(200).nullable().default(null), entryKey: z.string().regex(/^[a-zA-Z0-9_-]{1,70}$/).nullable().default(null),
  match: z.object({ mode: z.enum(["contains", "word", "exact", "any"]), caseSensitive: z.boolean().default(false),
    keywords: terms, exclude: terms, stop: terms }).strict(),
  response: z.object({ text: template, publicReply: template.nullable().default(null), fileId: z.uuid().nullable().default(null),
    quickReplies: z.array(z.object({ title: nonempty(20), key: z.string().regex(/^[a-zA-Z0-9_-]{1,70}$/) }).strict()).max(13).default([]),
    followup: z.object({ text: template, delayMinutes: z.number().int().min(5).max(720) }).strict().nullable().default(null),
  }).strict(),
  purpose: z.enum(["service", "marketing", "outreach_follow_up", "account_communications", "messaging"]).default("service"),
  serviceOnly: z.boolean().default(false),
  cooldownMinutes: z.number().int().min(1).max(43_200).default(1_440),
  recipientDaily: z.number().int().min(1).max(5).default(1), ruleDaily: z.number().int().min(1).max(500).default(50),
  hours: z.enum(["ignore", "skip", "away"]).default("skip"),
  handoffUserId: nonempty(200).nullable().default(null),
}).strict().superRefine((rule, ctx) => {
  const require = (condition: unknown, path: string) => {
    if (!condition) ctx.addIssue({ code: "custom", path: [path], message: "INVALID_RULE_COMBINATION" });
  };
  require(!rule.postId || !rule.postRef, "postId");
  require((!rule.postId && !rule.postRef) || rule.trigger === "comment", "postRef");
  require(!rule.response.publicReply || rule.trigger === "comment", "response");
  require((!rule.response.fileId && !rule.response.followup) || rule.trigger !== "comment", "response");
  require(!rule.response.followup || rule.purpose !== "service", "response");
  require(rule.purpose !== "service" || rule.serviceOnly, "serviceOnly");
  require((rule.trigger === "ice_breaker" || rule.trigger === "persistent_menu") === !!rule.entryKey, "entryKey");
  require(rule.trigger !== "comment" && rule.trigger !== "dm" || rule.match.keywords.length > 0, "match");
  require(new Set(rule.response.quickReplies.map(button => button.key)).size === rule.response.quickReplies.length, "response");
});
export type AutoDmRule = z.infer<typeof autoDmRuleInput>;

function normalized(value: string, sensitive: boolean) {
  const canonical = value.normalize("NFKC").trim();
  return sensitive ? canonical : canonical.toLowerCase();
}
export function matchAutoDm(rule: AutoDmRule["match"], text: string | null) {
  if (text === null) return rule.keywords.length || rule.exclude.length || rule.stop.length ? "unavailable" : "matched";
  const input = normalized(text, rule.caseSensitive);
  const includes = (term: string) => input.includes(normalized(term, rule.caseSensitive));
  if (rule.stop.some(includes)) return "stop";
  if (rule.exclude.some(includes)) return "excluded";
  const matches = rule.keywords.some(value => {
    const term = normalized(value, rule.caseSensitive);
    if (rule.mode === "exact") return input === term;
    if (rule.mode === "word") {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?:$|[^\\p{L}\\p{N}_])`, "u").test(input);
    }
    return includes(value);
  });
  return !rule.keywords.length || matches ? "matched" : "excluded";
}

export function renderAutoDm(template: string, firstName?: string | null) {
  return template.replace(/{{\s*firstName\s*}}/g, () => firstName?.trim().split(/\s+/u)[0]?.slice(0, 80) || "there");
}

export function autoDmOpen(at: Date, settings: { timezone: string; hours: { day: number; start: string; end: string }[] }) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at).map(part => [part.type, part.value]));
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  const time = `${parts.hour}:${parts.minute}`;
  return settings.hours.some(slot => slot.day === day && time >= slot.start && time < slot.end);
}
