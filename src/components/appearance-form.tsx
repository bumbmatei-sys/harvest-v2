"use client";
import { useTranslations } from "next-intl";
import type { BrandTheme } from "@/lib/theme";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ThemePreviews } from "@/components/theme-preview";

/** One visual baseline today; persisted legacy IDs remain accepted by the existing API. */
export function AppearanceForm({ current, writable }: { tenantId: string; current: BrandTheme; writable: boolean }) {
  const t = useTranslations("ComponentsAppearanceForm");
  return <div className="space-y-4">
    <p className="font-medium">{t("studioAdmin")}</p>
    <ThemePreviews brand={current} />
    <p className="text-sm text-muted-foreground">{t("baselineHelp")}</p>
    {!writable && <Alert><AlertDescription>{t("managedByAdmins")}</AlertDescription></Alert>}
  </div>;
}
