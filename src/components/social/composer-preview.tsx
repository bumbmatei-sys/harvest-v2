"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ConnectionView, DestinationPreview } from "@/lib/social/api";
import { destinationMedia, destinationText, ringFor, type ComposerState } from "@/lib/social/composer-state";
import { platformLabels } from "@/lib/social/labels";
import { MediaThumb } from "@/components/social/media-strip";
import { PlatformLogo } from "@/components/social/platform-logo";
import { useReason } from "@/components/social/use-reason";
import { StatusBadge } from "@/components/status-badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** The right column's preview: a tab per selected account (and All), the post as it will be sent with that account's counter, and the server's errors and warnings. */
export function ComposerPreview({ state, connections, previews }: { state: ComposerState; connections: readonly ConnectionView[]; previews: readonly DestinationPreview[] }) {
  const t = useTranslations("SocialPublish.preview"), reason = useReason(), [picked, setPicked] = useState("all");
  const selected = connections.filter((connection) => state.connectionIds.includes(connection.id));
  const current = selected.find((connection) => connection.id === picked) ?? null, platform = (current ?? selected[0])?.platform ?? null;
  const preview = current ? previews.find((item) => item.account.id === current.id) : undefined;
  const text = platform ? destinationText(state, platform) : state.content, media = platform ? destinationMedia(state, platform) : state.attachments.filter((item) => item.phase === "ready");
  const count = platform ? ringFor(state, platform) : null, author = (current ?? selected[0])?.displayName ?? t("you");
  return <section className="space-y-3 rounded-xl border bg-card p-3" data-testid="composer-preview" aria-label={t("title")}>
    {selected.length > 0 && <ToggleGroup type="single" value={current ? current.id : "all"} onValueChange={(value) => { if (value) setPicked(value); }} aria-label={t("tabs")} className="flex w-full flex-wrap justify-start gap-1 rounded-lg bg-muted p-1">
      <ToggleGroupItem value="all" className="min-h-11 flex-none px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm lg:min-h-8">{t("all")}</ToggleGroupItem>
      {selected.map((connection) => <ToggleGroupItem key={connection.id} value={connection.id} aria-label={platformLabels[connection.platform]} className="min-h-11 min-w-11 flex-none px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm lg:min-h-8 lg:min-w-8">
        <PlatformLogo platform={connection.platform} className="size-4" /></ToggleGroupItem>)}
    </ToggleGroup>}
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>{current ? t("previewOn", { platform: platformLabels[current.platform] }) : t("main")}</span>
      {count && <span data-testid="preview-count" className={count.limit !== null && count.used > count.limit ? "font-semibold text-destructive" : undefined}>{count.limit === null ? count.used : t(count.rule === "estimate" ? "countEstimate" : "count", { used: count.used, limit: count.limit })}</span>}
    </div>
    <article className="space-y-3 rounded-lg border p-3">
      <header className="flex items-center gap-2"><span className="inline-flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold" aria-hidden="true">{author.slice(0, 1).toUpperCase()}</span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{author}</p>{platform && <PlatformLogo platform={platform} className="size-4 text-muted-foreground" />}</header>
      {text ? <p className="whitespace-pre-wrap break-words text-sm" data-testid="preview-text">{text}</p> : <p className="text-sm text-muted-foreground" data-testid="preview-empty">{t("noText")}</p>}
      {media.length > 0 && <ul className="m-0 grid list-none grid-cols-3 gap-1 p-0">{media.map((item) => <li key={item.key} className="relative aspect-square overflow-hidden rounded-md bg-muted">
        <MediaThumb item={item} alt={item.altText} />
      </li>)}</ul>}
      {preview && <div className="space-y-1">
        {preview.errors.filter((code) => !code.startsWith("MEDIA_")).map((code) => <p key={code} className="text-xs font-medium text-destructive" role="status">{reason(code)}</p>)}
        {preview.warnings.map((code) => <p key={code} className="text-xs text-muted-foreground">{reason(code)}</p>)}
        {preview.errors.length === 0 && <StatusBadge tone="success" label={t("ready")} dot />}
      </div>}
    </article>
  </section>;
}
