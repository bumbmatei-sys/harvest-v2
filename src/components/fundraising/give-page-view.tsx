/* eslint-disable @next/next/no-img-element -- the cover is a short redirect to a one-minute signed address (or the owner's signed preview address); not optimisable */
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { GiveProgress } from "@/components/fundraising/fundraising-progress";
import { WaysToGive } from "@/components/giving/ways-to-give";
import type { GivePublicView } from "@/lib/give-page";
import type { GivingPublicMethod } from "@/lib/ways-to-give";
import { cn } from "@/lib/utils";

/** `responsive` follows the viewport (the public page); `narrow` pins the phone layout (the owner's preview dialog). */
export type GivePageLayout = "responsive" | "narrow";

/**
 * The public fundraising page as plain data: cover, title, ministry, description, the progress block (when the owner shows the amount) and the ministry's Ways
 * to give block. One render path for /give/<slug> and the owner's preview (`preview`: links inert, no Report button), modelled on the community public page
 * (two columns from lg, one on phones). No data fetching here; no donor names exist in the data.
 */
export function GivePageView({ view, coverUrl, methods, reportUrl, layout = "responsive", preview = false }: {
  view: GivePublicView; coverUrl: string | null; methods: GivingPublicMethod[]; reportUrl?: string; layout?: GivePageLayout; preview?: boolean;
}) {
  const t = useTranslations("GivePage.public");
  const ministry = view.ministry.trim() || t("theMinistry");
  const Title = preview ? "p" : "h1";
  const wide = layout === "responsive";
  return <article className="space-y-6" data-give-page>
    {view.hasCover && coverUrl && <div className="overflow-hidden rounded-xl border bg-muted">
      <img src={coverUrl} alt={t("coverAlt", { title: view.title })} className="aspect-[16/9] w-full object-cover" data-give-cover />
    </div>}
    <div className={cn("grid gap-6", wide && "lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8")}>
      <section className="min-w-0 space-y-4">
        <header className="space-y-1">
          <Title className="break-words text-[28px] font-semibold leading-tight tracking-tight">{view.title}</Title>
          <p className="text-sm text-muted-foreground">{t("by", { ministry })}</p>
        </header>
        {view.description && <p className="max-w-prose whitespace-pre-line break-words text-base">{view.description}</p>}
      </section>
      <aside className={cn("min-w-0 space-y-4", wide && "lg:sticky lg:top-6 lg:self-start")}>
        {view.amount && <Card><CardContent className="space-y-2 pt-6"><GiveProgress amount={view.amount} />
          <p className="text-xs text-muted-foreground">{t("recorded")}</p></CardContent></Card>}
        <WaysToGive methods={methods} ministryName={ministry} inert={preview} headingLevel={2} reportUrl={preview ? undefined : reportUrl} />
      </aside>
    </div>
    <p className="border-t pt-4 text-sm text-muted-foreground" data-give-notice>{t("notice", { ministry })}</p>
  </article>;
}
