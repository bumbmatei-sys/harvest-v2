/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/file-manager/components/table-recent-files.tsx and app/dashboard/(auth)/apps/file-manager/components/file-manager.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useFormatter, useTranslations } from "next-intl";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { defineStatusTones } from "@/lib/status-tone";
import { EntryIcon } from "@/components/files/entry-icon";
import { byteSize, glyphOf, type FileEntry } from "@/lib/files-screen";

const scanTone = defineStatusTones({ ready: "success", uploaded: "pending", pending: "pending", quarantined: "danger" });

/**
 * Files and folders as one table (cards below 768px). Harvest rows keep the existing actions and scan states exactly (download only when ready, the public link,
 * retry verification, quarantined files unavailable). Provider rows can only be opened (folders) or previewed (files): download, share, upload and delete are
 * hard-off on the server and have no control here. While `marked` is true each row names its source in the accessible name of the entry.
 */
export function FilesTable({ entries, marked, label, note, busyId, onOpenFolder, onHarvestAction, onPreview, state = "ready", empty, error, pagination, bordered = false }: {
  entries: readonly FileEntry[]; marked: boolean; label: string; note?: string; busyId: string | null;
  onOpenFolder: (entry: FileEntry) => void; onHarvestAction: (entry: FileEntry, action: "download" | "confirm") => void; onPreview: (entry: FileEntry) => void;
  state?: "ready" | "loading" | "error"; empty: React.ReactNode; error?: React.ReactNode; pagination?: React.ReactNode; bordered?: boolean;
}) {
  const t = useTranslations("FilesScreen");
  const h = useTranslations("ComponentsFilesFileList");
  const format = useFormatter();
  const columns: DataTableColumn[] = [
    { id: "name", header: t("columns.name"), card: "title", className: "min-w-0 whitespace-normal break-words" },
    ...(marked ? [{ id: "source", header: t("columns.source"), showFrom: "@lg" as const }] : []),
    { id: "size", header: t("columns.size"), showFrom: "@md" },
    ...(entries.some((entry) => entry.addedAt) ? [{ id: "added", header: t("columns.added"), showFrom: "@lg" as const }] : []),
    ...(entries.some((entry) => entry.harvest) ? [{ id: "status", header: t("columns.status") }] : []),
    { id: "actions", header: t("columns.actions"), srOnlyHeader: true, align: "end", card: "actions" },
  ];
  const rows: DataTableRow[] = entries.map((entry) => {
    const harvest = entry.harvest, isFolder = entry.kind === "folder", size = entry.size === null ? null : byteSize(entry.size);
    const name = marked ? t("entryIn", { kind: entry.kind, name: entry.name, source: entry.source.name }) : undefined;
    const body = <><EntryIcon glyph={glyphOf(entry)} source={marked ? entry.source : undefined} /><span className="min-w-0 break-words font-medium">{entry.name}</span></>;
    return { id: entry.key, label: entry.name, className: undefined, cells: {
      name: isFolder
        ? <button type="button" aria-label={name} onClick={() => onOpenFolder(entry)} data-testid="entry-folder" className="flex min-h-11 w-full items-center gap-3 rounded-md text-start outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-9">{body}</button>
        : marked ? <span role="img" aria-label={name} data-testid="entry-file" className="flex items-center gap-3">{body}</span>
        : <span data-testid="entry-file" className="flex items-center gap-3">{body}</span>,
      source: <span className="whitespace-nowrap text-muted-foreground">{entry.source.name}</span>,
      size: size ? <span className="whitespace-nowrap tabular-nums text-muted-foreground">{t("sizeValue", { value: format.number(size.value, size.unit === "B" ? "integer" : "fileSize"), unit: size.unit })}</span> : <span aria-hidden="true">{t("noValue")}</span>,
      added: entry.addedAt ? <time dateTime={entry.addedAt} className="whitespace-nowrap text-muted-foreground">{format.dateTime(new Date(entry.addedAt), "date")}</time> : <span aria-hidden="true">{t("noValue")}</span>,
      status: harvest ? <StatusBadge tone={scanTone(harvest.status)} label={h(`statusValues.${harvest.status}`)} /> : <span aria-hidden="true">{t("noValue")}</span>,
      actions: harvest ? <>
        {harvest.status === "ready" && <Button variant="outline" size="sm" disabled={busyId === harvest.id} onClick={() => onHarvestAction(entry, "download")} aria-label={h("downloadValue", { name: harvest.name })}>{h("download")}</Button>}
        {harvest.publicUrl && <Button asChild variant="outline" size="sm"><a href={harvest.publicUrl} aria-label={h("publicLinkForValue", { name: harvest.name })}>{h("publicLink")}</a></Button>}
        {harvest.status === "uploaded" && harvest.canConfirm && <Button variant="outline" size="sm" disabled={busyId === harvest.id} onClick={() => onHarvestAction(entry, "confirm")}>{h("retryVerification")}</Button>}
        {harvest.status === "quarantined" && <span className="text-xs text-muted-foreground">{h("unavailable")}</span>}
      </> : isFolder ? null
        : <Button variant="outline" size="sm" onClick={() => onPreview(entry)} aria-label={t("previewValue", { name: entry.name })}><Eye aria-hidden="true" />{t("preview")}</Button>,
    } };
  });
  return <DataTable label={label} note={note} columns={columns} rows={rows} state={state} bordered={bordered} empty={empty} error={error} pagination={pagination} loadingLabel={t("loading")} />;
}
