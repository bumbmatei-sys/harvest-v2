"use client";
import { useTranslations } from "next-intl";
import { PermissionCard } from "@/components/permission-card";
import { Button } from "@/components/ui/button";

/** Synthetic fixtures only: sample strings, no records, no requests. */
export function PermissionExamples() {
  const t = useTranslations("UiShowcase.permission");
  return <ul aria-label={t("listLabel")} className="space-y-3" data-example-permission>
    <PermissionCard as="li" label={t("labelGranted")} status={{ tone: "success", label: t("granted") }} description={t("help")} meta={t("meta")}
      actions={<Button type="button" variant="outline" size="sm" className="min-h-11 lg:min-h-8" aria-label={t("actionLabel")}>{t("action")}</Button>} />
    <PermissionCard as="li" label={t("labelWithdrawn")} status={{ tone: "warning", label: t("withdrawn") }} meta={t("meta")} />
    <PermissionCard as="li" label={t("labelNone")} status={{ tone: "neutral", label: t("none") }} />
  </ul>;
}
