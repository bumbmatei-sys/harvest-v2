"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { File as FileIcon, ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRequest } from "@/hooks/use-request";

type FileRow = { id: string; name: string; mime: string; size: number; status: string };
/** Files already uploaded to the ministry's Harvest Storage (ready ones only). Used to attach a file to a doc and to choose a cover image. */
export function FilePicker({ open, onOpenChange, tenantId, title, imagesOnly = false, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; tenantId: string; title: string; imagesOnly?: boolean; onPick: (file: FileRow) => Promise<string | void> | void }) {
  const t = useTranslations("Docs"), request = useRequest();
  const [rows, setRows] = useState<FileRow[] | null>(null), [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    request<FileRow[]>(`/api/workspaces/${tenantId}/files`, { method: "GET" }).then((r) => { if (!live) return; if (r.ok) setRows(r.data.filter((f) => f.status === "ready" && (!imagesOnly || f.mime.startsWith("image/")))); else { setError(r.error); setRows([]); } });
    return () => { live = false; setRows(null); };
  }, [open, request, tenantId, imagesOnly]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md" aria-describedby={undefined}>
    <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {rows === null ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : rows.length === 0
      ? <div className="space-y-2 text-sm text-muted-foreground"><p>{imagesOnly ? t("noImages") : t("noFiles")}</p><Link href={`/workspaces/${tenantId}/files`} className="inline-flex min-h-11 items-center text-foreground underline underline-offset-2">{t("openStorage")}</Link></div>
      : <ul className="space-y-1">{rows.map((f) => <li key={f.id}><button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-start text-sm hover:bg-accent" onClick={async () => { const e = await onPick(f); if (typeof e === "string" && e) setError(e); else onOpenChange(false); }}>
        {f.mime.startsWith("image/") ? <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}<span className="min-w-0 truncate">{f.name}</span></button></li>)}</ul>}
  </DialogContent></Dialog>;
}
