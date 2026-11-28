/** Derived from Shadcn UI Kit item pricing17 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Product landing page). Local changes: docs/ui-sources.md. */
import { useTranslations } from "next-intl";
import { CheckIcon, LockIcon, StarIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { LandingReview } from "@/lib/catalog-landing";
import { Stars } from "./landing-review-card";
import { SaleCountdown } from "./sale-countdown";

function FeatureList({ features }: { features: string[] }) {
  return (
    <ol className="space-y-3">
      {features.map((feature, index) => (
        <li
          key={index}
          className="flex items-start gap-2 text-sm"
        >
          <CheckIcon aria-hidden="true" className="text-primary mt-0.5 size-4 shrink-0" />
          <span className="text-muted-foreground">
            <span className="text-foreground font-medium">
              {String(index + 1).padStart(2, "0")}
            </span>{" "}
            {feature}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Price({ value, original, note }: { value: string; original?: string | null; note?: string }) {
  const t = useTranslations("CatalogLanding.buy");
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      {original && (
        <span className="text-muted-foreground tabular-nums line-through">
          <span className="sr-only">{t("was")} </span>{original}
        </span>
      )}
      <span className="text-4xl font-bold tracking-tight tabular-nums">
        {value}
      </span>
      {note && <span className="text-muted-foreground text-sm">{note}</span>}
    </div>
  );
}

/**
 * The buy box: sale banner and countdown, the price (old price struck through), then for a paid item the name and email fields and the button, all turned off with
 * "Checkout opens soon" (no checkout until the ministry can take payments), the discount and secure-checkout lines; for a free item the existing enrol or get step
 * (`action`). Then one featured review, the numbered "What's included" list and "Sold by". It stays in view beside the text on wide screens (the page makes it sticky).
 */
export function LandingBuyBox({ title, price, oldPrice, saleEndsAt, paid, action, featured, included, host }: {
  title: string; price: string; oldPrice: string | null; saleEndsAt: string | null; paid: boolean; action: React.ReactNode;
  featured: LandingReview | null; included: string[]; host: string }) {
  const t = useTranslations("CatalogLanding.buy"), l = useTranslations("CatalogLanding");
  return (
    <Card className="border-primary relative z-10 shadow-none" data-slot="landing-buy-box" id="buy" aria-labelledby="landing-buy-title">
      <CardHeader>
        <CardTitle id="landing-buy-title" className="text-lg text-balance">
          {title}
        </CardTitle>
        {saleEndsAt && <CardAction>
          <Badge variant="destructive" className="dark:bg-destructive">
            <StarIcon aria-hidden="true" className="fill-current" />
            {l("salePill")}
          </Badge>
        </CardAction>}
        {saleEndsAt && <CardDescription className="text-destructive text-balance font-medium">
          <SaleCountdown endsAt={saleEndsAt} />
        </CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col">
        <Price value={price} original={oldPrice} note={paid ? t("oneTime") : undefined} />
        {paid ? <form className="mt-6 space-y-3" aria-describedby="landing-checkout-soon">
          <div className="space-y-1.5"><Label htmlFor="landing-first-name">{t("firstName")}</Label>
            <Input id="landing-first-name" autoComplete="given-name" className="min-h-11" disabled /></div>
          <div className="space-y-1.5"><Label htmlFor="landing-email">{t("email")}</Label>
            <Input id="landing-email" type="email" autoComplete="email" className="min-h-11" disabled /></div>
          <Button type="button" className="min-h-11 w-full" disabled>
            {t("buy")}
          </Button>
          <p id="landing-checkout-soon" role="note" className="text-muted-foreground text-sm">{t("checkoutSoon")}</p>
          <Button type="button" variant="link" className="min-h-11 px-0" disabled>{t("discount")}</Button>
          <p className="text-muted-foreground flex items-center gap-2 text-xs"><LockIcon aria-hidden="true" className="size-3.5" />{t("secure")}</p>
        </form> : <div className="mt-6">{action}</div>}
        {featured && <>
          <Separator className="my-6" />
          <figure className="space-y-2">
            <Stars value={featured.rating} />
            <blockquote className="text-sm leading-relaxed">{featured.body}</blockquote>
            <figcaption className="text-muted-foreground text-xs">{featured.name || l("reviews.learner")}</figcaption>
          </figure>
        </>}
        {included.length > 0 && <>
          <Separator className="my-6" />
          <p className="mb-3 text-sm font-semibold">{t("included")}</p>
          <FeatureList features={included} />
        </>}
        <Separator className="my-6" />
        <p className="text-muted-foreground text-sm">{t("soldBy", { host })}</p>
      </CardContent>
    </Card>
  );
}
