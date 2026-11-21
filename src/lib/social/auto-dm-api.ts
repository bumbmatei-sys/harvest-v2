import { socialRequest } from "./api";
import type { AutoDmRule, AutoDmTrigger } from "./auto-dm";
import type { SocialPlatform } from "./platforms";

// Browser side of the Auto-DM server routes (docs/acceptance/social-auto-dm.md). Types mirror the route responses; the server is the only authority on what a rule may contain.
export type AutoDmRuleView = AutoDmRule & { id: string; connectionId: string; version: number; enabled: boolean; updatedAt: string };
export type AutoDmAccountView = { id: string; platform: SocialPlatform; name: string | null; status: string; health: string; triggers: Record<AutoDmTrigger, "conditional" | "unavailable"> };
export type JobState = "queued" | "leased" | "dispatching" | "unknown" | "sent" | "skipped" | "handed_off" | "cancelled";
export type JobReason = "cooldown" | "limit" | "outside_hours" | "ineligible" | "suppressed" | "provider_error";
export type JobCount = { state: JobState; reason: JobReason | null; count: number };
export type ActivityRow = { id: string; eventId: string; version: number; state: JobState; reason: JobReason | null; step: "primary" | "public" | "followup"; createdAt: string; completedAt: string | null };
export type RuleReport = { rule: AutoDmRuleView; triggered: number; counts: JobCount[]; activity: ActivityRow[] };
export type PreviewResult = { result: "matched" | "excluded" | "stop" | "unavailable"; response: string; testDelivery: { state: "sent_to_fake"; id: string } | null };
export type HoursSlot = { day: number; start: string; end: string };
export type HoursSettings = { connectionId: string; version: number; timezone: string; hours: HoursSlot[]; awayTemplate: string | null };

export const autoDmApi = (tenantId: string) => ({
  list: (signal?: AbortSignal) => socialRequest<{ rules: AutoDmRuleView[]; accounts: AutoDmAccountView[] }>(tenantId, "/auto-dm", { signal }),
  create: (connectionId: string, rule: AutoDmRule) => socialRequest<{ rule: AutoDmRuleView }>(tenantId, "/auto-dm", { method: "POST", body: { connectionId, rule } }),
  report: (id: string, before?: string | null, signal?: AbortSignal) =>
    socialRequest<RuleReport>(tenantId, `/auto-dm/${id}${before ? `?before=${encodeURIComponent(before)}` : ""}`, { signal }),
  edit: (id: string, version: number, rule: AutoDmRule) => socialRequest<{ rule: AutoDmRuleView }>(tenantId, `/auto-dm/${id}`, { method: "PATCH", body: { action: "edit", version, rule } }),
  review: (id: string, version: number) => socialRequest<{ rule: AutoDmRuleView; review: { token: string; expiresAt: string } }>(tenantId, `/auto-dm/${id}`, { method: "PATCH", body: { action: "review", version } }),
  enable: (id: string, version: number, reviewToken: string) => socialRequest<{ rule: AutoDmRuleView }>(tenantId, `/auto-dm/${id}`, { method: "PATCH", body: { action: "enable", version, reviewToken } }),
  disable: (id: string, version: number) => socialRequest<{ rule: AutoDmRuleView }>(tenantId, `/auto-dm/${id}`, { method: "PATCH", body: { action: "disable", version } }),
  preview: (body: { platform: SocialPlatform; rule: AutoDmRule; sample: string | null; testSend: boolean }) => socialRequest<PreviewResult>(tenantId, "/auto-dm/preview", { method: "POST", body }),
  hours: (connectionId: string, signal?: AbortSignal) => socialRequest<{ settings: HoursSettings }>(tenantId, `/inbox/accounts/${connectionId}/hours`, { signal }),
  saveHours: (connectionId: string, body: { version: number; timezone: string; hours: HoursSlot[]; awayTemplate: string | null }) =>
    socialRequest<{ settings: HoursSettings }>(tenantId, `/inbox/accounts/${connectionId}/hours`, { method: "PATCH", body }),
});
export type AutoDmApi = ReturnType<typeof autoDmApi>;
