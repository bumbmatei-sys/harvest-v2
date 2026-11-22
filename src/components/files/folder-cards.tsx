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
      // The card is a stretched button: only the folder name is the button's content, so its accessible name (with the source while marks show) contains
      // all of its visible text; the meta line sits beside it in the card.
      return <li key={folder.key} data-testid="folder-card" data-source={folder.source.kind}
        className="group relative flex min-h-11 items-center gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors focus-within:ring-[3px] focus-within:ring-ring/50 hover:bg-accent">
        <EntryIcon glyph={glyphOf(folder)} source={marked ? folder.source : undefined} size="lg" />
        <span className="min-w-0 flex-1">
          <button type="button" onClick={() => onOpen(folder)} aria-label={marked ? t("entryIn", { kind: "folder", name: folder.name, source: folder.source.name }) : folder.name}
            className="block max-w-full truncate text-start font-medium outline-none after:absolute after:inset-0 after:rounded-xl">{folder.name}</button>
          <span className="block truncate text-sm text-muted-foreground">{meta}</span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden="true" />
      </li>;
    })}
  </ul>;
}
