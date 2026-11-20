import type { ComposerInput, ComposerOptions } from "./composer";
import type { CharacterCount } from "./characters";
import type { MediaKind, MediaMetadata, MediaRules } from "./media";
import type { DraftType, SocialPlatform, platformCapabilities } from "./platforms";

// Browser side of the Publish server routes (docs/acceptance/social-publish.md). Types mirror the route responses; nothing here validates
// or counts: the server and the shared counters in characters.ts are the only authorities.
export type Capabilities = (typeof platformCapabilities)[SocialPlatform];
export type DeliveryStatus = "draft" | "scheduled" | "queued" | "publishing" | "published" | "failed" | "cancelled" | "unknown";
export type ConnectionView = {
  id: string; provider: string; platform: SocialPlatform; displayName: string | null; availability: "available" | "unavailable";
  status: string; health: string; healthCode: string | null; healthCheckedAt: string | null; version: number; createdAt: string;
  capabilities: Capabilities; mediaRulesVersion: string;
  mediaCapabilities: { post: MediaRules | null; story: MediaRules | null; article: MediaRules | null; reel: MediaRules | null; short: MediaRules | null };
};
export type FileState = { id: string; name: string; mime: string; size: number; status: string; mediaMetadata: MediaMetadata | null };
export type MediaResult = { fileId: string; kind: MediaKind | null; errors: string[]; accepted: boolean };
export type DestinationPreview = {
  account: { id: string; platform: SocialPlatform; status: string; health: string; displayName: string | null; version: number };
  content: string; mode: "same" | "custom"; characters: CharacterCount; errors: string[]; warnings: string[];
  media: MediaResult[]; cover: { fileId: string; accepted: boolean; errors: string[] } | null; mediaRulesVersion: string;
  attachments: ComposerInput["media"]; options?: ComposerOptions;
};
export type Delivery = {
  id: string; draftId: string | null; connectionId: string | null; scheduleId: string | null; status: DeliveryStatus; displayTimezone: string; version: number;
  scheduledFor: string | null; publishedAt: string | null; attempts: number; lastErrorCode: string | null; repeatNumber: number; retryable: boolean;
};
export type DraftView = { id: string; document: ComposerInput; status: string; version: number; createdAt: string; updatedAt: string; destinations: Delivery[] };
export type DraftSummary = { id: string; type: DraftType; version: number; connectionIds: string[]; updatedAt: string; summary: string };
export type Schedule = { id: string; platform: SocialPlatform | null; name: string; timezone: string; slots: { day: number; time: string }[]; version: number };
export type PlannerItem = {
  id: string; draftId: string | null; connectionId: string | null; scheduleId: string | null; platform: SocialPlatform | null; version: number; deliveryVersion: number | null;
  status: DeliveryStatus; at: string; displayTimezone: string; type: string; summary: string; lastErrorCode: string | null; scheduledFor: string | null;
  publishedAt: string | null; retryable: boolean; day: string; week: string;
};
export type Target = { kind: "time"; scheduledFor: string; timezone: string } | { kind: "next"; scheduleId?: string };

export class SocialApiError extends Error {
  constructor(readonly status: number, readonly code: string | null, readonly details: Record<string, unknown> = {}) { super(code ?? String(status)); }
  /** The server answers one neutral 404 for a disabled integration, a missing record and a role without access. */
  get unavailable() { return this.status === 404; }
  get conflict() { return this.status === 409; }
}

const base = (tenantId: string) => `/api/workspaces/${tenantId}/social`;
export async function socialRequest<T>(tenantId: string, path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base(tenantId)}${path}`, { method: init.method ?? "GET", signal: init.signal, cache: "no-store",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new SocialApiError(0, "NETWORK");
  }
  const data = await response.json().catch(() => null) as { error?: string; details?: { code?: string } & Record<string, unknown>; code?: string } | null;
  if (!response.ok) throw new SocialApiError(response.status, data?.details?.code ?? data?.code ?? null, data?.details ?? {});
  return data as T;
}
export const socialApi = (tenantId: string) => ({
  connections: (signal?: AbortSignal) => socialRequest<{ connections: ConnectionView[] }>(tenantId, "/connections", { signal }),
  link: (body: { provider: "fake"; credential: string; accountRef: string }) => socialRequest<{ connection: ConnectionView }>(tenantId, "/connections", { method: "POST", body }),
  patchConnection: (id: string, body: { enabled: boolean } | { refreshHealth: true }) => socialRequest<{ connection: ConnectionView }>(tenantId, `/connections/${id}`, { method: "PATCH", body }),
  schedules: (signal?: AbortSignal) => socialRequest<{ schedules: Schedule[]; defaultScheduleId: string | null }>(tenantId, "/schedules", { signal }),
  createSchedule: (body: object) => socialRequest<{ schedule: Schedule }>(tenantId, "/schedules", { method: "POST", body }),
  updateSchedule: (id: string, body: object) => socialRequest<{ schedule: Schedule }>(tenantId, `/schedules/${id}`, { method: "PATCH", body }),
  archiveSchedule: (id: string, version: number) => socialRequest<{ archived: boolean }>(tenantId, `/schedules/${id}`, { method: "DELETE", body: { version } }),
  queue: (scheduleId: string, signal?: AbortSignal) => socialRequest<{ queue: PlannerItem[]; nextCursor: string | null }>(tenantId, `/schedules/${scheduleId}/queue?limit=100`, { signal }),
  planner: (query: Record<string, string>, signal?: AbortSignal) => socialRequest<{ days: Record<string, PlannerItem[]>; weeks: Record<string, PlannerItem[]>; timezone: string; nextCursor: string | null }>(
    tenantId, `/planner?${new URLSearchParams(query)}`, { signal }),
  drafts: (signal?: AbortSignal) => socialRequest<{ drafts: DraftSummary[]; nextCursor: string | null }>(tenantId, "/drafts?limit=100", { signal }),
  draft: (id: string, signal?: AbortSignal) => socialRequest<{ draft: DraftView }>(tenantId, `/drafts/${id}`, { signal }),
  saveDraft: (document: ComposerInput) => socialRequest<{ draft: DraftView; destinations: DestinationPreview[] }>(tenantId, "/drafts", { method: "POST", body: document }),
  preview: (document: ComposerInput, signal?: AbortSignal) => socialRequest<{ destinations: DestinationPreview[]; missingMedia: boolean }>(tenantId, "/drafts/preview", { method: "POST", body: document, signal }),
  change: (id: string, body: object) => socialRequest<{ draft: DraftView; destinations?: DestinationPreview[]; review?: { token: string; expiresAt: string; destinations: DestinationPreview[] } }>(
    tenantId, `/drafts/${id}`, { method: "PATCH", body }),
});
export type SocialApi = ReturnType<typeof socialApi>;
