"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useRecord } from "./record-context";

/** Shown when a save was rejected because someone else changed the record first. */
export function StaleNotice() {
  const t = useTranslations("Crm");
  const router = useRouter();
  const { stale } = useRecord();
  if (!stale) return null;
  return <Alert><RefreshCw aria-hidden="true" /><AlertTitle>{t("someoneElseChangedThisRecord")}</AlertTitle>
    <AlertDescription className="gap-2">{t("reloadToSeeTheLatestVersion")}<Button size="sm" variant="outline" onClick={() => router.refresh()}>{t("reload")}</Button></AlertDescription></Alert>;
}
