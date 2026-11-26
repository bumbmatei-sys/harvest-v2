"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adsApi, AdsApiError } from "@/lib/ads/api";
import { budgetWindows, ruleFlags, type RuleFlag, type RuleRun, type RuleView } from "@/lib/ads/overview";
import { spendBy } from "@/lib/ads/overview";
import { previousRange, todayIn } from "@/lib/social/analytics-view";
import type { AdAccountView, AdsAlert, ResultsRow, TreeCampaign } from "@/lib/ads/view";

export type AdsOverviewData = {
  status: "loading" | "ready" | "unavailable" | "error"; reloading: boolean;
  accounts: AdAccountView[]; account: AdAccountView | null; selectAccount: (id: string) => void;
  tree: TreeCampaign[]; current: ResultsRow[]; previous: ResultsRow[]; alerts: AdsAlert[]; spent: Map<string, number>; flags: RuleFlag[]; truncated: boolean;
  /** The ad account's own day, which its results are stored in. */
  accountToday: string;
  reload: () => void;
  /** Runs an action, then reloads. A refused action rethrows. */
  mutate: <T>(action: () => Promise<T>) => Promise<T>;
  /** Asks the ad network for an account's health again and stores the answer. */
  checkHealth: (id: string) => Promise<void>;
  api: ReturnType<typeof adsApi>;
};

const maxDays = 366;
const clampStart = (start: string, today: string) => { const floor = new Date(Date.parse(`${today}T00:00:00Z`) - (maxDays - 1) * 86_400_000).toISOString().slice(0, 10); return start < floor ? floor : start; };

/**
 * The overview reads only stored records through the Ads routes: the accounts, the campaign tree, campaign results for the range and the period before it, open alerts,
 * spend that counts towards each budget, and recent rule flags. Nothing is computed that the server did not report.
 */
export function useAdsOverview(tenantId: string, range: { from: string; to: string }, browserZone: string): AdsOverviewData {
  const api = useMemo(() => adsApi(tenantId), [tenantId]);
  const [accounts, setAccounts] = useState<AdAccountView[]>([]), [accountId, setAccountId] = useState<string | null>(null);
  const [status, setStatus] = useState<AdsOverviewData["status"]>("loading"), [reloading, setReloading] = useState(false);
  const [tree, setTree] = useState<TreeCampaign[]>([]), [current, setCurrent] = useState<ResultsRow[]>([]), [previous, setPrevious] = useState<ResultsRow[]>([]), [alerts, setAlerts] = useState<AdsAlert[]>([]);
  const [spent, setSpent] = useState<Map<string, number>>(new Map()), [flags, setFlags] = useState<RuleFlag[]>([]), [truncated, setTruncated] = useState(false);
  const [version, setVersion] = useState(0), [accountsVersion, setAccountsVersion] = useState(0);
  const first = useRef(true);
  const account = accounts.find((item) => item.id === accountId) ?? null;
  const accountToday = todayIn(account?.timezone ?? browserZone);
  const fail = useCallback((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(error instanceof AdsApiError && error.unavailable ? "unavailable" : "error"); }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.accounts(controller.signal).then(({ accounts: list }) => {
      setAccounts(list); setAccountId((chosen) => chosen && list.some((item) => item.id === chosen) ? chosen : list[0]?.id ?? null);
      if (!list.length) setStatus("ready");
    }).catch(fail);
    return () => controller.abort();
  }, [api, fail, accountsVersion]);

  const { from, to } = range;
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController(), { signal } = controller, before = previousRange(from, to);
    if (first.current) first.current = false; else setReloading(true);
    (async () => {
      try {
        const [treeResult, now, then, alertResult, ruleResult] = await Promise.all([api.tree(accountId, signal), api.results(accountId, "campaign", from, to, signal),
          api.results(accountId, "campaign", before.from, before.to, signal), api.alerts(signal), api.rules(signal)]);
        // Budget use: spend from each budget's first counting day to the account's today, at the level that owns the budget.
        const windows = budgetWindows(treeResult.campaigns, accountToday);
        const start = clampStart([...windows.values()].reduce((min, day) => day < min ? day : min, accountToday), accountToday);
        const [campaignSpend, adsetSpend] = windows.size ? await Promise.all([api.results(accountId, "campaign", start, accountToday, signal), api.results(accountId, "adset", start, accountToday, signal)]) : [{ rows: [], truncated: false }, { rows: [], truncated: false }];
        const mine = ruleResult.rules.filter((rule) => rule.adAccountId === accountId);
        const runs = new Map<string, RuleRun[]>(await Promise.all(mine.map(async (rule) => [rule.id, (await api.ruleRuns(rule.id, signal)).runs] as const)));
        if (signal.aborted) return;
        setTree(treeResult.campaigns); setCurrent(now.rows); setPrevious(then.rows); setTruncated(now.truncated || then.truncated);
        setAlerts(alertResult.alerts.filter((item) => item.adAccountId === accountId));
        setSpent(spendBy([...campaignSpend.rows, ...adsetSpend.rows], (id) => windows.get(id) ?? null, accountToday));
        setFlags(ruleFlags(mine as RuleView[], runs, new Date()));
        setStatus("ready");
      } catch (error) { fail(error); } finally { if (!signal.aborted) setReloading(false); }
    })();
    return () => controller.abort();
  }, [api, accountId, from, to, accountToday, version, fail]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const mutate = useCallback(async <T,>(action: () => Promise<T>) => { try { return await action(); } finally { setVersion((value) => value + 1); } }, []);
  const checkHealth = useCallback(async (id: string) => { try { await api.health(id); } finally { setAccountsVersion((value) => value + 1); setVersion((value) => value + 1); } }, [api]);
  return { status, reloading, accounts, account, selectAccount: setAccountId, tree, current, previous, alerts, spent, flags, truncated, accountToday, reload, mutate, checkHealth, api };
}
