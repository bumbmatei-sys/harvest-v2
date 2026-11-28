/** Derived from Shadcn UI Kit item testimonial11 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Product landing page). Local changes: docs/ui-sources.md. */
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { LandingReview } from "@/lib/catalog-landing";
import { LandingReviewCard, Stars } from "./landing-review-card";

/** The reviews section: header with the average, then the review cards (customer-reviews5) in the kit's two-column grid, and the caller's review form. */
export function LandingReviews({ reviews, rating, form }: { reviews: LandingReview[]; rating: { average: number | null; count: number }; form?: React.ReactNode }) {
  const t = useTranslations("CatalogLanding"), r = useTranslations("CatalogLanding.reviews");
  return (
    <section className="w-full" aria-labelledby="landing-reviews" id="reviews">
      <div>
        <header className="mb-10 space-y-3">
          <Badge variant="outline">
            <span className="bg-primary size-2 rounded-full" aria-hidden />
            {r("badge")}
          </Badge>
          <h2 id="landing-reviews" className="text-3xl leading-tight font-bold md:text-4xl">
            {r("title")}
          </h2>
          {rating.average !== null && <div className="text-muted-foreground flex flex-wrap items-center gap-2 md:text-lg">
            <Stars value={rating.average} />
            <p>{t("meta.ratingLine", { average: rating.average.toFixed(1), count: rating.count })}</p>
          </div>}
        </header>

        {reviews.length === 0 ? <p className="text-muted-foreground">{r("empty")}</p> : <div className="grid gap-4 md:grid-cols-2">
          {reviews.map((review, i) => (
            <LandingReviewCard key={i} review={review} className="shadow-none" />
          ))}
        </div>}
        {form && <div className="mt-6">{form}</div>}
      </div>
    </section>
  );
}
