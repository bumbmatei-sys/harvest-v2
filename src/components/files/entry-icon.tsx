/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/file-manager/components/table-recent-files.tsx and app/dashboard/(auth)/apps/file-manager/components/file-manager.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
import { File, FileText, Folder, ImageIcon } from "lucide-react";
import { SourceLogo } from "@/components/office/provider-logo";
import { cn } from "@/lib/utils";
import type { Glyph, Source } from "@/lib/files-screen";

const icons = { folder: Folder, image: ImageIcon, pdf: FileText, text: FileText, file: File } as const;

/**
 * The icon of a folder or file: a tinted tile with the type glyph. While more than one source is shown (`source` is passed) a very small source mark sits in the
 * bottom-right corner; the name of the source is then part of the accessible name of the row or card that holds the icon, so the icon itself stays decorative.
 */
export function EntryIcon({ glyph, source, size = "sm" }: { glyph: Glyph; source?: Source; size?: "sm" | "lg" }) {
  const Icon = icons[glyph];
  const large = size === "lg";
  return <span className={cn("relative inline-flex shrink-0", large ? "size-12" : "size-9")} data-entry-icon={glyph}>
    <span className={cn("flex size-full items-center justify-center rounded-lg", glyph === "folder" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
      <Icon className={cn(large ? "size-6" : "size-5", glyph === "folder" && "fill-primary/20")} aria-hidden="true" />
    </span>
    {source && <span data-source-mark={source.kind} className={cn("absolute -right-1 -bottom-1 flex items-center justify-center rounded-full bg-background ring-2 ring-background", large ? "size-[18px]" : "size-4")}>
      <SourceLogo source={source.kind} className={large ? "size-3.5" : "size-3"} />
    </span>}
  </span>;
}
