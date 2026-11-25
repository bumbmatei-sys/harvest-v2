"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adsApi, AdsApiError } from "@/lib/ads/api";
import { socialApi } from "@/lib/social/api";
import type { AdAccountView, AdsAlert, ResultsRow, TreeCampaign } from "@/lib/ads/view";

export type AdsManagerData = {
  status: "loading" | "ready" | "unavailable" | "error";
  accounts: AdAccountView[]; account: AdAccountView | null; selectAccount: (id: string) => void;
  tree: TreeCampaign[]; results: ResultsRow[]; alerts: AdsAlert[]; truncated: boolean;
  /** True while a reload runs over data already on screen. */
  reloading: boolean;
  /** Runs an action, then reloads the tree, the results and the alerts. A refused action keeps what is on screen and rethrows. */
  mutate: <T>(action: () => Promise<T>) => Promise<T>;
  reload: () => void;
  /** Reads the provider again (health, campaign tree, results for the range) and reloads. */
  refresh: () => Promise<{ ok: boolean }>;
  /** Links the ad accounts reachable through the ministry's connected social accounts. */
  findAccounts: () => Promise<{ connections: number; linked: number }>;
  api: ReturnType<typeof adsApi>;
};

/** Loads the ad accounts, then the tree, the three result levels and the open alerts of the chosen account for the chosen range. */
export function useAdsManager(tenantId: string, range: { from: string; to: string }): AdsManagerData {
  const api = useMemo(() => adsApi(tenantId), [tenantId]);
  const [accounts, setAccounts] = useState<AdAccountView[]>([]), [accountId, setAccountId] = useState<string | null>(null);
  const [status, setStatus] = useState<AdsManagerData["status"]>("loading"), [reloading, setReloading] = useState(false);
  const [tree, setTree] = useState<TreeCampaign[]>([]), [results, setResults] = useState<ResultsRow[]>([]), [alerts, setAlerts] = useState<AdsAlert[]>([]), [truncated, setTruncated] = useState(false);
  const [version, setVersion] = useState(0);
  const first = useRef(true);
  const account = accounts.find((item) => item.id === accountId) ?? null;

  const fail = useCallback((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(error instanceof AdsApiError && error.unavailable ? "unavailable" : "error"); }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const { accounts: list } = await api.accounts(controller.signal);
        setAccounts(list); setAccountId((current) => current && list.some((item) => item.id === current) ? current : list[0]?.id ?? null);
        if (!list.length) setStatus("ready");
      } catch (error) { fail(error); }
    })();
    return () => controller.abort();
  }, [api, fail]);

  const from = range.from, to = range.to;
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController(), { signal } = controller;
    if (first.current) first.current = false; else setReloading(true);
    (async () => {
      try {
        const [treeResult, campaign, adset, ad, alertResult] = await Promise.all([api.tree(accountId, signal), api.results(accountId, "campaign", from, to, signal), api.results(accountId, "adset", from, to, signal),
          api.results(accountId, "ad", from, to, signal), api.alerts(signal)]);
        if (signal.aborted) return;
        setTree(treeResult.campaigns); setResults([...campaign.rows, ...adset.rows, ...ad.rows]); setTruncated(campaign.truncated || adset.truncated || ad.truncated);
        setAlerts(alertResult.alerts.filter((item) => item.adAccountId === accountId)); setStatus("ready");
      } catch (error) { fail(error); } finally { if (!signal.aborted) setReloading(false); }
    })();
    return () => controller.abort();
  }, [api, accountId, from, to, version, fail]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const mutate = useCallback(async <T,>(action: () => Promise<T>) => { try { return await action(); } finally { setVersion((value) => value + 1); } }, []);
  const refresh = useCallback(async () => {
    if (!account) return { ok: false };
    try {
      const start = new Date(Date.now() - 89 * 86_400_000).toISOString().slice(0, 10);
      await api.health(account.id).catch(() => undefined);
      const synced = await api.sync(account.id);
      await api.syncResults(account.id, range.from < start ? start : range.from, range.to);
      const { accounts: list } = await api.accounts(); setAccounts(list); reload();
      return { ok: synced.synced };
    } catch { return { ok: false }; }
  }, [account, api, range.from, range.to, reload]);
  const findAccounts = useCallback(async () => {
    const { connections } = await socialApi(tenantId).connections();
    const active = connections.filter((item) => item.status === "active");
    let linked = 0;
    for (const item of active) { try { linked += (await api.link(item.id)).accounts.length; } catch { /* a connection without an ads connection is skipped */ } }
    const { accounts: list } = await api.accounts(); setAccounts(list); setAccountId((current) => current ?? list[0]?.id ?? null); setStatus("ready"); reload();
    return { connections: active.length, linked };
  }, [api, reload, tenantId]);

  return { status, accounts, account, selectAccount: setAccountId, tree, results, alerts, truncated, reloading, mutate, reload, refresh, findAccounts, api };
}
