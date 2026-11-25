import type { AdAccountView, AdsAlert, ResultsRow, TreeCampaign } from "./view";
import type { AdLevel } from "./ads";

// Browser side of the Ads routes under /api/workspaces/:id/social/ads. Every route answers one neutral 404 while Ads is off or the role has no access.
export class AdsApiError extends Error {
  constructor(readonly status: number, readonly code: string | null, readonly details: Record<string, unknown> = {}) { super(code ?? String(status)); }
  get unavailable() { return this.status === 404; }
  get stale() { return this.status === 409; }
}
export async function adsRequest<T>(tenantId: string, path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/workspaces/${tenantId}/social/ads/${path}`, { method: init.method ?? "GET", signal: init.signal, cache: "no-store",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AdsApiError(0, "NETWORK");
  }
  const data = await response.json().catch(() => null) as { error?: string; details?: { code?: string } & Record<string, unknown>; code?: string } | null;
  if (!response.ok) throw new AdsApiError(response.status, data?.details?.code ?? data?.code ?? null, data?.details ?? {});
  return data as T;
}
export const newKey = () => crypto.randomUUID();

export type LeadFormView = { id: string; name: string; status: string; questions: string[]; consentText: string };
export type AudienceView = { id: string; kind: string; name: string; sizeEstimate: number | null; status: string };
export type LaunchRequestView = { id: string; adAccountId: string; kind: string; status: string; payload: Record<string, unknown>; validation: { ok: boolean; problems: string[] } | null; reviewedAt: string | null;
  resultCampaignId: string | null; resultAdSetId: string | null; resultAdId: string | null; errorCode: string | null; version: number; createdAt: string };
export type BoostablePost = { ref: string; platform: string; caption: string | null; publishedAt: string | null };
export type TargetingHit = { id: string; name: string; kind: string };

export const adsApi = (tenantId: string) => ({
  accounts: (signal?: AbortSignal) => adsRequest<{ accounts: AdAccountView[] }>(tenantId, "accounts", { signal }),
  link: (connectionId: string) => adsRequest<{ accounts: AdAccountView[] }>(tenantId, "accounts/link", { method: "POST", body: { connectionId } }),
  health: (id: string) => adsRequest<{ account: AdAccountView }>(tenantId, `accounts/${id}/health`, { method: "POST" }),
  sync: (id: string) => adsRequest<{ synced: boolean; code: string | null }>(tenantId, `accounts/${id}/sync`, { method: "POST" }),
  syncResults: (id: string, from: string, to: string) => adsRequest<{ written: number; partial: boolean }>(tenantId, `accounts/${id}/results-sync`, { method: "POST", body: { from, to } }),
  tree: (adAccountId: string, signal?: AbortSignal) => adsRequest<{ campaigns: TreeCampaign[] }>(tenantId, `tree?adAccountId=${adAccountId}`, { signal }),
  results: (adAccountId: string, level: AdLevel, from: string, to: string, signal?: AbortSignal) =>
    adsRequest<{ rows: ResultsRow[]; truncated: boolean }>(tenantId, `results?${new URLSearchParams({ adAccountId, level, from, to })}`, { signal }),
  alerts: (signal?: AbortSignal) => adsRequest<{ alerts: AdsAlert[] }>(tenantId, "alerts", { signal }),
  dismissAlert: (id: string) => adsRequest<{ dismissed: boolean }>(tenantId, `alerts/${id}/dismiss`, { method: "POST" }),
  setStatus: (body: { level: AdLevel; id: string; status: "active" | "paused"; version: number }) => adsRequest<unknown>(tenantId, "status", { method: "POST", body: { ...body, idempotencyKey: newKey() } }),
  bulkStatus: (status: "active" | "paused", items: { level: AdLevel; id: string; version: number }[]) => adsRequest<unknown>(tenantId, "status/bulk", { method: "POST", body: { status, items, idempotencyKey: newKey() } }),
  rename: (body: { level: AdLevel; id: string; name: string; version: number }) => adsRequest<unknown>(tenantId, "rename", { method: "POST", body: { ...body, idempotencyKey: newKey() } }),
  budget: (body: { level: "campaign" | "adset"; id: string; version: number; budgetAmount?: number; endDate?: string }) => adsRequest<unknown>(tenantId, "budget", { method: "POST", body: { ...body, confirm: true, idempotencyKey: newKey() } }),
  remove: (body: { level: AdLevel; id: string; version: number }) => adsRequest<unknown>(tenantId, "delete", { method: "POST", body: { ...body, confirmIrreversible: true, idempotencyKey: newKey() } }),
  leadForms: (adAccountId: string) => adsRequest<{ forms: LeadFormView[] }>(tenantId, `lead-forms?adAccountId=${adAccountId}`),
  audiences: (adAccountId: string) => adsRequest<{ audiences: AudienceView[] }>(tenantId, `audiences?adAccountId=${adAccountId}`),
  boostable: (adAccountId: string) => adsRequest<{ posts: BoostablePost[] }>(tenantId, `boostable-posts?adAccountId=${adAccountId}`),
  searchTargeting: (adAccountId: string, kind: string, query: string, signal?: AbortSignal) => adsRequest<{ hits: TargetingHit[] }>(tenantId, "targeting-search", { method: "POST", body: { adAccountId, kind, query }, signal }),
  createRequest: (kind: "campaign" | "boost" | "add_ad", payload: Record<string, unknown>) => adsRequest<{ request: LaunchRequestView }>(tenantId, "launch-requests", { method: "POST", body: { kind, payload } }),
  updateRequest: (id: string, payload: Record<string, unknown>, version: number) => adsRequest<{ request: LaunchRequestView }>(tenantId, `launch-requests/${id}`, { method: "PATCH", body: { payload, version } }),
  getRequest: (id: string) => adsRequest<{ request: LaunchRequestView }>(tenantId, `launch-requests/${id}`),
  validate: (id: string) => adsRequest<{ request: LaunchRequestView }>(tenantId, `launch-requests/${id}/validate`, { method: "POST" }),
  review: (id: string, version: number) => adsRequest<{ request: LaunchRequestView }>(tenantId, `launch-requests/${id}/review`, { method: "POST", body: { version } }),
  launch: (id: string, idempotencyKey: string) => adsRequest<{ request: LaunchRequestView; replayed: boolean }>(tenantId, `launch-requests/${id}/launch`, { method: "POST", body: { idempotencyKey } }),
  cancelRequest: (id: string) => adsRequest<{ cancelled: boolean }>(tenantId, `launch-requests/${id}/cancel`, { method: "POST" }),
});
