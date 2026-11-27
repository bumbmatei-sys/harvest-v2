/** Derived from Shadcn UI Kit item customer-reviews9 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Link in bio rework). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Photo gallery: a grid of square thumbnails (three across, four on wide screens); a tap opens a full-screen viewer that swipes (embla-carousel, MIT) and
 * has previous and next buttons and the arrow keys. `src` turns a picture id into an address: the public redirect, or the owner's signed preview.
 */
export function BioGallery({ title, fileIds, src, preview }: { title: string; fileIds: string[]; src: (id: string) => string | null; preview: boolean }) {
  const t = useTranslations("LinkInBio.public");
  const [open, setOpen] = useState<number | null>(null);
  const label = title || t("galleryLabel");
  return <section aria-label={label} className="space-y-2" data-bio-gallery>
    {title && <h2 className="text-base font-semibold">{title}</h2>}
    <ul className="grid grid-cols-3 gap-2 @md:grid-cols-4">{fileIds.map((id, index) => { const url = src(id); return <li key={id}>
      <button type="button" tabIndex={preview ? -1 : undefined} onClick={() => { if (!preview) setOpen(index); }} aria-label={t("galleryOpen", { position: index + 1, count: fileIds.length })}
        className="relative block aspect-square w-full overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" data-bio-gallery-thumb>
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed redirect from the server, not optimisable */}
        {url && <img src={url} alt="" loading="lazy" className="size-full object-cover" />}
      </button></li>; })}</ul>
    {!preview && <Dialog open={open !== null} onOpenChange={(next) => { if (!next) setOpen(null); }}>
      <DialogContent className="flex h-[90dvh] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-0 border-0 bg-background/95 p-0 sm:max-w-4xl" data-bio-gallery-viewer>
        <DialogTitle className="sr-only">{label}</DialogTitle>
        <DialogDescription className="sr-only">{t("galleryHint")}</DialogDescription>
        {open !== null && <Viewer fileIds={fileIds} start={open} src={src} />}
      </DialogContent>
    </Dialog>}
  </section>;
}

function Viewer({ fileIds, start, src }: { fileIds: string[]; start: number; src: (id: string) => string | null }) {
  const t = useTranslations("LinkInBio.public");
  const [viewport, api] = useEmblaCarousel({ startIndex: start, duration: 22 });
  const [index, setIndex] = useState(start);
  useEffect(() => { if (!api) return; const select = () => setIndex(api.selectedScrollSnap()); api.on("select", select); return () => { api.off("select", select); }; }, [api]);
  const go = (by: number) => api?.scrollTo(Math.min(fileIds.length - 1, Math.max(0, index + by)), reducedMotion());
  // Arrow keys work wherever focus is inside the open viewer (a disabled end button drops focus to the dialog).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "ArrowLeft") api?.scrollPrev(reducedMotion()); if (event.key === "ArrowRight") api?.scrollNext(reducedMotion()); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);
  return <div className="flex min-h-0 flex-1 flex-col">
    <div ref={viewport} className="min-h-0 flex-1 overflow-hidden" data-bio-gallery-track>
      <div className="flex h-full">{fileIds.map((id, position) => { const url = src(id); return <div key={id} className="flex min-w-0 shrink-0 grow-0 basis-full items-center justify-center p-4"
        role="group" aria-roledescription="slide" aria-label={t("galleryPosition", { position: position + 1, count: fileIds.length })} aria-hidden={position !== index || undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed redirect from the server, not optimisable */}
        {url && <img src={url} alt={t("galleryPosition", { position: position + 1, count: fileIds.length })} className="max-h-full max-w-full rounded-md object-contain" />}
      </div>; })}</div>
    </div>
    <div className="flex items-center justify-between gap-2 border-t p-3">
      <Button type="button" variant="outline" size="icon" className="size-11" disabled={index === 0} aria-label={t("galleryPrevious")} onClick={() => go(-1)}><ChevronLeft aria-hidden="true" /></Button>
      <p className="text-sm text-muted-foreground" aria-live="polite" data-bio-gallery-counter>{t("galleryPosition", { position: index + 1, count: fileIds.length })}</p>
      <Button type="button" variant="outline" size="icon" className="size-11" disabled={index === fileIds.length - 1} aria-label={t("galleryNext")} onClick={() => go(1)}><ChevronRight aria-hidden="true" /></Button>
    </div>
  </div>;
}
