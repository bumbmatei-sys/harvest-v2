/** Derived from Shadcn UI Kit item customer-reviews5 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Product landing page). Local changes: docs/ui-sources.md. */
import { useFormatter, useTranslations } from "next-intl";
import {
  StarIcon,
  CheckCircleIcon,
  Dot,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { LandingReview } from "@/lib/catalog-landing";
import { cn } from "@/lib/utils";

export function Stars({ value, className }: { value: number; className?: string }) {
  const t = useTranslations("CatalogLanding");
  return (
    <div
      className={cn("flex items-center gap-0.5", className)}
      role="img"
      aria-label={t("starsLabel", { value })}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <StarIcon
          key={i}
          aria-hidden="true"
          className={cn(
            "size-4",
            i < Math.round(value)
              ? "fill-warning text-warning"
              : "fill-muted text-muted-foreground/30",
          )}
        />
      ))}
    </div>
  );
}

/** One public review: the reviewer's first name (initial avatar), stars, text, date and "Has this" (every reviewer has the item). No photos, votes or menu. */
export function LandingReviewCard({ review, className }: { review: LandingReview; className?: string }) {
  const t = useTranslations("CatalogLanding.reviews"), format = useFormatter();
  const name = review.name || t("learner");
  return (
    <div className={cn("bg-card w-full rounded-2xl border p-5", className)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Avatar className="size-9" aria-hidden="true"><AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback></Avatar>
            <span className="text-sm font-medium">{name}</span>
          </div>
        </div>

        <div className="mt-4 space-y-1.5">
          <Stars value={review.rating} />
          {review.body && <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line break-words">
            {review.body}
          </p>}
        </div>

        <div className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
          <time dateTime={review.updatedAt}>{format.dateTime(new Date(review.updatedAt), { dateStyle: "medium" })}</time>
            <>
              <Dot aria-hidden="true" className="size-3.5" />
              <span className="text-success flex items-center gap-1">
                <CheckCircleIcon className="size-3.5" aria-hidden="true" />
                {t("verified")}
              </span>
            </>
        </div>
    </div>
  );
}
