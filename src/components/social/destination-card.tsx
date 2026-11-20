"use client";
import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ConnectionView, DestinationPreview } from "@/lib/social/api";
import type { CharacterCount } from "@/lib/social/characters";
import { itemLimit, type Attachment, type DestinationOptions, type DestinationState } from "@/lib/social/composer-state";
import { platformLabels } from "@/lib/social/labels";
import type { DraftType } from "@/lib/social/platforms";
import { RingMark } from "@/components/social/platform-ring";
import { CoverFramePicker } from "@/components/social/cover-frame-picker";
import { StatusBadge } from "@/components/status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

const requiresTitle = new Set(["youtube", "reddit", "pinterest"]);

function Row({ label, htmlFor, children, unavailable }: { label: string; htmlFor?: string; children?: React.ReactNode; unavailable?: string }) {
  return <div className="grid min-w-0 gap-2 border-t py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-start" data-row-state={unavailable ? "unavailable" : "available"}>
    <label htmlFor={htmlFor} className={cn("flex min-h-11 items-center text-sm font-medium sm:min-h-9", unavailable && "text-muted-foreground")}>{label}</label>
    {unavailable ? <p className="flex min-h-11 items-center text-sm text-muted-foreground sm:min-h-9" data-testid="option-unavailable">{unavailable}</p> : <div className="min-w-0 space-y-2">{children}</div>}
  </div>;
}

/**
 * One "Each platform" row: the account's counter, same text or its own text, which attachments it takes, the reel or short switch and the
 * option rows. An option the platform does not support is shown as an explicit unavailable row, never hidden. Counts come from the shared
 * counter (passed in as `count`); accepted and rejected media come from the server preview (passed in as `preview`).
 */
