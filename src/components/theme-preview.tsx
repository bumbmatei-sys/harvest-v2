"use client";
import { useTranslations } from "next-intl";
import type { BrandTheme } from "@/lib/theme";
import { COLOR_MODES } from "@/lib/theme-registry";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

/** Static examples: no portals, focus targets, storage writes or global theme changes. */
export function ThemePreviews({ brand }: { brand: BrandTheme }) {
  const t = useTranslations("AppearancePreview");
  return <div className="grid gap-4 sm:grid-cols-2">{COLOR_MODES.map(mode => <figure key={mode} aria-label={t(mode)} className="min-w-0 space-y-2">
    <div data-theme={mode} className={mode === "dark" ? "dark" : undefined}>
      <div data-theme-preview data-preview-brand={brand} data-preview-mode={mode} inert aria-hidden="true" className="theme-preview rounded-lg border border-border bg-background p-3 text-foreground">
        <Card className="gap-3 py-3"><CardHeader className="px-3"><CardTitle>{t("sampleTitle")}</CardTitle></CardHeader><CardContent className="space-y-3 px-3">
          <Badge variant="secondary">{t("sampleStatus")}</Badge>
          <Input value={t("sampleField")} readOnly tabIndex={-1} className="bg-background dark:bg-background" />
          <Button tabIndex={-1} className="w-full">{t("sampleAction")}</Button>
        </CardContent></Card>
      </div>
    </div><figcaption className="text-sm font-medium">{t(mode)}</figcaption>
  </figure>)}</div>;
}
