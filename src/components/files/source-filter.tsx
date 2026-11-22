"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SourceLogo } from "@/components/office/provider-logo";
import type { Selection, Source } from "@/lib/files-screen";

/** Chips for the sources the person can see: All, Harvest and each connected drive. Any one, any combination or all; an empty selection is All. Only connected sources are offered. */
export function SourceFilter({ sources, selection, onToggle, onAll }: { sources: readonly Source[]; selection: Selection; onToggle: (id: string) => void; onAll: () => void }) {
  const t = useTranslations("FilesScreen");
  return <div role="group" aria-label={t("sourceFilter")} className="flex flex-wrap items-center gap-2" data-testid="source-filter">
    <Button type="button" size="responsive" variant={selection.size === 0 ? "default" : "outline"} aria-pressed={selection.size === 0} onClick={onAll} data-testid="source-all">{t("allSources")}</Button>
    {sources.map((source) => <Button key={source.id} type="button" size="responsive" variant={selection.has(source.id) ? "default" : "outline"} aria-pressed={selection.has(source.id)} onClick={() => onToggle(source.id)} data-testid={`source-${source.kind}`}>
      <SourceLogo source={source.kind} />{source.name}
    </Button>)}
  </div>;
}
