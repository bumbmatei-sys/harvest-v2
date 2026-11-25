/** Layout and behaviour modelled on Shadcn UI Kit item social-media-post1, approved by the founder 25 Nov 2026; code written for Harvest, no kit code copied. Notes: docs/ui-sources.md. */
"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Film, ImageIcon, MessageCircle, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Draft } from "@/lib/ads/create";

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return ""; } };

/** What the ad will look like in a feed, updated as the form changes. A plain stand-in for each network's real rendering: text, media, headline and button only. */
export function AdPreview({ draft, name, caption, previews }: { draft: Draft; name: string; caption: string | null; previews: Record<string, string> }) {
  const t = useTranslations("Ads.wizard.preview"), l = useTranslations("Ads");
  const [shown, setShown] = useState(0);
  const boost = draft.mode === "boost", carousel = draft.format === "carousel", at = carousel ? Math.min(shown, Math.max(draft.cards.length - 1, 0)) : 0;
  const first = carousel ? draft.cards[at]?.mediaRef : draft.mediaRefs[0]?.ref;
  const url = first ? previews[first] : undefined;
  const text = boost ? caption : draft.body.trim();
  const headline = carousel ? draft.cards[at]?.headline : draft.headline.trim();
  const showsMedia = !boost && (draft.format === "image" || draft.format === "video" || draft.format === "carousel");
  const Icon = draft.format === "video" ? Film : ImageIcon;
  return <Card className="gap-0 overflow-hidden py-0" data-testid="ad-preview" aria-label={t("label")}>
    <CardContent className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold" aria-hidden="true">{(name.trim()[0] ?? "A").toUpperCase()}</span>
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{name || t("account")}</p><p className="text-xs text-muted-foreground">{t("sponsored")}</p></div>
      </div>
      <p className="min-h-5 text-sm break-words whitespace-pre-wrap">{text || <span className="text-muted-foreground">{t("textPlaceholder")}</span>}</p>
    </CardContent>
    {showsMedia && <div className="relative flex aspect-video w-full items-center justify-center bg-muted text-muted-foreground" data-testid="ad-preview-media">
      {url ? (draft.format === "video" ? <video src={`${url}#t=0.1`} muted playsInline className="size-full object-cover" /> :
        // eslint-disable-next-line @next/next/no-img-element -- a local blob preview
        <img src={url} alt="" className="size-full object-cover" />) : <span className="flex flex-col items-center gap-1 text-xs"><Icon aria-hidden="true" />{l(`formats.${draft.format}`)}</span>}
      {carousel && draft.cards.length > 1 && <>
        <Button type="button" variant="secondary" size="icon" className="absolute left-2 size-11 rounded-full lg:size-8" disabled={at === 0} aria-label={t("previousCard")} onClick={() => setShown(at - 1)}><ChevronLeft aria-hidden="true" /></Button>
        <Button type="button" variant="secondary" size="icon" className="absolute right-2 size-11 rounded-full lg:size-8" disabled={at === draft.cards.length - 1} aria-label={t("nextCard")} onClick={() => setShown(at + 1)}><ChevronRight aria-hidden="true" /></Button>
        <span className="absolute bottom-2 rounded-full bg-background/80 px-2 py-0.5 text-xs text-foreground" data-testid="ad-preview-card">{t("cardOf", { n: at + 1, total: draft.cards.length })}</span></>}
    </div>}
    {boost && <div className="flex aspect-video w-full items-center justify-center bg-muted text-xs text-muted-foreground">{t("boostedPost")}</div>}
    <CardContent className="flex items-center gap-3 border-t p-4">
      <div className="min-w-0 flex-1">
        {!boost && draft.linkUrl && <p className="truncate text-xs text-muted-foreground">{hostOf(draft.linkUrl)}</p>}
        <p className="truncate text-sm font-semibold">{headline || (boost ? t("boostedPost") : t("headlinePlaceholder"))}</p>
      </div>
      {draft.format === "messaging" ? <Button type="button" size="responsive" variant="secondary" disabled><MessageCircle aria-hidden="true" />{t("cta.send_message")}</Button>
        : draft.format === "call" ? <Button type="button" size="responsive" variant="secondary" disabled><Phone aria-hidden="true" />{t("cta.call_now")}</Button>
        : <Button type="button" size="responsive" variant="secondary" disabled>{t(`cta.${draft.cta || "learn_more"}`)}</Button>}
    </CardContent>
  </Card>;
}
