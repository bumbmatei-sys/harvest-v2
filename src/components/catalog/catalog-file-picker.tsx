/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/pages/products/create/add-product-form.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, FileText, Paperclip, Plus, Trash2, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { useRequest } from "@/hooks/use-request";
import { FILE_MIME_TYPES, MAX_FILE_SIZE, uploadInput } from "@/lib/files";
import { PutError, putFile } from "@/lib/put-file";
import { fileSize, maxFiles, move, type CatalogFile } from "@/lib/catalog";
import type { StatusTone } from "@/lib/status-tone";

const statusTone: Record<CatalogFile["status"], StatusTone> = { ready: "success", pending: "pending", uploaded: "pending", quarantined: "danger" };
type Stage = "" | "preparing" | "uploading" | "verifying";

/**
 * The protected files of a download. Files are the ministry's private files from the shared file service (the same scan and storage as Files): only a
 * ready file can be published, and the server hands out a short-lived address per signed-in learner. The picker lists the private files, adds one from the
 * list or from a new upload (a signed slot, then the server verifies and scans), and orders and removes the chosen ones. The chosen ids are the caller's.
 */
export function CatalogFilePicker({ tenantId, value, onChange, files, onFiles, disabled }: { tenantId: string; value: string[]; onChange: (next: string[]) => void; files: CatalogFile[]; onFiles: (files: CatalogFile[]) => void; disabled: boolean }) {
  const t = useTranslations("Catalog.files"), format = useFormatter(), request = useRequest();
  const [stage, setStage] = useState<Stage>(""), [progress, setProgress] = useState(0), [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null), latest = useRef(value);
  useEffect(() => { latest.current = value; }, [value]);
  const base = `/api/workspaces/${tenantId}/files`, byId = new Map(files.map((file) => [file.id, file]));
  const chosen = value.map((id) => byId.get(id)).filter((file): file is CatalogFile => Boolean(file));
  const available = files.filter((file) => file.visibility === "private" && !value.includes(file.id));
  const size = (file: CatalogFile) => { const { value: amount, unit } = fileSize(file.size); return format.number(amount, { style: "unit", unit, unitDisplay: "short" }); };

  async function refresh() {
    const result = await request<CatalogFile[]>(base, { method: "GET" });
    if (result.ok) onFiles(result.data);
    return result.ok ? result.data : null;
  }
  async function upload(file: File) {
    setError("");
    if (!FILE_MIME_TYPES.includes(file.type as (typeof FILE_MIME_TYPES)[number]) || file.size < 1 || file.size > MAX_FILE_SIZE) { setError(t("problems.type")); return; }
    setStage("preparing"); setProgress(0);
    try {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const parsed = uploadInput.safeParse({ name: file.name, mime: file.type, size: file.size, checksum, visibility: "private" });
      if (!parsed.success) { setError(t("problems.type")); setStage(""); return; }
      const created = await request<{ file: CatalogFile; upload: { url: string; method: string; headers: Record<string, string> } }>(base, { method: "POST", body: parsed.data });
      if (!created.ok) { setError(created.error); setStage(""); return; }
      setStage("uploading");
      await putFile(file, created.data.upload, setProgress);
      setStage("verifying"); setProgress(100);
      const confirmed = await request<{ status: CatalogFile["status"] }>(`${base}/${created.data.file.id}/confirm`, { method: "POST" });
      if (!confirmed.ok) { setError(confirmed.error); await refresh(); return; }
      await refresh();
      if (confirmed.data.status === "ready") { if (latest.current.length < maxFiles) onChange([...latest.current, created.data.file.id]); }
      else setError(t(confirmed.data.status === "quarantined" ? "problems.rejected" : "problems.scanning"));
    } catch (failure) {
      setError(t(failure instanceof PutError && failure.code === "FAILED" ? "problems.failed" : "problems.interrupted"));
    } finally { setStage(""); if (input.current) input.current.value = ""; }
  }

  const busy = stage !== "";
  return <div className="space-y-5">
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <section aria-labelledby="catalog-files-chosen" className="space-y-3">
      <h3 id="catalog-files-chosen" className="text-base font-semibold">{t("chosen")}</h3>
      {chosen.length === 0
        ? <EmptyState icon={Paperclip} title={t("noneChosen")} size="compact" solid />
        : <ol aria-label={t("chosen")} className="divide-y rounded-lg border bg-card">
          {chosen.map((file, index) => <li key={file.id} className="flex flex-wrap items-center gap-3 p-3">
            <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{file.name}</span><span className="block text-xs text-muted-foreground">{size(file)}</span></span>
            <StatusBadge tone={statusTone[file.status]} label={t(`status.${file.status}`)} dot />
            <span className="flex items-center gap-1">
              <Button type="button" variant="outline" size="icon" className="size-11" disabled={disabled || index === 0} aria-label={t("moveUp", { name: file.name })} onClick={() => onChange(move(value, index, index - 1))}><ArrowUp aria-hidden="true" /></Button>
              <Button type="button" variant="outline" size="icon" className="size-11" disabled={disabled || index === chosen.length - 1} aria-label={t("moveDown", { name: file.name })} onClick={() => onChange(move(value, index, index + 1))}><ArrowDown aria-hidden="true" /></Button>
              <Button type="button" variant="outline" size="icon" className="size-11" disabled={disabled} aria-label={t("remove", { name: file.name })} onClick={() => onChange(value.filter((id) => id !== file.id))}><Trash2 aria-hidden="true" /></Button>
            </span>
          </li>)}
        </ol>}
    </section>
    {!disabled && <section aria-labelledby="catalog-files-library" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="catalog-files-library" className="text-base font-semibold">{t("library")}</h3>
        <Button type="button" variant="outline" className="min-h-11" disabled={busy || value.length >= maxFiles} onClick={() => input.current?.click()}>
          {busy ? <Spinner decorative size="sm" /> : <Upload aria-hidden="true" />}{t("upload")}</Button>
        <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label={t("chooseFile")} accept={FILE_MIME_TYPES.join(",")} disabled={busy}
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
      </div>
      {busy && <div role="status" className="space-y-2"><p className="text-sm text-muted-foreground">{t(`phase.${stage}`)}</p>{stage === "uploading" && <Progress value={progress} aria-label={t("phase.uploading")} />}</div>}
      {available.length === 0
        ? <EmptyState icon={FileText} title={t("libraryEmpty")} size="compact" />
        : <ul aria-label={t("library")} className="divide-y rounded-lg border bg-card">
          {available.map((file) => <li key={file.id} className="flex flex-wrap items-center gap-3 p-3">
            <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{file.name}</span><span className="block text-xs text-muted-foreground">{size(file)}</span></span>
            <StatusBadge tone={statusTone[file.status]} label={t(`status.${file.status}`)} dot />
            <Button type="button" variant="outline" className="min-h-11" disabled={value.length >= maxFiles || file.status === "quarantined"} aria-label={t("add", { name: file.name })} onClick={() => onChange([...value, file.id])}><Plus aria-hidden="true" />{t("addShort")}</Button>
          </li>)}
        </ul>}
    </section>}
  </div>;
}
