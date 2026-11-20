"use client";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { DestinationPreview } from "@/lib/social/api";
import type { Attachment } from "@/lib/social/composer-state";
import { platformLabels } from "@/lib/social/labels";
import { RingMark } from "@/components/social/platform-ring";
import { Skeleton } from "@/components/ui/skeleton";
import { useReason } from "@/components/social/use-reason";

/**
 * For every selected account: which attached files it accepts and which it rejects, with the reason, straight from the server's media rules
 * (the preview call). Nothing is converted: a rejected file stays rejected until the person removes it from that account or the post.
 */
export function MediaByDestination({ previews, attachments, loading, itemMax }: {
  previews: readonly DestinationPreview[]; attachments: readonly Attachment[]; loading: boolean; itemMax: (connectionId: string) => number | null;
}) {
  const t = useTranslations("SocialPublish.mediaStatus"), reason = useReason();
  const ready = attachments.filter((item) => item.phase === "ready");
  if (ready.length === 0 || previews.length === 0) return null;
  return <section aria-labelledby="media-status" className="space-y-2" data-testid="media-status" aria-busy={loading}>
    <h3 id="media-status" className="text-sm font-semibold">{t("title")}</h3>
    <ul className="m-0 list-none space-y-2 p-0">
      {previews.map((preview) => {
        const max = itemMax(preview.account.id), count = preview.attachments.length;
        return <li key={preview.account.id} className="space-y-2 rounded-lg border bg-card p-3" data-platform={preview.account.platform}>
          <div className="flex items-center gap-2"><RingMark platform={preview.account.platform} active={false} size={28} className="[&>span]:size-5 [&>span]:text-[9px]" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{platformLabels[preview.account.platform]}</span>
            {max !== null && <span className="text-xs tabular-nums text-muted-foreground">{t("items", { count, max })}</span>}</div>
          {loading && preview.media.length === 0 ? <Skeleton className="h-6 w-2/3" /> : <ul className="m-0 list-none space-y-1 p-0">
            {preview.media.map((result, index) => {
              const item = ready.find((entry) => entry.fileId === result.fileId);
              return <li key={`${result.fileId}-${index}`} className="flex items-start gap-2 text-sm" data-media-state={result.accepted ? "accepted" : "rejected"}>
                {result.accepted ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> : <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />}
                <span className="min-w-0"><span className="truncate font-medium">{item?.name ?? t("attachment")}</span>{" "}
                  <span className={result.accepted ? "text-muted-foreground" : "text-destructive"}>{result.accepted ? t("accepted") : t("rejected", { reasons: result.errors.map(reason).join("; ") })}</span></span>
              </li>;
            })}
            {preview.media.length === 0 && <li className="text-sm text-muted-foreground">{t("noneIncluded")}</li>}
          </ul>}
        </li>;
      })}
    </ul>
  </section>;
}
