"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Merge } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RecordPicker } from "./record-picker";
import { useCrmRequest } from "./request";

type Preview = {
  kept: { id: string; name: string; version: number }; merged: { id: string; name: string; version: number };
  identifiers: { moved: { kind: string; value: string }[]; dropped: { kind: string; value: string }[] };
  links: number; consents: number; tasks: number; notes: number; deals: number; values: number; notesText: "copied" | "dropped" | "none";
};

/**
 * Explicit merge (owners and admins): pick the duplicate, read exactly what moves to this person,
 * then confirm. Nothing merges from a suggestion alone, and the merged person is erased.
 */
export function MergeDialog({ tenantId, contactId, contactName, preset = null, compact = false }: {
  tenantId: string; contactId: string; contactName: string; preset?: { id: string; name: string } | null; compact?: boolean;
}) {
  const t = useTranslations("Merge");
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const [open, setOpen] = useState(false), [preview, setPreview] = useState<Preview | null>(null), [loading, setLoading] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const endpoint = `/api/workspaces/${tenantId}/contacts/${contactId}/merge`;
  async function load(sourceId: string) {
    setLoading(true); setError(""); setPreview(null);
    const result = await crmRequest<Preview>(`${endpoint}?sourceId=${encodeURIComponent(sourceId)}`, { method: "GET" });
    setLoading(false);
    if (result.ok) setPreview(result.data); else setError(result.error);
  }
  function change(value: boolean) {
    if (busy) return;
    setOpen(value); setError(""); setPreview(null);
    if (value && preset) void load(preset.id);
  }
  async function confirm() {
    if (!preview) return;
    setBusy(true); setError("");
    const result = await crmRequest(endpoint, { method: "POST", body: { sourceId: preview.merged.id, targetVersion: preview.kept.version, sourceVersion: preview.merged.version } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setOpen(false); router.refresh();
  }
  const counts = preview ? (["links", "consents", "tasks", "notes", "deals", "values"] as const).filter((key) => preview[key] > 0) : [];
  return <Dialog open={open} onOpenChange={change}>
    <DialogTrigger asChild>{compact
      ? <Button type="button" size="sm" variant="outline" className="h-7" aria-label={t("mergeNamed", { name: preset?.name ?? "" })}><Merge aria-hidden="true" />{t("suggestion")}</Button>
      : <Button type="button" variant="outline"><Merge aria-hidden="true" />{t("merge")}</Button>}</DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[520px]">
      <DialogHeader><DialogTitle>{t("title", { name: contactName })}</DialogTitle><DialogDescription>{t("description")}</DialogDescription></DialogHeader>
      <div className="space-y-4 text-sm">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <RecordPicker endpoint={`/api/workspaces/${tenantId}/contacts`} toItem={(row) => ({ id: String(row.id), label: String(row.name) })} exclude={[contactId]}
          title={t("choose")} placeholder={t("searchPeople")} emptyLabel={t("noPeopleFound")}
          trigger={<Button type="button" variant="outline" size="sm">{preview ? t("change") : t("choose")}</Button>}
          onSelect={(item) => { void load(item.id); }} />
        {loading && <p className="text-muted-foreground" aria-live="polite">{t("loading")}</p>}
        {preview && <div className="space-y-3" aria-live="polite">
          <ul className="space-y-1"><li className="font-medium">{t("keeps", { name: preview.kept.name })}</li><li className="text-muted-foreground">{t("removes", { name: preview.merged.name })}</li></ul>
          <div><p className="mb-1 font-medium">{t("moves", { name: preview.kept.name })}</p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {preview.identifiers.moved.length > 0 && <li>{t("identifiersMoved", { count: preview.identifiers.moved.length, values: preview.identifiers.moved.map((item) => item.value).join(", ") })}</li>}
              {counts.map((key) => <li key={key}>{t(key, { count: preview[key] })}</li>)}
              {preview.notesText === "copied" && <li>{t("notesCopied")}</li>}
              {!preview.identifiers.moved.length && !counts.length && preview.notesText !== "copied" && <li>{t("nothingElse")}</li>}
            </ul></div>
          {preview.identifiers.dropped.length > 0 && <p className="text-muted-foreground">{t("identifiersDropped", { values: preview.identifiers.dropped.map((item) => item.value).join(", ") })}</p>}
          {preview.notesText === "dropped" && <p className="text-muted-foreground">{t("notesDropped")}</p>}
          <Alert><AlertDescription>{t("irreversible")}</AlertDescription></Alert>
        </div>}
      </div>
      <DialogFooter><DialogClose asChild><Button type="button" variant="ghost" disabled={busy}>{t("cancel")}</Button></DialogClose>
        <Button type="button" variant="destructive" disabled={!preview || busy} onClick={() => void confirm()}>{busy ? t("merging") : t("confirm")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