export function DestinationCard({ connection, type, state, count, attachments, preview, open, onOpenChange, onChange }: {
  connection: ConnectionView; type: DraftType; state: DestinationState; count: CharacterCount; attachments: readonly Attachment[]; preview?: DestinationPreview;
  open: boolean; onOpenChange: (open: boolean) => void; onChange: (next: DestinationState) => void;
}) {
  const t = useTranslations("SocialPublish.destination"), id = useId();
  const platform = connection.platform, caps = connection.capabilities, options = state.options;
  const name = connection.displayName ?? platformLabels[platform], label = platformLabels[platform];
  const set = (patch: Partial<DestinationOptions>) => onChange({ ...state, options: { ...options, ...patch } });
  const post = type === "post", ready = attachments.filter((item) => item.phase === "ready");
  const unavailableText = t("unavailableOn", { platform: label });
  const maxItems = itemLimit(connection, type, options.format);
  const reel = connection.mediaCapabilities.reel !== null, short = connection.mediaCapabilities.short !== null;
  const video = ready.find((item) => item.kind === "video"), frame = (options.format === "reel" ? connection.mediaCapabilities.reel : connection.mediaCapabilities.post)?.frame;
  const tone = count.limit !== null && count.used > count.limit ? "danger" : "neutral";
  const eligibility = (value: string) => value === "conditional" ? <StatusBadge tone="warning" label={t("needsEligible")} /> : null;
  return <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-xl border bg-card" data-testid="destination-card" data-platform={platform}>
    <CollapsibleTrigger className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <RingMark platform={platform} count={count} size={36} />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{label}</span><span className="block truncate text-xs text-muted-foreground">{name}</span></span>
      <StatusBadge tone={tone} label={count.limit === null ? t("counterNone", { used: count.used }) : t(count.rule === "estimate" ? "counterEstimate" : "counter", { used: count.used, limit: count.limit })} />
      <StatusBadge tone={state.custom ? "info" : "neutral"} label={state.custom ? t("custom") : t("same")} className="max-sm:hidden" />
      <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
    </CollapsibleTrigger>
    <CollapsibleContent className="px-3 pb-3">
      <Row label={t("text")}>
        <div className="flex min-h-11 items-center gap-2 sm:min-h-9"><Switch id={`${id}-custom`} checked={state.custom} aria-label={t("customText", { platform: label })}
          onCheckedChange={(custom) => onChange({ ...state, custom })} /><label htmlFor={`${id}-custom`} className="flex min-h-11 flex-1 items-center text-sm sm:min-h-9">{t("customText", { platform: label })}</label></div>
        {state.custom && <Textarea value={state.content} onChange={(event) => onChange({ ...state, content: event.target.value })} aria-label={t("textFor", { platform: label })} className="min-h-24" />}
      </Row>
      {ready.length > 0 && <Row label={t("media")}>
        <ul className="m-0 list-none space-y-1 p-0">{ready.map((item) => <li key={item.key}><label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
          <Checkbox checked={state.mediaKeys === null || state.mediaKeys.includes(item.key)} aria-label={t("include", { name: item.name })}
            onCheckedChange={(checked) => { const keys = state.mediaKeys ?? ready.map((entry) => entry.key); onChange({ ...state, mediaKeys: checked ? [...keys, item.key] : keys.filter((key) => key !== item.key) }); }} />
          <span className="truncate">{item.name}</span></label></li>)}</ul>
        {maxItems !== null && <p className="text-xs text-muted-foreground tabular-nums">{t("items", { count: (state.mediaKeys ?? ready.map((entry) => entry.key)).length, max: maxItems })}</p>}
      </Row>}
      {post && (reel || short) && <Row label={t("format")}>
        <ToggleGroup type="single" variant="outline" value={options.format || "standard"} aria-label={t("format")}
          onValueChange={(value) => { if (value) set({ format: value === "standard" ? "" : (value as "reel" | "short") }); }}>
          <ToggleGroupItem value="standard" className="min-h-11 px-4 sm:min-h-9">{t("standard")}</ToggleGroupItem>
          {reel && <ToggleGroupItem value="reel" className="min-h-11 px-4 sm:min-h-9">{t("reel")}</ToggleGroupItem>}
          {short && <ToggleGroupItem value="short" className="min-h-11 px-4 sm:min-h-9">{t("short")}</ToggleGroupItem>}
        </ToggleGroup>
      </Row>}
      {(requiresTitle.has(platform) || type === "article") && <Row label={t("title")} htmlFor={`${id}-title`}><Input id={`${id}-title`} value={options.title} onChange={(event) => set({ title: event.target.value })} className="min-h-11 lg:min-h-9" /></Row>}
      {platform === "reddit" && <Row label={t("subreddit")} htmlFor={`${id}-sub`}><Input id={`${id}-sub`} value={options.subreddit} onChange={(event) => set({ subreddit: event.target.value })} className="min-h-11 lg:min-h-9" /></Row>}
      {platform === "pinterest" && <Row label={t("board")} htmlFor={`${id}-board`}><Input id={`${id}-board`} value={options.boardId} onChange={(event) => set({ boardId: event.target.value })} className="min-h-11 lg:min-h-9" /></Row>}
      {platform === "discord" && <Row label={t("channel")} htmlFor={`${id}-channel`}><Input id={`${id}-channel`} inputMode="numeric" value={options.channelId} onChange={(event) => set({ channelId: event.target.value })} className="min-h-11 lg:min-h-9" /></Row>}
      {platform === "tiktok" && <Row label={t("privacy")} htmlFor={`${id}-privacy`}>
        <NativeSelect id={`${id}-privacy`} value={options.tiktokPrivacy} onChange={(event) => set({ tiktokPrivacy: event.target.value as DestinationOptions["tiktokPrivacy"] })} className="min-h-11 lg:min-h-9">
          <NativeSelectOption value="">{t("choose")}</NativeSelectOption>
          <NativeSelectOption value="PUBLIC_TO_EVERYONE">{t("privacyPublic")}</NativeSelectOption><NativeSelectOption value="MUTUAL_FOLLOW_FRIENDS">{t("privacyFriends")}</NativeSelectOption>
          <NativeSelectOption value="FOLLOWER_OF_CREATOR">{t("privacyFollowers")}</NativeSelectOption><NativeSelectOption value="SELF_ONLY">{t("privacyOnlyMe")}</NativeSelectOption>
        </NativeSelect>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9"><Checkbox checked={options.tiktokConfirmed} onCheckedChange={(checked) => set({ tiktokConfirmed: checked === true })} />{t("tiktokConfirm")}</label>
      </Row>}
      {frame && video && video.previewUrl && <Row label={t("cover")}>
        <CoverFramePicker src={video.previewUrl} valueMs={options.coverTimeMs} onChange={(coverTimeMs) => set({ coverTimeMs })} />
      </Row>}
      {caps.firstComment === "unavailable" || !post ? <Row label={t("firstComment")} unavailable={unavailableText} /> : <Row label={t("firstComment")} htmlFor={`${id}-comment`}>
        {eligibility(caps.firstComment)}<Textarea id={`${id}-comment`} value={options.firstComment} onChange={(event) => set({ firstComment: event.target.value })} className="min-h-20" /></Row>}
      {caps.repost === "unavailable" || !post ? <Row label={t("repost")} unavailable={unavailableText} /> : <Row label={t("repost")}>
        <div className="flex min-h-11 items-center gap-2 sm:min-h-9"><Switch id={`${id}-repost`} checked={options.repostOn} aria-label={t("repost")} onCheckedChange={(repostOn) => set({ repostOn })} />
          <label htmlFor={`${id}-repost`} className="flex min-h-11 flex-1 items-center text-sm sm:min-h-9">{t("repostOn")}</label></div>
        {options.repostOn && <div className="grid gap-2 sm:grid-cols-3">
          <label className="space-y-1 text-sm">{t("everyDays")}<Input type="number" min={7} max={365} value={options.repostDays} onChange={(event) => set({ repostDays: event.target.value })} className="min-h-11 lg:min-h-9" /></label>
          <label className="space-y-1 text-sm">{t("stopRule")}<NativeSelect value={options.stopKind} onChange={(event) => set({ stopKind: event.target.value as "count" | "date" })} className="min-h-11 lg:min-h-9">
            <NativeSelectOption value="count">{t("stopAfterCopies")}</NativeSelectOption><NativeSelectOption value="date">{t("stopOnDate")}</NativeSelectOption></NativeSelect></label>
          {options.stopKind === "count"
            ? <label className="space-y-1 text-sm">{t("copies")}<Input type="number" min={1} max={52} value={options.stopCopies} onChange={(event) => set({ stopCopies: event.target.value })} className="min-h-11 lg:min-h-9" /></label>
            : <label className="space-y-1 text-sm">{t("until")}<Input type="date" value={options.stopUntil} onChange={(event) => set({ stopUntil: event.target.value })} className="min-h-11 lg:min-h-9" /></label>}
        </div>}
      </Row>}
      {caps.madeWithAi === "unavailable" || !post ? <Row label={t("madeWithAi")} unavailable={unavailableText} /> : <Row label={t("madeWithAi")}>
        {eligibility(caps.madeWithAi)}<div className="flex min-h-11 items-center gap-2 sm:min-h-9"><Switch id={`${id}-ai`} checked={options.madeWithAi} aria-label={t("madeWithAi")} onCheckedChange={(madeWithAi) => set({ madeWithAi })} />
          <label htmlFor={`${id}-ai`} className="flex min-h-11 flex-1 items-center text-sm sm:min-h-9">{t("madeWithAiOn")}</label></div></Row>}
      {caps.link === "unavailable" || !post ? <Row label={t("link")} unavailable={unavailableText} /> : caps.link === "inline"
        ? <Row label={t("link")}><p className="flex min-h-11 items-center text-sm text-muted-foreground sm:min-h-9">{t("linkInline")}</p></Row>
        : <Row label={t("link")} htmlFor={`${id}-link`}><Input id={`${id}-link`} type="url" inputMode="url" value={options.linkUrl} onChange={(event) => set({ linkUrl: event.target.value })} className="min-h-11 lg:min-h-9" /></Row>}
      {preview && (preview.errors.length > 0 || preview.warnings.length > 0) && <div className="border-t pt-3" />}
    </CollapsibleContent>
  </Collapsible>;
}
