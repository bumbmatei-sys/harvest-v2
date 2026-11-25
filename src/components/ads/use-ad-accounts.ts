"use client";
import { useEffect, useMemo, useState } from "react";
import { adsApi } from "@/lib/ads/api";
import type { AdAccountView } from "@/lib/ads/view";

/** The ministry's ad accounts and the one in use (the first, unless another is chosen). */
export function useAdAccounts(tenantId: string) {
  const api = useMemo(() => adsApi(tenantId), [tenantId]);
  const [accounts, setAccounts] = useState<AdAccountView[]>([]), [chosen, setChosen] = useState<string | null>(null), [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    api.accounts(controller.signal).then((r) => { setAccounts(r.accounts); setStatus("ready"); }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus((error as { status?: number }).status === 404 ? "unavailable" : "error");
    });
    return () => controller.abort();
  }, [api]);
  const account = accounts.find((item) => item.id === chosen) ?? accounts[0] ?? null;
  return { api, accounts, account, select: setChosen, status };
}
