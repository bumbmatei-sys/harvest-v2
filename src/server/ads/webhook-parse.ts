import type { AdsEvent } from "./contract";

export const adsEventTypes = ["ad_account.status_changed", "account.ads.sync_failed", "account.ads.sync_recovered", "account.ads.initial_sync_completed",
  "campaign.updated", "ad_set.updated", "ad.updated", "ad.review_updated", "ad.delivery_issue", "lead.received", "ad_rule.run"] as const;
const ref = (v: unknown) => typeof v === "string" && v.length >= 1 && v.length <= 200 && v.isWellFormed() && !v.includes("\u0000");
/** Normalised delivery shape: { id, type, timestamp, accountRef, subjectRef?, data? }. TODO(live): map the vendor's own envelope in the adapter before this step. */
export function parseAdsEvent(rawBody: string): AdsEvent | null {
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (!ref(b.id) || typeof b.type !== "string" || !(adsEventTypes as readonly string[]).includes(b.type) || !ref(b.accountRef)) return null;
  const at = typeof b.timestamp === "string" ? new Date(b.timestamp) : null;
  if (!at || !Number.isFinite(at.getTime())) return null;
  const subjectRef = b.subjectRef === undefined || b.subjectRef === null ? null : ref(b.subjectRef) ? b.subjectRef as string : undefined;
  if (subjectRef === undefined) return null;
  const data = b.data && typeof b.data === "object" && !Array.isArray(b.data) ? b.data as Record<string, unknown> : {};
  if (JSON.stringify(data).length > 12_000) return null;
  return { eventId: b.id as string, type: b.type as AdsEvent["type"], accountRef: b.accountRef as string, subjectRef, data, occurredAt: at };
}
