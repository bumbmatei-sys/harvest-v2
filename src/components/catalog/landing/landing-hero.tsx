/** Derived from Shadcn UI Kit item hero12 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Product landing page). Local changes: docs/ui-sources.md. */
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Dot } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { CatalogTypeArt } from "@/components/catalog/catalog-type-art";
import type { CatalogKind } from "@/lib/catalog";
import type { PublicLanding } from "@/lib/catalog-landing";
import { Stars } from "./landing-review-card";
import { SaleCountdown } from "./sale-countdown";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");

/** The landing's top bar inside the public frame: the creator (ministry) avatar and name, and Sign in when signed out. */
export function LandingNav({ host, signInHref }: { host: string; signInHref: string | null }) {
  const t = useTranslations("CatalogLanding");
  return (
    <nav aria-label={t("creatorLabel")} className="flex w-full items-center justify-between gap-3">
      <p className="flex min-w-0 items-center gap-2">
        <Avatar size="lg" aria-hidden="true"><AvatarFallback>{initials(host)}</AvatarFallback></Avatar>
        <span className="truncate text-lg font-bold">{host}</span>
      </p>

      <div className="flex items-center gap-3">
        {signInHref && <Button
          variant="outline"
          className="min-h-11 rounded-full lg:min-h-9"
          asChild
        >
          <Link href={signInHref}>{t("signIn")}</Link>
        </Button>}
      </div>
    </nav>
  );
}

/**
 * Hero: rating line, big title, subtitle, the meta line ("By X · N modules · N files · N people have it · N reviews"), a sale pill with a live countdown, the primary
 * button to the buy box and the cover (the course or download art; no cover image exists in the data yet).
 */
export function LandingHero({ landing, kind, cta }: { landing: PublicLanding; kind: CatalogKind; cta: string }) {
  const t = useTranslations("CatalogLanding");
  const meta = [
    t("byHost", { host: landing.host }),
    ...(landing.stats.modules > 0 ? [t("meta.modules", { count: landing.stats.modules })] : []),
    ...(landing.stats.lessons > 0 ? [t("meta.lessons", { count: landing.stats.lessons })] : []),
    ...(landing.stats.files > 0 ? [t("meta.files", { count: landing.stats.files })] : []),
    landing.stats.people === null ? t("meta.fewPeople") : t("meta.people", { count: landing.stats.people }),
  ];
  return (
    <div className="relative w-full">
      {/* Hero Content */}
      <div className="flex flex-col items-center py-10 text-center md:py-16">
        {landing.rating.average !== null && <div className="mb-6 flex flex-col items-center gap-3 sm:flex-row">
          <div className="flex flex-col items-center gap-0.5 sm:items-start">
            <div className="flex gap-1">
              <Stars value={landing.rating.average} />
            </div>
            <span className="text-foreground text-xs">
              {t("meta.ratingLine", { average: landing.rating.average.toFixed(1), count: landing.rating.count })}
            </span>
          </div>
        </div>}

        <h1 className="max-w-4xl text-4xl leading-tight font-bold text-balance break-words md:text-5xl">
          {landing.title}
        </h1>
        {(landing.subtitle || landing.summary) && <p className="text-muted-foreground mt-6 max-w-2xl text-lg leading-relaxed text-balance">
          {landing.subtitle || landing.summary}
        </p>}
        <ul className="text-muted-foreground mt-4 flex flex-wrap justify-center gap-x-2 gap-y-1 text-sm" aria-label={t("creatorLabel")}>
          {meta.map((part, index) => <li key={index} className="flex items-center gap-2">{index > 0 && <Dot aria-hidden="true" className="size-4" />}{part}</li>)}
        </ul>
        {landing.price?.saleEndsAt && <Badge variant="destructive" className="mt-6 gap-2 px-3 py-1 text-sm dark:bg-destructive">
          {t("salePill")}<SaleCountdown endsAt={landing.price.saleEndsAt} />
        </Badge>}
        <div className="mt-10 mb-12 flex items-center gap-3">
          <Button size="lg" className="min-h-11 rounded-full md:h-12" asChild>
            <Link href="#buy">{cta}</Link>
          </Button>
        </div>
        <CatalogTypeArt kind={kind} variant="cover" className="aspect-video h-auto w-full max-w-4xl rounded-xl border" />
      </div>
    </div>
  );
}
