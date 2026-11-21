"use client";
import { useEffect, useMemo, useState } from "react";
import { socialApi, type PlannerItem } from "@/lib/social/api";
import { browserTimeZone } from "@/lib/social/time";

/** The account's planned and published posts a comment rule can be bound to (the planner's delivery records, the same ones the composer creates). */
export function usePostChoices(tenantId: string, connectionId: string, enabled: boolean) {
  const api = useMemo(() => socialApi(tenantId), [tenantId]);
  const [state, setState] = useState<{ key: string; items: PlannerItem[]; failed: boolean }>({ key: "", items: [], failed: false });
  const key = `${connectionId}|${enabled}`;
  useEffect(() => {
    if (!enabled || !connectionId) return;
    const controller = new AbortController(), day = 86_400_000, now = Date.now();
    void (async () => {
      try {
        const items: PlannerItem[] = [];
        for (const status of ["scheduled", "queued", "publishing", "published"]) {
          const page = await api.planner({ from: new Date(now - 180 * day).toISOString(), to: new Date(now + 180 * day).toISOString(), timezone: browserTimeZone(), status, connectionId, limit: "100" }, controller.signal);
          items.push(...Object.values(page.days).flat());
        }
        if (!controller.signal.aborted) setState({ key, items: items.sort((a, b) => b.at.localeCompare(a.at)), failed: false });
      } catch { if (!controller.signal.aborted) setState({ key, items: [], failed: true }); }
    })();
    return () => controller.abort();
  }, [api, connectionId, enabled, key]);
  const ready = state.key === key;
  return { items: ready ? state.items : [], loading: enabled && !!connectionId && !ready, failed: ready && state.failed };
}
