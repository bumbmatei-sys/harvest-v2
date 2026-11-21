"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { analyticsQuery, previousRange, type AccountReport, type AnalyticsReport, type PostDetailReport, type Scope, type SeriesMetric, type SeriesPoint, type Summary } from "@/lib/social/analytics-view";

export type AnalyticsData = {
  status: "loading" | "ready" | "unavailable" | "error";
  /** True while a user-initiated reload (new range or scope) runs over data that is already on screen. */
  reloading: boolean;
  report: AnalyticsReport | null; previous: Summary | null;
  series: Partial<Record<SeriesMetric, SeriesPoint[]>>;
  /** Every account in the ministry, from the last report that was not narrowed by a filter. */
  accounts: AccountReport[];
  retry: () => void;
};
const pollMs = 60_000;

class HttpError extends Error { constructor(readonly status: number) { super(String(status)); } }
type Fetched<T> = { status: number; body: T | null; retryAfter: number | null; etag: string | null };

async function get<T>(url: string, signal: AbortSignal, etag?: string): Promise<Fetched<T>> {
  let response: Response;
  try { response = await fetch(url, { signal, cache: "no-store", headers: etag ? { "If-None-Match": etag } : undefined }); }
  catch (error) { if (error instanceof DOMException && error.name === "AbortError") throw error; throw new HttpError(0); }
  const retry = Number(response.headers.get("Retry-After"));
  const retryAfter = Number.isFinite(retry) && retry > 0 ? retry : null;
  if (response.status === 304) return { status: 304, body: null, retryAfter, etag: response.headers.get("ETag") };
  if (!response.ok) throw new HttpError(response.status);
  return { status: 200, body: await response.json() as T, retryAfter, etag: response.headers.get("ETag") };
}

/**
 * Loads the report, the previous period (for the deltas) and one series per card metric, all through the read-only Analytics route.
 * Polling follows the acceptance record: If-None-Match with the last ETag, the previous data is reused on 304, Retry-After is respected, and polling
 * pauses while the screen is hidden. Polling never shows a loading state and never replays the entrance.
 */
export function useAnalytics(tenantId: string, range: { from: string; to: string }, timezone: string, scope: Scope): AnalyticsData {
  const [data, setData] = useState<Omit<AnalyticsData, "retry">>({ status: "loading", reloading: false, report: null, previous: null, series: {}, accounts: [] });
  const [version, setVersion] = useState(0);
  const etag = useRef<{ key: string; value: string } | null>(null);
  const accountsRef = useRef<AccountReport[]>([]);
  const scopeKey = scope.kind === "all" ? "all" : scope.kind === "platform" ? `p:${scope.platform}` : `a:${scope.id}`;
  const rangeKey = `${range.from}:${range.to}`;

  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined, controller = new AbortController();
    const base = `/api/workspaces/${tenantId}/social/analytics`;
    const parts = rangeKey.split(":"), current = { from: parts[0], to: parts[1] };
    const url = (window: { from: string; to: string }, metric: SeriesMetric) => `${base}?${analyticsQuery(window, timezone, scope, metric)}`;
    const key = `${rangeKey}|${scopeKey}|${timezone}`;

    async function load(background: boolean) {
      controller.abort(); controller = new AbortController();
      const { signal } = controller;
      if (!background) setData((state) => ({ ...state, status: state.report ? state.status : "loading", reloading: !!state.report }));
      try {
        const known = etag.current?.key === key ? etag.current.value : undefined;
        const first = await get<AnalyticsReport>(url(current, "engagement"), signal, background ? known : undefined);
        if (cancelled) return;
        if (first.status === 304) { schedule(first.retryAfter); return; }
        const report = first.body!;
        etag.current = { key, value: first.etag ?? report.etag ?? "" };
        const exposure = report.summary.exposure.metric;
        const wanted: SeriesMetric[] = ["published", exposure, "followerChange"];
        const [previous, ...others] = await Promise.all([
          get<AnalyticsReport>(url(previousRange(current.from, current.to), "published"), signal),
          ...wanted.map((metric) => get<AnalyticsReport>(url(current, metric), signal)),
        ]);
        if (cancelled) return;
        const series: Partial<Record<SeriesMetric, SeriesPoint[]>> = { engagement: report.series.points };
        wanted.forEach((metric, index) => { series[metric] = others[index].body!.series.points; });
        if (scope.kind === "all") accountsRef.current = report.accounts;
        else if (!accountsRef.current.length) accountsRef.current = report.accounts;
        setData({ status: "ready", reloading: false, report, previous: previous.body!.summary, series, accounts: accountsRef.current });
        schedule(first.retryAfter);
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        if (background) { schedule(null); return; }
        setData((state) => ({ ...state, status: error instanceof HttpError && error.status === 404 ? "unavailable" : "error", reloading: false }));
      }
    }
    function schedule(retryAfter: number | null) {
      clearTimeout(timer);
      timer = setTimeout(() => { if (document.hidden) return; void load(true); }, Math.max(pollMs, (retryAfter ?? 0) * 1000));
    }
    const onVisible = () => { if (!document.hidden && !cancelled) { clearTimeout(timer); schedule(null); } };
    document.addEventListener("visibilitychange", onVisible);
    void load(false);
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); document.removeEventListener("visibilitychange", onVisible); };
    // `scope` is a fresh object each render; scopeKey carries its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, rangeKey, timezone, scopeKey, version]);

  const retry = useCallback(() => { etag.current = null; setVersion((value) => value + 1); }, []);
  return { ...data, retry };
}

/** One published post's detail (opened from a ranked row); reads the same route family for the planner delivery. */
export function usePostDetail(tenantId: string, postId: string | null, range: { from: string; to: string }, timezone: string) {
  const key = postId ? `${tenantId}|${postId}|${range.from}|${range.to}|${timezone}` : "";
  const [result, setResult] = useState<{ key: string; status: "ready" | "unavailable" | "error"; detail: PostDetailReport | null } | null>(null);
  useEffect(() => {
    if (!postId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ from: range.from, to: range.to, timezone, metric: "engagement" });
    void get<PostDetailReport>(`/api/workspaces/${tenantId}/social/analytics/posts/${postId}?${query}`, controller.signal)
      .then((response) => setResult({ key, status: "ready", detail: response.body }))
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setResult({ key, status: error instanceof HttpError && error.status === 404 ? "unavailable" : "error", detail: null }); });
    return () => controller.abort();
  }, [tenantId, postId, range.from, range.to, timezone, key]);
  if (!postId) return { status: "idle" as const, detail: null };
  if (result?.key !== key) return { status: "loading" as const, detail: null };
  return { status: result.status, detail: result.detail };
}
