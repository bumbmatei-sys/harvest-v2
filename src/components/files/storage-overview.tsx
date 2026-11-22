/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/file-manager/components/storage-overview-card.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { byteSize, groupStats, harvestGroups, totalBytes, type HarvestFile, type HarvestGroup } from "@/lib/files-screen";

const tone: Record<HarvestGroup, string> = { images: "bg-chart-1", documents: "bg-chart-2", text: "bg-chart-3" };

/**
 * What the ministry's own uploads take up, from the files the list holds: no quota and no provider storage figures, because Harvest has neither to report.
 * The list holds the latest 100 uploads, so at that size the card says so instead of passing the total off as complete.
 */
export function StorageOverview({ files, limit }: { files: readonly HarvestFile[]; limit: number }) {
  const t = useTranslations("FilesScreen");
  const format = useFormatter();
  const total = totalBytes(files), stats = groupStats(files);
  const show = (bytes: number) => { const size = byteSize(bytes); return t("sizeValue", { value: format.number(size.value, size.unit === "B" ? "integer" : "fileSize"), unit: size.unit }); };
  return <Card data-testid="storage-overview">
    <CardHeader><CardTitle>{t("storage.title")}</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-2xl font-semibold tracking-tight tabular-nums" data-testid="storage-total">{t("storage.total", { size: show(total), count: files.length })}</p>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={t("storage.breakdown")}>
        {harvestGroups.map((group) => stats[group].size > 0 && <span key={group} className={tone[group]} style={{ width: `${(stats[group].size / total) * 100}%` }} />)}
      </div>
      <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {harvestGroups.map((group) => <li key={group} className="flex items-center gap-2 text-sm"><span className={`size-2 rounded-full ${tone[group]}`} aria-hidden="true" />{t(`groups.${group}`)}<span className="text-muted-foreground tabular-nums">{show(stats[group].size)}</span></li>)}
      </ul>
      {files.length >= limit && <p className="text-sm text-muted-foreground">{t("storage.limited", { count: limit })}</p>}
    </CardContent>
  </Card>;
}
