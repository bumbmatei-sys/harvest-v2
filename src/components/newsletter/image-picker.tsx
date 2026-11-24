/* eslint-disable @next/next/no-img-element -- public image addresses redirect to short-lived signed storage addresses; not optimisable */
"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircleIcon, ImageIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useCrmRequest } from "@/components/crm/request";
import { httpsUrl } from "@/lib/email/blocks";
import { newsletterImageAccept, newsletterImageMaxMb, newsletterImageMaxPixels } from "@/lib/email/image-limits";
import { confirmNewsletterImage, uploadNewsletterImage, type ImagePhase, type ImageProblem } from "@/lib/email/image-upload";
import { parseVideoLink } from "@/lib/email/video";
import { cn } from "@/lib/utils";

type Library = { id: string; name: string; path: string | null }[];
type Status = { kind: "idle" } | { kind: "busy"; phase: ImagePhase; progress: number } | { kind: "scanning"; fileId: string } | { kind: "error"; problem: ImageProblem; fileId?: string };

/**
 * One image control for every email picture (cover, image block, hero, image with text, video thumbnail): upload from the device,
 * pick a ministry image, or use a secure link; alt text is required unless the image is marked decorative. Uploaded images are used
 * only once the server's safety check has passed. Modelled on the event cover picker; no kit code.
 */
