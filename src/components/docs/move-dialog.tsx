"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Folder, Home } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import type { FolderLike } from "@/lib/docs-list";

type Props = {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; folders: readonly FolderLike[]; current: string | null; disabledIds?: readonly string[];
  onMove: (folderId: string | null) => Promise<string | void>;
};
function MoveBody({ onOpenChange, folders, current, disabledIds = [], onMove, busy, setBusy }: Omit<Props, "open" | "title"> & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const t = useTranslations("Docs");
  const [target, setTarget] = useState<string>(current ?? "root"), [error, setError] = useState("");
  // Depth-first order, names sorted inside each level.
  const rows: { folder: FolderLike; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => { for (const f of folders.filter((x) => x.parentId === parent).sort((a, b) => a.name.localeCompare(b.name))) { rows.push({ folder: f, depth }); walk(f.id, depth + 1); } };
  walk(null, 0);
  async function submit() {
    setBusy(true); setError("");
    const result = await onMove(target === "root" ? null : target);
    setBusy(false);
    if (typeof result === "string" && result) setError(result); else onOpenChange(false);
  }
  const unchanged = target === (current ?? "root");
  return <>
      <RadioGroup value={target} onValueChange={setTarget} aria-label={t("moveDestination")} className="gap-1">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-accent"><RadioGroupItem value="root" /><Home className="size-4 text-muted-foreground" aria-hidden="true" />{t("topLevel")}</label>
        {rows.map(({ folder, depth }) => {
          const disabled = disabledIds.includes(folder.id);
          return <label key={folder.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50" aria-disabled={disabled} style={{ paddingInlineStart: `${0.5 + depth * 1.25}rem` }}>
            <RadioGroupItem value={folder.id} disabled={disabled} /><Folder className="size-4 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 truncate">{folder.name}</span></label>;
        })}
      </RadioGroup>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)} disabled={busy}>{t("cancel")}</Button>
        <Button type="button" className="min-h-11" disabled={busy || unchanged} onClick={() => void submit()}>{busy && <Spinner />}{t("move")}</Button>
      </DialogFooter>
  </>;
}
/** Pick the destination of a doc or folder: the top level or any folder (folders inside the moved folder are not offered). The list is mounted only while open, so it starts at the current place. */
export function MoveDialog({ open, onOpenChange, title, ...body }: Props) {
  const [busy, setBusy] = useState(false);
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <MoveBody onOpenChange={onOpenChange} busy={busy} setBusy={setBusy} {...body} />
    </DialogContent>
  </Dialog>;
}
