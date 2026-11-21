"use client";
import { ImageIcon, Reply } from "lucide-react";
import { useTranslations } from "next-intl";
import { PlatformLogo } from "@/components/social/platform-logo";
import { platformLabels } from "@/lib/social/labels";
import { renderAutoDm, type AutoDmRule } from "@/lib/social/auto-dm";
import type { SocialPlatform } from "@/lib/social/platforms";
import { cn } from "@/lib/utils";

const bubble = "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words";
/** The live preview: what the person sees, with the first name filled by a fixed example. Nothing here is sent; the text is the rule's own template. */
export function DmPreview({ platform, accountName, rule, mediaName }: { platform: SocialPlatform; accountName: string; rule: AutoDmRule; mediaName?: string | null }) {
  const t = useTranslations("SocialAutoDm.preview");
  const text = rule.response.text.trim() ? renderAutoDm(rule.response.text, "Example") : "", reply = rule.response.publicReply?.trim() ? renderAutoDm(rule.response.publicReply, "Example") : "";
  const sampleKeyword = rule.match.keywords[0] ?? t("sampleComment");
  return <section aria-label={t("title")} data-testid="dm-preview" className="overflow-hidden rounded-xl border bg-card">
    <header className="flex items-center gap-2 border-b px-3 py-2.5">
      <span className="flex size-8 items-center justify-center rounded-full bg-muted"><PlatformLogo colored platform={platform} className="size-4" /></span>
      <div className="min-w-0"><p className="truncate text-sm font-medium">{accountName}</p><p className="text-xs text-muted-foreground">{platformLabels[platform]}</p></div>
    </header>
    <div className="space-y-2 p-3">
      {rule.trigger === "comment" && <>
        <div className="flex flex-col items-start gap-1"><p className="text-xs text-muted-foreground">{t("comment")}</p><p className={cn(bubble, "bg-muted")}>{sampleKeyword}</p></div>
        {reply && <div className="flex flex-col items-end gap-1" data-testid="preview-public-reply"><p className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Reply className="size-3" aria-hidden="true" />{t("publicReply")}</p><p className={cn(bubble, "bg-secondary text-secondary-foreground")}>{reply}</p></div>}
      </>}
      <div className="flex flex-col items-end gap-1"><p className="text-xs text-muted-foreground">{t("dm")}</p>
        {mediaName !== undefined && mediaName !== null && <p className={cn(bubble, "inline-flex items-center gap-2 bg-secondary text-secondary-foreground")}><ImageIcon className="size-4 shrink-0" aria-hidden="true" /><span className="truncate">{mediaName}</span></p>}
        {text ? <p className={cn(bubble, "bg-primary text-primary-foreground")} data-testid="preview-dm">{text}</p> : <p className="rounded-2xl border border-dashed px-3 py-2 text-sm text-muted-foreground">{t("empty")}</p>}
        {rule.response.quickReplies.length > 0 && <ul className="flex flex-wrap justify-end gap-1.5" aria-label={t("quickReplies")}>{rule.response.quickReplies.map((button) => <li key={button.key} className="rounded-full border px-3 py-1 text-xs">{button.title}</li>)}</ul>}
      </div>
      {rule.response.followup && <div className="flex flex-col items-end gap-1"><p className="text-xs text-muted-foreground">{t("followup", { minutes: rule.response.followup.delayMinutes })}</p>
        <p className={cn(bubble, "bg-secondary text-secondary-foreground")}>{renderAutoDm(rule.response.followup.text, "Example")}</p></div>}
    </div>
  </section>;
}
