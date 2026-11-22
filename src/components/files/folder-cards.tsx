/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/file-manager/components/summary-cards.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { EntryIcon } from "@/components/files/entry-icon";
import { byteSize, glyphOf, type FileEntry } from "@/lib/files-screen";

export type FolderCard = FileEntry & { count?: number };

/** One card per folder, the row at the top of the Files screen. Folders with the same name in different sources are separate cards; marks show while more than one source is shown. */
export function FolderCards({ folders, marked, onOpen }: { folders: readonly FolderCard[]; marked: boolean; onOpen: (folder: FolderCard) => void }) {
  const t = useTranslations("FilesScreen");
  const format = useFormatter();
  return <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("folders")} data-testid="folder-cards">
    {folders.map((folder) => {
      const size = folder.size === null ? null : byteSize(folder.size);
      const meta = folder.count !== undefined
        ? [t("items", { count: folder.count }), size ? t("sizeValue", { value: format.number(size.value, size.unit === "B" ? "integer" : "fileSize"), unit: size.unit }) : null].filter(Boolean).join(" · ")
        : folder.source.name;
      return <li key={folder.key}>
        <button type="button" onClick={() => onOpen(folder)} data-testid="folder-card" data-source={folder.source.kind}
          aria-label={marked ? t("entryIn", { kind: "folder", name: folder.name, source: folder.source.name }) : undefined}
          className="group flex min-h-11 w-full items-center gap-3 rounded-xl border bg-card p-4 text-start text-card-foreground shadow-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <EntryIcon glyph={glyphOf(folder)} source={marked ? folder.source : undefined} size="lg" />
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{folder.name}</span><span className="block truncate text-sm text-muted-foreground">{meta}</span></span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden="true" />
        </button>
      </li>;
    })}
  </ul>;
}
