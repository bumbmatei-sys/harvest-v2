"use client";
import { useId } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ConnectionView, DestinationPreview } from "@/lib/social/api";
import type { CharacterCount } from "@/lib/social/characters";
import { itemLimit, type Attachment, type DestinationOptions, type DestinationState } from "@/lib/social/composer-state";
import { joinParts } from "@/lib/social/join";
import { platformLabels } from "@/lib/social/labels";
import type { DraftType } from "@/lib/social/platforms";
import { CoverFramePicker } from "@/components/social/cover-frame-picker";
import { PlatformLogo } from "@/components/social/platform-logo";
import { useReason } from "@/components/social/use-reason";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

const requiresTitle = new Set(["youtube", "reddit", "pinterest"]);
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="space-y-2 border-t pt-3 first:border-t-0 first:pt-0"><p className="text-sm font-medium">{title}</p>{children}</div>;
}

/**
 * One row of the "Each platform" list: the platform, "Same as all" or "Custom", and its own counter ("About 33 of 280 characters"). Opening it shows the
 * platform's override panel: its own text, which attached files it takes and whether the platform accepts them (from the server's media rules), the
 * reel or short switch, the cover frame and the settings only this platform has. Counts come from the shared counter, passed in as `count`.
 */
export function DestinationCard({ connection, type, state, count, attachments, preview, open, onOpenChange, onChange }: {
  connection: ConnectionView; type: DraftType; state: DestinationState; count: CharacterCount; attachments: readonly Attachment[]; preview?: DestinationPreview;
  open: boolean; onOpenChange: (open: boolean) => void; onChange: (next: DestinationState) => void;
}) {
  const t = useTranslations("SocialPublish.destination"), reason = useReason(), id = useId();
  const platform = connection.platform, options = state.options, label = platformLabels[platform];
  const set = (patch: Partial<DestinationOptions>) => onChange({ ...state, options: { ...options, ...patch } });
  const ready = attachments.filter((item) => item.phase === "ready"), post = type === "post";
  const maxItems = itemLimit(connection, type, options.format);
  const reel = connection.mediaCapabilities.reel !== null, short = connection.mediaCapabilities.short !== null;
  const video = ready.find((item) => item.kind === "video"), frame = (options.format === "reel" ? connection.mediaCapabilities.reel : connection.mediaCapabilities.post)?.frame;
  const over = count.limit !== null && count.used > count.limit, errors = preview?.errors.filter((code) => !code.startsWith("MEDIA_") && !code.startsWith("ALT_")) ?? [];
  const counter = count.limit === null ? t("counterNone", { used: count.used }) : t(count.rule === "estimate" ? "counterEstimate" : "counter", { used: count.used, limit: count.limit });
  return <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-lg border bg-card" data-testid="destination-card" data-platform={platform}>
    <CollapsibleTrigger className="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <PlatformLogo platform={platform} className="size-4 shrink-0" />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{label}</span>
        <span className={cn("block truncate text-xs", over || errors.length ? "font-medium text-destructive" : "text-muted-foreground")}>{joinParts([state.custom ? t("custom") : t("same"), counter])}</span></span>
      <ChevronRight className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")} aria-hidden="true" />
    </CollapsibleTrigger>
    <CollapsibleContent className="space-y-3 px-3 pb-3">
      {errors.length > 0 && <ul className="m-0 list-none space-y-0.5 p-0" role="status">{errors.map((code) => <li key={code} className="text-xs font-medium text-destructive">{reason(code)}</li>)}</ul>}
      <Block title={t("text")}>
        <div className="flex min-h-11 items-center gap-2 lg:min-h-9"><Switch id={`${id}-custom`} checked={state.custom} onCheckedChange={(custom) => onChange({ ...state, custom })} />
          <label htmlFor={`${id}-custom`} className="flex min-h-11 flex-1 items-center text-sm lg:min-h-9">{t("customText", { platform: label })}</label></div>
        {state.custom && <Textarea value={state.content} onChange={(event) => onChange({ ...state, content: event.target.value })} aria-label={t("textFor", { platform: label })} className="min-h-24" />}
      </Block>
      {ready.length > 0 && <Block title={t("media")}>
        <ul className="m-0 list-none space-y-1 p-0" data-testid="platform-media">{ready.map((item) => {
          const result = preview?.media.find((entry) => entry.fileId === item.fileId), taken = state.mediaKeys === null || state.mediaKeys.includes(item.key);
          return <li key={item.key} className="flex min-w-0 items-start gap-2 text-sm" data-media-state={!taken ? "excluded" : result ? (result.accepted ? "accepted" : "rejected") : "pending"}>
            <label className="flex min-h-11 min-w-0 flex-1 items-start gap-2 py-2.5 lg:min-h-9 lg:py-1.5">
              <Checkbox className="mt-0.5" checked={taken} aria-label={t("include", { name: item.name })}
                onCheckedChange={(checked) => { const keys = state.mediaKeys ?? ready.map((entry) => entry.key); onChange({ ...state, mediaKeys: checked ? [...keys, item.key] : keys.filter((key) => key !== item.key) }); }} />
              <span className="min-w-0"><span className="block truncate font-medium">{item.name}</span>
                {taken && result && (result.accepted
                  ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3.5 text-success" aria-hidden="true" />{t("accepted")}</span>
                  : <span className="flex items-start gap-1 text-xs text-destructive"><X className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{t("rejected", { reasons: result.errors.map(reason).join("; ") })}</span>)}</span>
            </label></li>;
        })}</ul>
        {maxItems !== null && <p className="text-xs tabular-nums text-muted-foreground">{t("items", { count: (state.mediaKeys ?? ready.map((entry) => entry.key)).length, max: maxItems })}</p>}
      </Block>}
      {post && (reel || short) && <Block title={t("format")}>
        <ToggleGroup type="single" variant="outline" value={options.format || "standard"} aria-label={t("format")} onValueChange={(value) => { if (value) set({ format: value === "standard" ? "" : (value as "reel" | "short") }); }}>
          <ToggleGroupItem value="standard" className="min-h-11 px-4 lg:min-h-9">{t("standard")}</ToggleGroupItem>
          {reel && <ToggleGroupItem value="reel" className="min-h-11 px-4 lg:min-h-9">{t("reel")}</ToggleGroupItem>}
          {short && <ToggleGroupItem value="short" className="min-h-11 px-4 lg:min-h-9">{t("short")}</ToggleGroupItem>}
        </ToggleGroup>
      </Block>}
      {frame && video?.previewUrl && <Block title={t("cover")}><CoverFramePicker src={video.previewUrl} valueMs={options.coverTimeMs} onChange={(coverTimeMs) => set({ coverTimeMs })} /></Block>}
      {(requiresTitle.has(platform) || type === "article") && <Block title={t("title")}><Input aria-label={t("title")} value={options.title} onChange={(event) => set({ title: event.target.value })} className="min-h-11 lg:min-h-9" /></Block>}
      {platform === "reddit" && <Block title={t("subreddit")}><Input aria-label={t("subreddit")} value={options.subreddit} onChange={(event) => set({ subreddit: event.target.value })} className="min-h-11 lg:min-h-9" /></Block>}
      {platform === "pinterest" && <Block title={t("board")}><Input aria-label={t("board")} value={options.boardId} onChange={(event) => set({ boardId: event.target.value })} className="min-h-11 lg:min-h-9" /></Block>}
      {platform === "discord" && <Block title={t("channel")}><Input aria-label={t("channel")} inputMode="numeric" value={options.channelId} onChange={(event) => set({ channelId: event.target.value })} className="min-h-11 lg:min-h-9" /></Block>}
      {!ready.length && !(requiresTitle.has(platform) || platform === "reddit" || platform === "pinterest" || platform === "discord") && !(post && (reel || short)) && <p className="text-xs text-muted-foreground">{t("nothingMore")}</p>}
    </CollapsibleContent>
  </Collapsible>;
}
