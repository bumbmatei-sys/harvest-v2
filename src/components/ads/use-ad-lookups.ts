"use client";
import { useEffect, useMemo, useState } from "react";
import { adsApi, type AudienceView, type BoostablePost, type LeadFormView } from "@/lib/ads/api";
import type { AdAccountView, TreeCampaign } from "@/lib/ads/view";

export type AdLookups = { adAccountId: string; accounts: AdAccountView[]; forms: LeadFormView[]; audiences: AudienceView[]; posts: BoostablePost[]; tree: TreeCampaign[]; status: "loading" | "ready" | "unavailable" | "error"; reloadForms: () => void };

/** The lists the create flow picks from: ad accounts, then (for the chosen account) lead forms, saved audiences, posts that can be boosted and the ad sets already there. */
export function useAdLookups(tenantId: string, chosen: string): AdLookups {
  const api = useMemo(() => adsApi(tenantId), [tenantId]);
  const [accounts, setAccounts] = useState<AdAccountView[]>([]), [status, setStatus] = useState<AdLookups["status"]>("loading");
  const [forms, setForms] = useState<LeadFormView[]>([]), [audiences, setAudiences] = useState<AudienceView[]>([]), [posts, setPosts] = useState<BoostablePost[]>([]), [tree, setTree] = useState<TreeCampaign[]>([]);
  const [version, setVersion] = useState(0);
  // The only ad account is chosen for you.
  const adAccountId = chosen || (accounts.length === 1 ? accounts[0].id : "");
  useEffect(() => {
    const controller = new AbortController();
    api.accounts(controller.signal).then((r) => { setAccounts(r.accounts); setStatus("ready"); }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus((error as { status?: number }).status === 404 ? "unavailable" : "error");
    });
    return () => controller.abort();
  }, [api]);
  useEffect(() => {
    if (!adAccountId) return;
    let cancelled = false;
    const quiet = <T,>(promise: Promise<T>, fallback: T) => promise.catch(() => fallback);
    void Promise.all([quiet(api.leadForms(adAccountId), { forms: [] }), quiet(api.audiences(adAccountId), { audiences: [] }), quiet(api.boostable(adAccountId), { posts: [] }), quiet(api.tree(adAccountId), { campaigns: [] })])
      .then(([f, a, p, t]) => { if (cancelled) return; setForms(f.forms.filter((form) => form.status === "active")); setAudiences(a.audiences); setPosts(p.posts); setTree(t.campaigns); });
    return () => { cancelled = true; };
  }, [api, adAccountId, version]);
  return { adAccountId, accounts, forms, audiences, posts, tree, status, reloadForms: () => setVersion((v) => v + 1) };
}
