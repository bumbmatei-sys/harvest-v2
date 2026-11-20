/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/pages/settings/notifications/page.tsx; code written for Harvest, no kit code copied. */
"use client";
import { useId } from "react";
import { useTranslations } from "next-intl";
import type { ConnectionView } from "@/lib/social/api";
import { sharedSupport, type DestinationOptions, type SharedOptions } from "@/lib/social/composer-state";
import type { DraftType, SocialPlatform } from "@/lib/social/platforms";
import { PlatformLogo } from "@/components/social/platform-logo";
import { StatusBadge } from "@/components/status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** The bordered option row of the kit's settings form: title and a line about where it applies on the left, the control on the right, details below when on. */
function OptionRow({ id, title, applies, none, noneText, checked, onChecked, children, badge }: {
  id: string; title: string; applies: readonly SocialPlatform[]; none: boolean; noneText: string; checked?: boolean; onChecked?: (value: boolean) => void; children?: React.ReactNode; badge?: React.ReactNode;
}) {
  const t = useTranslations("SocialPublish.options");
  return <div className="rounded-lg border bg-card" data-testid="option-row" data-state={none ? "unavailable" : checked ? "on" : "off"}>
    <div className="flex min-h-14 items-center justify-between gap-3 px-3 py-2 sm:px-4">
      <label htmlFor={id} className={cn("flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5", onChecked && !none && "cursor-pointer")}>
        <span className={cn("flex items-center gap-2 text-sm font-medium", none && "text-muted-foreground")}>{title}{badge}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{none ? noneText : <>{t("appliesTo")}{applies.map((platform) => <PlatformLogo key={platform} platform={platform} className="size-3.5" />)}</>}</span>
      </label>
      {onChecked && <Switch id={id} checked={!none && !!checked} disabled={none} onCheckedChange={onChecked} />}
    </div>
    {!none && children && (checked || !onChecked) && <div className="space-y-2 border-t px-3 py-3 sm:px-4">{children}</div>}
  </div>;
}

/**
 * The option rows of the composer: first comment, auto repost, made with AI, link and, for TikTok, who can view and the consent. A row applies to every
 * selected account that supports it, and says which; when none of them does, it stays as an explicit unavailable row.
 */
export function OptionRows({ connections, type, mode, shared, onShared, tiktok, onTiktok }: {
  connections: readonly ConnectionView[]; type: DraftType; mode: "none" | "image" | "video"; shared: SharedOptions; onShared: (next: SharedOptions) => void;
  tiktok?: DestinationOptions; onTiktok: (patch: Partial<DestinationOptions>) => void;
}) {
  const t = useTranslations("SocialPublish.options"), id = useId();
  const set = (patch: Partial<SharedOptions>) => onShared({ ...shared, ...patch });
  const who = (key: "firstComment" | "repost" | "madeWithAi" | "link") => connections.filter((connection) => sharedSupport(connection, type, mode)[key]).map((connection) => connection.platform);
  const noAccount = connections.length === 0, noneText = noAccount ? t("pickAccount") : t("unavailable");
  const first = who("firstComment"), repost = who("repost"), ai = who("madeWithAi"), link = who("link");
  const field = "min-h-11 lg:min-h-9";
  return <div className="space-y-2" data-testid="option-rows">
    <OptionRow id={`${id}-comment`} title={t("firstComment")} applies={first} none={first.length === 0} noneText={noneText} checked={shared.firstCommentOn} onChecked={(firstCommentOn) => set({ firstCommentOn })}>
      <Textarea aria-label={t("firstComment")} value={shared.firstComment} onChange={(event) => set({ firstComment: event.target.value })} className="min-h-20" />
    </OptionRow>
    <OptionRow id={`${id}-repost`} title={t("repost")} applies={repost} none={repost.length === 0} noneText={noneText} checked={shared.repostOn} onChecked={(repostOn) => set({ repostOn })}>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="space-y-1 text-sm">{t("everyDays")}<Input type="number" min={7} max={365} value={shared.repostDays} onChange={(event) => set({ repostDays: event.target.value })} className={field} /></label>
        <label className="space-y-1 text-sm">{t("stopRule")}<NativeSelect value={shared.stopKind} onChange={(event) => set({ stopKind: event.target.value as "count" | "date" })} className={field}>
          <NativeSelectOption value="count">{t("stopAfterCopies")}</NativeSelectOption><NativeSelectOption value="date">{t("stopOnDate")}</NativeSelectOption></NativeSelect></label>
        {shared.stopKind === "count"
          ? <label className="space-y-1 text-sm">{t("copies")}<Input type="number" min={1} max={52} value={shared.stopCopies} onChange={(event) => set({ stopCopies: event.target.value })} className={field} /></label>
          : <label className="space-y-1 text-sm">{t("until")}<Input type="date" value={shared.stopUntil} onChange={(event) => set({ stopUntil: event.target.value })} className={field} /></label>}
      </div>
    </OptionRow>
    <OptionRow id={`${id}-ai`} title={t("madeWithAi")} applies={ai} none={ai.length === 0} noneText={noneText} checked={shared.madeWithAi} onChecked={(madeWithAi) => set({ madeWithAi })} />
    <OptionRow id={`${id}-link`} title={t("link")} applies={link} none={link.length === 0} noneText={noAccount ? t("pickAccount") : t("linkNone")}>
      <Input type="url" inputMode="url" aria-label={t("link")} value={shared.linkUrl} onChange={(event) => set({ linkUrl: event.target.value })} className={field} />
    </OptionRow>
    {tiktok && <OptionRow id={`${id}-tiktok`} title={t("tiktok")} applies={["tiktok"]} none={false} noneText="" badge={<StatusBadge tone="warning" label={t("required")} />}>
      <label className="block space-y-1 text-sm">{t("privacy")}
        <NativeSelect value={tiktok.tiktokPrivacy} onChange={(event) => onTiktok({ tiktokPrivacy: event.target.value as DestinationOptions["tiktokPrivacy"] })} className={field}>
          <NativeSelectOption value="">{t("choose")}</NativeSelectOption>
          <NativeSelectOption value="PUBLIC_TO_EVERYONE">{t("privacyPublic")}</NativeSelectOption><NativeSelectOption value="MUTUAL_FOLLOW_FRIENDS">{t("privacyFriends")}</NativeSelectOption>
          <NativeSelectOption value="FOLLOWER_OF_CREATOR">{t("privacyFollowers")}</NativeSelectOption><NativeSelectOption value="SELF_ONLY">{t("privacyOnlyMe")}</NativeSelectOption>
        </NativeSelect></label>
      <label className="flex min-h-11 items-center gap-2 text-sm lg:min-h-9"><Checkbox checked={tiktok.tiktokConfirmed} onCheckedChange={(checked) => onTiktok({ tiktokConfirmed: checked === true })} />{t("tiktokConfirm")}</label>
    </OptionRow>}
  </div>;
}
