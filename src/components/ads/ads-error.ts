import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { AdsApiError } from "@/lib/ads/api";

/** Maps a failed Ads call to catalogue text; provider or database wording never reaches the screen. */
export function useAdsError() {
  const t = useTranslations("Ads.errors");
  return useCallback((error: unknown) => {
    if (!(error instanceof AdsApiError)) return t("generic");
    if (error.status === 0) return t("network");
    if (error.stale) return t("stale");
    if (error.unavailable) return t("unavailable");
    const code = error.code ?? "";
    if (code === "POLICY_REFUSED") return t("policy");
    if (code === "FORM_NOT_READY") return t("formNotReady");
    if (code.startsWith("PROVIDER_")) return t("provider");
    if (code === "ACCOUNT_NOT_ACTIVE") return t("accountInactive");
    if (code === "CONNECTION_INACTIVE") return t("connectionInactive");
    if (code === "ADS_INVALID_INPUT" || error.status === 422) return t("invalid");
    return t("generic");
  }, [t]);
}
