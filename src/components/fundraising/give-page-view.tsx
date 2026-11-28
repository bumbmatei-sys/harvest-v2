/** Derived from Shadcn UI Kit item product-details1 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Giving screens). Kit code; local changes: docs/ui-sources.md. */
/* eslint-disable @next/next/no-img-element -- the cover is a short redirect to a one-minute signed address (or the owner's signed preview address); not optimisable */
import { useTranslations } from "next-intl";
import { GiveProgress } from "@/components/fundraising/give-progress";
import { WaysToGive } from "@/components/giving/ways-to-give";
import type { GivePublicView } from "@/lib/give-page";
import type { GivingPublicMethod } from "@/lib/ways-to-give";
import { cn } from "@/lib/utils";

/** `responsive` follows the viewport (the public page); `narrow` pins the phone layout (the owner's preview dialog). */
export type GivePageLayout = "responsive" | "narrow";

/**
 * The public fundraising page as plain data, in the kit's two-column product layout: the cover on the left, then title, ministry, the progress card (when
 * the owner shows the amount), the description and the ministry's Ways to give block. Without a cover the Ways to give block takes the second column.
 * One render path for /give/<slug> and the owner's preview (`preview`: links inert, no Report button). No data fetching here; no donor names exist in the data.
 */
export function GivePageView({ view, coverUrl, methods, reportUrl, layout = "responsive", preview = false }: {
  view: GivePublicView; coverUrl: string | null; methods: GivingPublicMethod[]; reportUrl?: string; layout?: GivePageLayout; preview?: boolean;
}) {
  const t = useTranslations("GivePage.public");
  const ministry = view.ministry.trim() || t("theMinistry");
  const Title = preview ? "p" : "h1";
  const wide = layout === "responsive";
  const cover = view.hasCover && coverUrl;
  const ways = <WaysToGive methods={methods} ministryName={ministry} inert={preview} headingLevel={2} reportUrl={preview ? undefined : reportUrl} />;

  return (
    <article className="w-full space-y-6" data-give-page>
      <div className={cn("grid gap-4", wide && "lg:grid-cols-2 lg:gap-8")}>
        {cover && (
        <figure className="mx-auto w-full shrink-0">
          <img
            src={coverUrl}
            alt={t("coverAlt", { title: view.title })}
            className="aspect-[16/9] w-full rounded-lg object-cover"
            data-give-cover
          />
        </figure>
        )}

        <div className="min-w-0 space-y-6">
          <div className="space-y-4">
            <Title className="text-2xl leading-tight font-bold break-words md:text-3xl">
              {view.title}
            </Title>

            <div className="sm:flex sm:items-center sm:gap-4">
              <p className="text-muted-foreground text-sm">{t("by", { ministry })}</p>
            </div>

            {view.amount && <GiveProgress amount={view.amount} />}
          </div>

          {view.description && (
          <div className="space-y-4">
            <p className="max-w-prose text-base break-words whitespace-pre-line">
              {view.description}
            </p>
          </div>
          )}

          {cover && ways}
        </div>

        {!cover && ways && <div className="min-w-0">{ways}</div>}
      </div>
      <p className="text-muted-foreground border-t pt-4 text-sm" data-give-notice>{t("notice", { ministry })}</p>
    </article>
  );
}
