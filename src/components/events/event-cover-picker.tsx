/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/pos-system/components/add-product-dialog.tsx; code written for Harvest, no kit code copied. */
/* eslint-disable @next/next/no-img-element -- the cover is a short-lived signed address from the server; not optimisable */
"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircleIcon, ImageIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useCrmRequest } from "@/components/crm/request";
import { notify } from "@/lib/toast";
import { coverAccept, coverMaxMb, coverFileProblem, confirmEventCover, statusProblem, uploadEventCover, type CoverPhase, type CoverProblem, type CoverUploadResult } from "@/lib/event-cover";
import { cn } from "@/lib/utils";

export type CoverChange = { coverFileId: string | null; version: number };
type Status =
  | { kind: "idle" }
  | { kind: "busy"; phase: CoverPhase; progress: number }
  | { kind: "scanning"; fileId: string }
  | { kind: "error"; problem: CoverProblem; retry: "upload" | "confirm" | "none"; fileId?: string };

/**
 * The cover image control of the event form: choose or drop an image, upload it with progress, wait for the server's check, then make it
 * the event's cover; replace and remove. Uploading and choosing a cover take effect at once (they are their own requests, not part of Save).
 * The picture shown comes from `url`, a short-lived signed address the server hands out; no storage address is ever built here.
 */
