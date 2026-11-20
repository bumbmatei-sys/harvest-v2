"use client";
import { useState } from "react";
import { Film, FileText, ImageIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ConnectionView, DestinationPreview } from "@/lib/social/api";
import type { ComposerState } from "@/lib/social/composer-state";
import { destinationMedia, destinationText } from "@/lib/social/composer-state";
import { platformLabels } from "@/lib/social/labels";
import { RingMark } from "@/components/social/platform-ring";
import { useReason } from "@/components/social/use-reason";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

/** "Each platform" preview: one tab per selected account showing the text and media as it will be sent, with the server's errors and warnings. */
export function ComposerPreview({ state, connections, previews }: { state: ComposerState; connections: readonly ConnectionView[]; previews: readonly DestinationPreview[] }) {
  const t = useTranslations("SocialPublish.preview"), reason = useReason(), [picked, setPicked] = useState<string | null>(null);
  const selected = connections.filter((connection) => state.connectionIds.includes(connection.id));
  if (selected.length === 0) return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground" data-testid="preview-empty">{t("empty")}</p>;
  const current = selected.find((connection) => connection.id === picked) ?? selected[0], preview = previews.find((item) => item.account.id === current.id);
  const text = destinationText(state, current.platform), media = destinationMedia(state, current.platform);
  return <div className="space-y-3" data-testid="composer-preview">
    <div role="tablist" aria-label={t("tabs")} className="flex flex-wrap gap-1">
      {selected.map((connection) => <button key={connection.id} role="tab" type="button" aria-selected={connection.id === current.id} onClick={() => setPicked(connection.id)}
        className={cn("inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-9", connection.id === current.id ? "bg-muted font-medium" : "text-muted-foreground")}>
        <RingMark platform={connection.platform} active={false} size={24} className="[&>span]:size-4 [&>span]:text-[8px]" />{platformLabels[connection.platform]}</button>)}
    </div>
    <article role="tabpanel" aria-label={platformLabels[current.platform]} className="space-y-3 rounded-xl border bg-card p-4">
      <header className="flex items-center gap-2"><RingMark platform={current.platform} active={false} size={32} className="[&>span]:size-6 [&>span]:text-[10px]" />
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{current.displayName ?? platformLabels[current.platform]}</p><p className="text-xs text-muted-foreground">{t(state.type)}</p></div></header>
      {text ? <p className="whitespace-pre-wrap break-words text-sm" data-testid="preview-text">{text}</p> : <p className="text-sm text-muted-foreground">{t("noText")}</p>}
      {media.length > 0 && <ul className="m-0 grid list-none grid-cols-3 gap-1 p-0">{media.map((item) => <li key={item.key} className="relative aspect-square overflow-hidden rounded-md bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview */}
        {item.previewUrl && item.kind !== "video" && item.kind !== "document" ? <img src={item.previewUrl} alt={item.altText} className="size-full object-cover" />
          : item.previewUrl && item.kind === "video" ? <video src={`${item.previewUrl}#t=0.1`} muted playsInline preload="metadata" aria-label={item.name} className="size-full object-cover" />
          : <span className="flex size-full items-center justify-center text-muted-foreground">{item.kind === "video" ? <Film aria-hidden="true" /> : item.kind === "document" ? <FileText aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}</span>}
      </li>)}</ul>}
      {preview && <div className="space-y-1">
        {preview.errors.map((code) => <p key={code} className="text-xs font-medium text-destructive" role="status">{reason(code)}</p>)}
        {preview.warnings.map((code) => <p key={code} className="text-xs text-muted-foreground">{reason(code)}</p>)}
        {preview.errors.length === 0 && <StatusBadge tone="success" label={t("ready")} dot />}
      </div>}
    </article>
  </div>;
}
