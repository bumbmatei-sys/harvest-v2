"use client";
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Film, ImagePlus, Pencil, UploadCloud, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { Attachment } from "@/lib/social/composer-state";
import { Attachment as AttachmentCard, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle } from "@/components/ui/attachment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { socialMediaMimes } from "@/lib/social/media";
import { cn } from "@/lib/utils";

const accept = socialMediaMimes.filter((mime) => !["application/x-subrip", "text/vtt", "text/plain", "application/zip"].includes(mime)).join(",");
const cardState = (item: Attachment) => item.phase === "ready" ? "done" : item.phase === "failed" || item.phase === "quarantined" ? "error" : item.phase === "verifying" ? "processing" : "uploading";

function Thumb({ item }: { item: Attachment }) {
  // eslint-disable-next-line @next/next/no-img-element -- a local blob preview, not an optimisable asset
  if (item.previewUrl && (item.kind === "image" || item.kind === "gif")) return <img src={item.previewUrl} alt="" className="size-full object-cover" />;
  if (item.previewUrl && item.kind === "video") return <video src={`${item.previewUrl}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" className="size-full object-cover" />;
  return item.kind === "video" ? <Film aria-hidden="true" /> : item.kind === "document" ? <FileText aria-hidden="true" /> : <ImagePlus aria-hidden="true" />;
}

/**
 * The attachments of a post as a strip of cards (kit Attachment): thumbnail, name, upload state, reorder, alt text and remove. Dragging a
 * card reorders it; the arrow buttons do the same from the keyboard. Files can be dropped anywhere on the strip or chosen with the picker.
 * Uploading is owned by the composer (it knows the tenant); this component only reports files and actions.
 */
export function MediaStrip({ attachments, onFiles, onMove, onRemove, onCancel, onAlt, disabled }: {
  attachments: readonly Attachment[]; onFiles: (files: File[]) => void; onMove: (from: number, to: number) => void; onRemove: (key: string) => void;
  onCancel: (key: string) => void; onAlt: (key: string, text: string) => void; disabled?: boolean;
}) {
  const t = useTranslations("SocialPublish.media"), format = useFormatter();
  const input = useRef<HTMLInputElement>(null), [over, setOver] = useState(false), [dragging, setDragging] = useState<number | null>(null);
  const bytes = (size: number) => size >= 1024 ** 3 ? `${format.number(size / 1024 ** 3, { maximumFractionDigits: 1 })} GB` : `${format.number(size / 1024 ** 2, { maximumFractionDigits: 1 })} MB`;
  const phaseText = (item: Attachment) => item.phase === "hashing" ? t("preparing", { percent: item.progress }) : item.phase === "uploading" ? t("uploading", { percent: item.progress })
    : item.phase === "verifying" ? t("verifying") : item.phase === "quarantined" ? t("quarantined") : item.phase === "failed" ? item.error ?? t("failed") : item.size ? bytes(item.size) : t(`kind.${item.kind}`);
  return <div className={cn("space-y-3 rounded-xl border border-dashed p-3 transition-colors", over && "border-primary bg-selected")} data-testid="media-dropzone"
    onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setOver(true); } }}
    onDragLeave={() => setOver(false)}
    onDrop={(event) => { setOver(false); if (event.dataTransfer.files.length) { event.preventDefault(); onFiles([...event.dataTransfer.files]); } }}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><UploadCloud className="size-4" aria-hidden="true" />{t("dropHint")}</p>
      <Button type="button" variant="outline" size="responsive" disabled={disabled} onClick={() => input.current?.click()}><ImagePlus aria-hidden="true" />{t("add")}</Button>
      <input ref={input} type="file" multiple accept={accept} className="sr-only" tabIndex={-1} aria-label={t("pickerLabel")} data-testid="media-input"
        onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; if (files.length) onFiles(files); }} />
    </div>
    {attachments.length > 0 && <ul className="m-0 flex list-none flex-wrap gap-3 p-0" aria-label={t("listLabel")}>
      {attachments.map((item, index) => <li key={item.key} className="min-w-0" draggable={item.phase === "ready"} data-testid="media-item"
        onDragStart={(event) => { setDragging(index); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.key); }}
        onDragEnd={() => setDragging(null)}
        onDragOver={(event) => { if (dragging !== null && !event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
        onDrop={(event) => { if (dragging !== null) { event.preventDefault(); event.stopPropagation(); if (dragging !== index) onMove(dragging, index); setDragging(null); } }}>
        <AttachmentCard orientation="vertical" state={cardState(item)} className={cn("w-36", dragging === index && "opacity-50")}>
          <AttachmentMedia variant="image" className="aspect-[4/3]"><Thumb item={item} /></AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle title={item.name}>{item.name}</AttachmentTitle>
            <AttachmentDescription>{phaseText(item)}</AttachmentDescription>
            {(item.phase === "hashing" || item.phase === "uploading") && <Progress value={item.progress} aria-label={t("progressLabel", { name: item.name })} className="mt-1 h-1.5" />}
          </AttachmentContent>
          <div className="flex w-full flex-wrap items-center justify-between gap-0.5 px-0.5 pb-0.5">
            {item.phase === "ready" ? <>
              <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("moveEarlier", { name: item.name })} disabled={index === 0} onClick={() => onMove(index, index - 1)}><ChevronLeft aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("moveLater", { name: item.name })} disabled={index === attachments.length - 1} onClick={() => onMove(index, index + 1)}><ChevronRight aria-hidden="true" /></Button>
              {(item.kind === "image" || item.kind === "gif") && <AltText item={item} onAlt={onAlt} />}
              <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("remove", { name: item.name })} onClick={() => onRemove(item.key)}><X aria-hidden="true" /></Button>
            </> : item.phase === "failed" || item.phase === "quarantined"
              ? <Button type="button" variant="ghost" size="responsive" className="w-full" onClick={() => onRemove(item.key)}><X aria-hidden="true" />{t("dismiss")}</Button>
              : <Button type="button" variant="ghost" size="responsive" className="w-full" onClick={() => onCancel(item.key)}><X aria-hidden="true" />{t("cancel")}</Button>}
          </div>
        </AttachmentCard>
      </li>)}
    </ul>}
  </div>;
}

function AltText({ item, onAlt }: { item: Attachment; onAlt: (key: string, text: string) => void }) {
  const t = useTranslations("SocialPublish.media");
  return <Popover><PopoverTrigger asChild>
    <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("altFor", { name: item.name })} className={cn(item.altText && "text-primary")}><Pencil aria-hidden="true" /></Button>
  </PopoverTrigger>
    <PopoverContent className="w-72 space-y-2">
      <label htmlFor={`alt-${item.key}`} className="text-sm font-medium">{t("altLabel")}</label>
      <Input id={`alt-${item.key}`} value={item.altText} maxLength={1000} onChange={(event) => onAlt(item.key, event.target.value)} className="min-h-11 lg:min-h-9" />
    </PopoverContent></Popover>;
}