export function EventCoverPicker({ endpoint, saved, coverFileId, version, url, onUrlFailed, onChange, onBusyChange, disabled = false, copy }: {
  endpoint: string; saved: boolean; coverFileId: string | null; version: number; url: string | null; onUrlFailed: () => void;
  onChange: (change: CoverChange) => void; onBusyChange: (busy: boolean) => void; disabled?: boolean;
  /** Wording for another owner of a cover (the campaign wizard); the event's own text is the default. */
  copy?: Partial<Record<"label" | "alt" | "saveFirst" | "removeBody" | "stale", string>>;
}) {
  const t = useTranslations("Events.cover"), request = useCrmRequest();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dragging, setDragging] = useState(false), [confirmRemove, setConfirmRemove] = useState(false);
  const input = useRef<HTMLInputElement>(null), file = useRef<File | null>(null), abort = useRef<AbortController | null>(null);
  const busy = status.kind === "busy", locked = disabled || !saved || status.kind === "busy";
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => abort.current?.abort(), []);

  async function choose(result: CoverUploadResult) {
    if (!result.ok) { setStatus({ kind: "error", problem: result.problem, fileId: result.fileId, retry: result.problem === "interrupted" || result.problem === "failed" ? (result.fileId ? "confirm" : "upload") : "none" }); return; }
    if (result.state === "scanning") { setStatus({ kind: "scanning", fileId: result.fileId }); return; }
    const set = await request<CoverChange>(`${endpoint}/cover`, { method: "PUT", body: { fileId: result.fileId, version } });
    if (!set.ok) { setStatus({ kind: "error", problem: statusProblem(set.status), retry: "none" }); return; }
    setStatus({ kind: "idle" }); onChange(set.data); notify.success(t("saved"));
  }
  async function start(picked: File | undefined) {
    if (!picked || locked) return;
    const early = coverFileProblem(picked);
    if (early) { setStatus({ kind: "error", problem: early, retry: "none" }); return; }
    file.current = picked; abort.current = new AbortController();
    setStatus({ kind: "busy", phase: "preparing", progress: 0 });
    const result = await uploadEventCover(endpoint, picked, { signal: abort.current.signal,
      onPhase: (phase) => setStatus((previous) => previous.kind === "busy" ? { ...previous, phase } : previous),
      onProgress: (progress) => setStatus((previous) => previous.kind === "busy" ? { ...previous, progress } : previous) });
    if (abort.current.signal.aborted) { setStatus({ kind: "idle" }); return; }
    await choose(result);
  }
  async function check(fileId: string) {
    setStatus({ kind: "busy", phase: "verifying", progress: 100 });
    await choose(await confirmEventCover(endpoint, fileId));
  }
  async function remove() {
    const result = await request<CoverChange>(`${endpoint}/cover`, { method: "PUT", body: { fileId: null, version } });
    if (!result.ok) return result.error;
    setStatus({ kind: "idle" }); onChange(result.data); notify.success(t("removed"));
  }
  const pick = () => input.current?.click();
  const active = status.kind === "busy" ? status : null;

  return <Field>
    <FieldLabel htmlFor="event-cover-input">{copy?.label ?? t("label")}</FieldLabel>
    <div className="flex flex-col gap-3">
      <div data-testid="cover-zone" data-dragging={dragging || undefined} data-has-cover={Boolean(coverFileId && url) || undefined}
        onDragEnter={(event) => { event.preventDefault(); if (!locked) setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void start(event.dataTransfer.files?.[0]); }}
        className={cn("relative flex aspect-video w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-input p-4 transition-colors",
          "has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-[3px] has-[input:focus-visible]:ring-ring/50 data-[dragging=true]:bg-accent/50", locked && "opacity-80")}>
        <input ref={input} id="event-cover-input" type="file" accept={coverAccept} className="sr-only" disabled={locked} data-testid="cover-input"
          onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ""; void start(picked); }} />
        {coverFileId && url
          ? <img src={url} alt={copy?.alt ?? t("alt")} onError={onUrlFailed} className="absolute inset-0 size-full object-cover" data-testid="cover-image" />
          : <div className="flex flex-col items-center justify-center gap-1 px-4 text-center">
            <span className="mb-2 flex size-11 shrink-0 items-center justify-center rounded-full border bg-background" aria-hidden="true"><ImageIcon className="size-4 opacity-60" /></span>
            {saved ? <>
              <p className="text-sm font-medium">{t("drop")}</p>
              <p className="text-xs text-muted-foreground">{t("limits", { mb: coverMaxMb })}</p>
              <Button type="button" variant="outline" className="mt-3 min-h-11" disabled={locked} onClick={pick}><UploadIcon className="-ms-1 size-4 opacity-60" aria-hidden="true" />{t("select")}</Button>
            </> : <p className="text-sm text-muted-foreground">{copy?.saveFirst ?? t("saveFirst")}</p>}
          </div>}
      </div>

      {coverFileId && url && <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={pick}><UploadIcon aria-hidden="true" />{t("replace")}</Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={() => setConfirmRemove(true)}>{t("remove")}</Button>
      </div>}

      {active && <div className="space-y-2" role="status" data-testid="cover-progress">
        {active.phase === "uploading"
          ? <Progress value={active.progress} aria-label={t("progressLabel")} />
          : <div className="flex items-center gap-2 text-sm"><Spinner size="sm" decorative />{t(`phases.${active.phase}`)}</div>}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{active.phase === "uploading" ? t("phases.uploadingPercent", { percent: active.progress }) : t(`phases.${active.phase}`)}</span>
          {active.phase === "uploading" && <Button type="button" variant="outline" className="min-h-11" onClick={() => abort.current?.abort()}>{t("cancel")}</Button>}
        </div>
      </div>}

      {status.kind === "scanning" && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm" role="status" data-testid="cover-scanning">
        <span className="flex items-center gap-2"><Spinner size="sm" decorative />{t("scanning")}</span>
        <span className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void check(status.fileId)}>{t("checkAgain")}</Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => setStatus({ kind: "idle" })}>{t("dismiss")}</Button>
        </span>
      </div>}

      {status.kind === "error" && <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-destructive" role="alert" data-testid="cover-error">
        <span className="flex items-center gap-1.5"><AlertCircleIcon className="size-4 shrink-0" aria-hidden="true" />{status.problem === "stale" && copy?.stale ? copy.stale : t(`problems.${status.problem}`, { mb: coverMaxMb })}</span>
        <span className="flex flex-wrap gap-2">
          {status.problem === "stale" && <Button type="button" variant="outline" className="min-h-11" onClick={() => location.reload()}>{t("reload")}</Button>}
          {status.retry !== "none" && <Button type="button" variant="outline" className="min-h-11"
            onClick={() => status.retry === "confirm" && status.fileId ? void check(status.fileId) : file.current ? void start(file.current) : pick()}>{t("tryAgain")}</Button>}
          {status.retry === "none" && status.problem !== "stale" && <Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={pick}>{t("chooseAnother")}</Button>}
        </span>
      </div>}
    </div>
    <ConfirmDialog tone="destructive" open={confirmRemove} onOpenChange={setConfirmRemove} title={t("removeTitle")} description={copy?.removeBody ?? t("removeBody")} cancelLabel={t("keep")} confirmLabel={t("remove")} onConfirm={remove} />
  </Field>;
}
