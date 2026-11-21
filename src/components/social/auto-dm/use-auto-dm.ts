"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SocialApiError } from "@/lib/social/api";
import { autoDmApi, type AutoDmAccountView, type AutoDmRuleView, type RuleReport } from "@/lib/social/auto-dm-api";
import { summarize, type Totals } from "@/lib/social/auto-dm-ui";
import { useTranslations } from "next-intl";

export type AutoDmData = {
  state: "loading" | "ready" | "unavailable" | "error";
  rules: AutoDmRuleView[]; accounts: AutoDmAccountView[];
  reload: () => void; replace: (rule: AutoDmRuleView) => void;
};
/** Rules and the Instagram and Facebook accounts for the Auto-DM screens. A 404 anywhere means the feature is not available to this person. */
export function useAutoDmData(tenantId: string): AutoDmData {
  const api = useMemo(() => autoDmApi(tenantId), [tenantId]);
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<Omit<AutoDmData, "reload" | "replace">>({ state: "loading", rules: [], accounts: [] });
  useEffect(() => {
    const controller = new AbortController();
    void api.list(controller.signal).then((response) => setData({ state: "ready", rules: response.rules, accounts: response.accounts.filter((account) => account.platform === "instagram" || account.platform === "facebook") }))
      .catch((error: unknown) => { if (!controller.signal.aborted) setData((current) => ({ ...current, state: error instanceof SocialApiError && error.unavailable ? "unavailable" : "error" })); });
    return () => controller.abort();
  }, [api, version]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const replace = useCallback((rule: AutoDmRuleView) => setData((current) => ({ ...current, rules: current.rules.some((item) => item.id === rule.id) ? current.rules.map((item) => item.id === rule.id ? rule : item) : [...current.rules, rule] })), []);
  return { ...data, reload, replace };
}

export type RuleStats = { state: "loading" | "ready" | "error"; totals: Totals; lastAt: string | null };
/** Counts and the last activity per rule, fetched with a small concurrency so a long list does not open a request per rule at once. */
export function useRuleStats(tenantId: string, rules: readonly AutoDmRuleView[], stamp: number): Record<string, RuleStats> {
  const api = useMemo(() => autoDmApi(tenantId), [tenantId]);
  const [stats, setStats] = useState<Record<string, RuleStats>>({});
  const key = rules.map((rule) => `${rule.id}:${rule.version}:${rule.enabled}`).join("|");
  useEffect(() => {
    const controller = new AbortController();
    const queue = key ? key.split("|").map((entry) => entry.split(":")[0]) : [];
    let next = 0;
    const worker = async () => {
      while (next < queue.length && !controller.signal.aborted) {
        const id = queue[next++];
        try {
          const report: RuleReport = await api.report(id, null, controller.signal);
          if (!controller.signal.aborted) setStats((current) => ({ ...current, [id]: { state: "ready", totals: summarize(report.counts), lastAt: report.activity[0]?.createdAt ?? null } }));
        } catch { if (!controller.signal.aborted) setStats((current) => ({ ...current, [id]: { state: "error", totals: summarize([]), lastAt: null } })); }
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]);
    return () => controller.abort();
  }, [api, key, stamp]);
  return stats;
}

/** Plain-language text for a server code (a rule combination, an account state, a stale record ...); an unknown code still reads as a sentence. */
export function useAutoDmReason() {
  const t = useTranslations("SocialAutoDm.reasons");
  return (error: unknown) => {
    if (error instanceof SocialApiError) {
      if (error.code && t.has(error.code)) return t(error.code);
      if (error.unavailable) return t("UNAVAILABLE");
      if (error.conflict) return t("STALE_VERSION");
      if (error.status === 400 || error.status === 422) return t("INVALID");
      if (error.status === 0) return t("NETWORK");
    }
    return t("UNKNOWN");
  };
}
