"use client";
import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { mediaKind } from "@/lib/social/media";
import { acceptsMime, PutError, uploadMedia } from "@/lib/social/media-upload";
import { socialUploadLimits } from "@/lib/social/upload-limits";

type Item = { key: string; name: string; ref?: string; progress: number; phase: "hashing" | "uploading" | "verifying" | "ready" | "failed"; previewUrl: string; error?: string };
export type MediaChange = { ref: string; name: string; previewUrl: string };

/**
 * Adds an image or a video to an ad through the same private upload the Planner uses (hashed, sent as signed parts, inspected and scanned on the server). A file is usable only when the
 * server reports it ready; the ad then carries its id. `kind` limits what the picker offers; `max` is how many it holds.
 */
export function AdMediaPicker({ tenantId, kind, max, value, previews, onAdd, onRemove, label }: {
  tenantId: string; kind: "image" | "video" | "any"; max: number; value: readonly { ref: string; name: string }[]; previews: Record<string, string>;
  onAdd: (media: MediaChange) => void; onRemove: (ref: string) => void; label: string;
}) {
  const t = useTranslations("Ads.wizard.media");
  const input = useRef<HTMLInputElement>(null), [items, setItems] = useState<Item[]>([]);
  const accepted = (mime: string) => acceptsMime(mime) && (kind === "any" ? ["image", "video"].includes(mediaKind(mime)) : mediaKind(mime) === kind);
  const patch = (key: string, next: Partial<Item>) => setItems((current) => current.map((item) => item.key === key ? { ...item, ...next } : item));
  const room = max - value.length - items.filter((item) => item.phase !== "failed").length;
  function add(files: File[]) {
    for (const file of files.slice(0, Math.max(room, 0))) {
      const key = crypto.randomUUID(), previewUrl = URL.createObjectURL(file);
      const refusal = !accepted(file.type) ? "typeNotAllowed" : file.size === 0 ? "empty" : file.size > socialUploadLimits.fileBytes ? "tooLarge" : null;
      if (refusal) { setItems((current) => [...current, { key, name: file.name, progress: 0, phase: "failed", previewUrl, error: t(refusal) }]); continue; }
      setItems((current) => [...current, { key, name: file.name, progress: 0, phase: "hashing", previewUrl }]);
      void uploadMedia(tenantId, file, { signal: new AbortController().signal, phase: (phase) => patch(key, { phase }), progress: (progress) => patch(key, { progress }) })
        .then((stored) => {
          if (stored.status !== "ready") { patch(key, { phase: "failed", error: t("notReady") }); return; }
          setItems((current) => current.filter((item) => item.key !== key));
          onAdd({ ref: stored.id, name: file.name, previewUrl });
        })
        .catch((cause: unknown) => patch(key, { phase: "failed", error: t(cause instanceof PutError && cause.code === "CONNECTION" ? "connection" : "failed") }));
    }
  }
  return <div className="flex flex-col gap-3">
    <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label={label} data-testid="ads-media-input" multiple={max > 1}
      accept={kind === "image" ? "image/jpeg,image/png,image/webp" : kind === "video" ? "video/mp4,video/quicktime,video/webm" : "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"}
      onChange={(event) => { add([...(event.target.files ?? [])]); event.target.value = ""; }} />
    <ul className="m-0 flex list-none flex-wrap gap-3 p-0" aria-label={label}>
      {value.map((media) => <li key={media.ref} className="flex w-44 flex-col gap-2 rounded-lg border p-2" data-testid="ads-media-item">
        {previews[media.ref] ? (kind === "video" ? <video src={`${previews[media.ref]}#t=0.1`} muted playsInline className="aspect-video w-full rounded-md object-cover" /> :
          // eslint-disable-next-line @next/next/no-img-element -- a local blob preview
          <img src={previews[media.ref]} alt="" className="aspect-video w-full rounded-md object-cover" />) : <span className="flex aspect-video w-full items-center justify-center rounded-md bg-muted text-muted-foreground"><ImagePlus aria-hidden="true" /></span>}
        <div className="flex items-center gap-1"><span className="min-w-0 flex-1 truncate text-xs" title={media.name}>{media.name}</span>
          <Button type="button" variant="ghost" size="icon" className="size-11 lg:size-8" aria-label={t("remove", { name: media.name })} onClick={() => onRemove(media.ref)}><X aria-hidden="true" /></Button></div>
      </li>)}
      {items.map((item) => <li key={item.key} className="flex w-44 flex-col gap-2 rounded-lg border p-2" role="status">
        <span className="truncate text-xs" title={item.name}>{item.name}</span>
        {item.phase === "failed" ? <><span className="text-xs text-destructive">{item.error}</span>
          <Button type="button" variant="ghost" size="responsive" onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}>{t("dismiss")}</Button></>
          : <><Progress value={item.progress} aria-label={t("uploading", { name: item.name })} /><span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" aria-hidden="true" />{item.phase === "verifying" ? t("verifying") : t("uploadingPercent", { percent: item.progress })}</span></>}
      </li>)}
    </ul>
    {room > 0 && <div><Button type="button" variant="outline" size="responsive" onClick={() => input.current?.click()}><ImagePlus aria-hidden="true" />{label}</Button></div>}
  </div>;
}