export function ImagePicker({ tenantId, id, label, fileId, url, urlKey = "imageUrl", alt, decorative, onChange, videoUrl, suggestions = false, requireAlt = true }: {
  tenantId: string; id: string; label: string; fileId?: string; url: string; urlKey?: string; alt: string; decorative?: boolean;
  onChange: (patch: Record<string, unknown>, key?: string) => void; videoUrl?: string; suggestions?: boolean; requireAlt?: boolean;
}) {
  const t = useTranslations("NewsletterCampaigns.images"), f = useTranslations("NewsletterCampaigns.fields"), request = useCrmRequest();
  const [status, setStatus] = useState<Status>({ kind: "idle" }), [dragging, setDragging] = useState(false), [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState<Library | null>(null), [suggesting, setSuggesting] = useState<"idle" | "busy" | "failed">("idle");
  const input = useRef<HTMLInputElement>(null), abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const busy = status.kind === "busy";
  const src = fileId ? `/api/files/public/${tenantId}/${fileId}` : httpsUrl(url);
  const chosen = Boolean(fileId || url);
  const altMissing = chosen && !decorative && !alt.trim() && (requireAlt || Boolean(fileId));
  const youtube = suggestions && !fileId && videoUrl ? parseVideoLink(videoUrl)?.kind === "youtube" : false;

  const choose = (next: string) => { setStatus({ kind: "idle" }); onChange({ fileId: next, [urlKey]: "" }); };
  async function start(file: File | undefined) {
    if (!file || busy) return;
    abort.current = new AbortController();
    setStatus({ kind: "busy", phase: "preparing", progress: 0 });
    const result = await uploadNewsletterImage(tenantId, file, { signal: abort.current.signal,
      onPhase: (phase) => setStatus((s) => s.kind === "busy" ? { ...s, phase } : s), onProgress: (progress) => setStatus((s) => s.kind === "busy" ? { ...s, progress } : s) });
    if (abort.current.signal.aborted) { setStatus({ kind: "idle" }); return; }
    if (!result.ok) setStatus({ kind: "error", problem: result.problem, fileId: result.fileId });
    else if (result.state === "scanning") setStatus({ kind: "scanning", fileId: result.fileId });
    else choose(result.fileId);
  }
  async function check(file: string) {
    setStatus({ kind: "busy", phase: "verifying", progress: 100 });
    const result = await confirmNewsletterImage(tenantId, file);
    if (!result.ok) setStatus({ kind: "error", problem: result.problem, fileId: result.fileId });
    else if (result.state === "scanning") setStatus({ kind: "scanning", fileId: result.fileId });
    else choose(result.fileId);
  }
  async function openLibrary() {
    setLibraryOpen(true);
    const result = await request<{ images: Library }>(`/api/workspaces/${tenantId}/newsletter/images`, { method: "GET" });
    setLibrary(result.ok ? result.data.images : []);
  }
  async function suggest() {
    if (!videoUrl) return;
    setSuggesting("busy");
    const result = await request<{ id: string; status: string }>(`/api/workspaces/${tenantId}/newsletter/images/suggest`, { method: "POST", body: { videoUrl } });
    if (result.ok && result.data.status === "ready") { setSuggesting("idle"); choose(result.data.id); } else setSuggesting("failed");
  }
  const invalidLink = url !== "" && !httpsUrl(url);
  const pick = () => input.current?.click();

  return <div className="space-y-3" data-image-picker={id}>
    <p className="text-sm font-medium" id={`${id}-label`}>{label}</p>
    <div data-testid="image-zone" data-dragging={dragging || undefined} role="group" aria-labelledby={`${id}-label`}
      onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); setDragging(false); void start(event.dataTransfer.files?.[0]); }}
      className={cn("relative flex min-h-36 w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-input p-4 transition-colors data-[dragging=true]:bg-accent/50",
        "has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-[3px] has-[input:focus-visible]:ring-ring/50")}>
      <input ref={input} id={`${id}-file`} type="file" accept={newsletterImageAccept} className="sr-only" disabled={busy} data-testid="image-input" aria-label={t("upload")}
        onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ""; void start(picked); }} />
      {src ? <img src={src} alt="" className="max-h-48 w-auto max-w-full rounded-md object-contain" data-testid="image-preview" />
        : <div className="flex flex-col items-center gap-1 text-center">
          <span className="mb-2 flex size-11 items-center justify-center rounded-full border bg-background" aria-hidden="true"><ImageIcon className="size-4 opacity-60" /></span>
          <p className="text-sm font-medium">{t("drop")}</p>
          <p className="text-xs text-muted-foreground">{t("limits", { mb: newsletterImageMaxMb, px: newsletterImageMaxPixels })}</p>
        </div>}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={pick}><UploadIcon aria-hidden="true" />{chosen ? t("replace") : t("upload")}</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void openLibrary()}>{t("library")}</Button>
      {chosen && <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => onChange({ fileId: undefined, [urlKey]: "" })}>{t("remove")}</Button>}
      {youtube && <Button type="button" variant="outline" className="min-h-11" disabled={suggesting === "busy"} onClick={() => void suggest()}>
        {suggesting === "busy" ? <Spinner size="sm" decorative /> : null}{suggesting === "busy" ? f("suggesting") : f("suggest")}</Button>}
    </div>
    {suggesting === "failed" && <p role="alert" className="text-sm text-destructive">{f("suggestFailed")}</p>}
    {!fileId && <div className="space-y-2"><Label htmlFor={`${id}-link`}>{t("link")}</Label>
      <Input id={`${id}-link`} className="min-h-11" inputMode="url" maxLength={2000} aria-invalid={invalidLink || undefined} value={url} onChange={(ev) => onChange({ [urlKey]: ev.target.value }, `${id}-url`)} />
      {invalidLink && <p className="text-sm text-destructive">{f("invalidLink")}</p>}</div>}

    {status.kind === "busy" && <div className="space-y-2" role="status" data-testid="image-progress">
      {status.phase === "uploading" ? <Progress value={status.progress} aria-label={t("progress")} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">{status.phase !== "uploading" && <Spinner size="sm" decorative />}{t(`phases.${status.phase}`, { percent: status.progress })}</span>
        {status.phase === "uploading" && <Button type="button" variant="outline" className="min-h-11" onClick={() => abort.current?.abort()}>{t("cancel")}</Button>}
      </div></div>}
    {status.kind === "scanning" && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm" role="status" data-testid="image-scanning">
      <span className="flex items-center gap-2"><Spinner size="sm" decorative />{t("scanning")}</span>
      <span className="flex gap-2"><Button type="button" variant="outline" className="min-h-11" onClick={() => void check(status.fileId)}>{t("checkAgain")}</Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => setStatus({ kind: "idle" })}>{t("dismiss")}</Button></span></div>}
    {status.kind === "error" && <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-destructive" role="alert" data-testid="image-error">
      <span className="flex items-center gap-1.5"><AlertCircleIcon className="size-4 shrink-0" aria-hidden="true" />{t(`problems.${status.problem}`, { mb: newsletterImageMaxMb, px: newsletterImageMaxPixels })}</span>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => status.fileId && (status.problem === "interrupted" || status.problem === "failed") ? void check(status.fileId) : pick()}>
        {status.problem === "interrupted" || status.problem === "failed" ? t("tryAgain") : t("chooseAnother")}</Button></div>}

    {chosen && <div className="space-y-2">
      <Label htmlFor={`${id}-alt`}>{t("altLabel")}</Label>
      <Input id={`${id}-alt`} className="min-h-11" maxLength={200} disabled={decorative} aria-invalid={altMissing || undefined} aria-describedby={altMissing ? `${id}-alt-error` : undefined}
        value={decorative ? "" : alt} onChange={(ev) => onChange({ alt: ev.target.value }, `${id}-alt`)} />
      {altMissing && <p id={`${id}-alt-error`} className="text-sm text-destructive">{f("altRequired")}</p>}
      <Label htmlFor={`${id}-decorative`} className="flex min-h-11 items-center gap-3 font-normal"><Switch id={`${id}-decorative`} checked={decorative === true} onCheckedChange={(v) => onChange(v ? { decorative: true, alt: "" } : { decorative: undefined })} />{f("decorative")}</Label>
    </div>}

    <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{t("libraryTitle")}</DialogTitle></DialogHeader>
      {library === null ? <div className="flex justify-center p-6"><Spinner size="lg" /></div> : library.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="library-empty">{t("none")}</p>
        : <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="image-library">{library.map((image) => <li key={image.id}>
          <button type="button" aria-label={t("use", { name: image.name })} onClick={() => { setLibraryOpen(false); choose(image.id); }}
            className="block min-h-11 w-full overflow-hidden rounded-lg border outline-none hover:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/50">
            {image.path ? <img src={image.path} alt="" className="aspect-video w-full object-cover" /> : null}
            <span className="block truncate p-2 text-left text-xs">{image.name}</span></button></li>)}</ul>}
    </DialogContent></Dialog>
  </div>;
}
