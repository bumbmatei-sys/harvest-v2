"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { socialApi, SocialApiError, type ConnectionView, type DraftSummary, type Schedule } from "@/lib/social/api";

export type SocialData = {
  state: "loading" | "ready" | "unavailable" | "error";
  connections: ConnectionView[]; schedules: Schedule[]; defaultScheduleId: string | null; drafts: DraftSummary[];
  reload: () => void;
};
/** Connections, posting schedules and drafts for the screens' shared header. A 404 anywhere means the integration is not available to this person. */
export function useSocialData(tenantId: string): SocialData {
  const api = useMemo(() => socialApi(tenantId), [tenantId]);
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<Omit<SocialData, "reload">>({ state: "loading", connections: [], schedules: [], defaultScheduleId: null, drafts: [] });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [connections, schedules, drafts] = await Promise.all([api.connections(controller.signal), api.schedules(controller.signal), api.drafts(controller.signal)]);
        setData({ state: "ready", connections: connections.connections, schedules: schedules.schedules, defaultScheduleId: schedules.defaultScheduleId, drafts: drafts.drafts });
      } catch (error) {
        if (controller.signal.aborted) return;
        setData((current) => ({ ...current, state: error instanceof SocialApiError && error.unavailable ? "unavailable" : "error" }));
      }
    })();
    return () => controller.abort();
  }, [api, version]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { ...data, reload };
}
