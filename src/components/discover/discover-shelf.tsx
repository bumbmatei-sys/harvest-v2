/** Derived from Shadcn UI Kit item product-list4 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Discover redesign, PR #338). Local changes: docs/ui-sources.md. */
"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { ListingCard, type ListingCardItem } from "./listing-card";

/**
 * One horizontal Discover shelf: a heading, an optional one-line subtitle and "See all", then the cards in a carousel (swipe, the arrow keys or the arrows). The page decides
 * whether a shelf has enough items to show at all.
 */
export function DiscoverShelf({ title, subtitle, seeAll, items, onQuickLook, onReport, slot }: { title: string; subtitle?: string; seeAll?: string; items: ListingCardItem[];
  onQuickLook: (item: ListingCardItem) => void; onReport: (item: ListingCardItem) => void; slot?: string }) {
  const t = useTranslations("DiscoverScreens"), id = useId();
  const [api, setApi] = useState<CarouselApi>();
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(true);

  useEffect(() => {
    if (!api) return;
    const onSelect = () => {
      setCanScrollPrev(api.canScrollPrev());
      setCanScrollNext(api.canScrollNext());
    };
    const frame = window.requestAnimationFrame(onSelect);
    api.on("select", onSelect);
    api.on("reInit", onSelect);
    return () => {
      window.cancelAnimationFrame(frame);
      api.off("select", onSelect);
      api.off("reInit", onSelect);
    };
  }, [api]);

  return (
    <section className="w-full" aria-labelledby={id} data-slot={slot}>
      <div>
        <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1 space-y-1">
            <h2 id={id} className="text-lg leading-tight font-semibold text-balance">
              {title}
            </h2>
            {subtitle && <p className="text-muted-foreground text-sm">
              {subtitle}
            </p>}
          </div>
          {seeAll && <Button variant="link" size="responsive" className="shrink-0 self-start px-0 underline sm:self-auto" asChild>
            <Link href={seeAll} prefetch={false} aria-label={t("seeAllNamed", { name: title })}>{t("seeAll")}</Link>
          </Button>}
        </header>

        <Carousel
          setApi={setApi}
          opts={{ align: "start", containScroll: "trimSnaps" }}
          className="w-full"
          aria-label={title}
        >
          <CarouselContent className="-ml-4">
            {items.map((item) => (
              <CarouselItem key={`${item.type}:${item.id}`} className="basis-70 pl-4 sm:basis-80">
                <ListingCard item={item} onQuickLook={() => onQuickLook(item)} onReport={() => onReport(item)} />
              </CarouselItem>
            ))}
          </CarouselContent>

          <div className="mt-4 flex justify-end gap-1">
            <Button
              variant="outline"
              size="icon-responsive"
              onClick={() => api?.scrollPrev()}
              disabled={!canScrollPrev}
              aria-label={t("scrollPrev", { name: title })}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon-responsive"
              onClick={() => api?.scrollNext()}
              disabled={!canScrollNext}
              aria-label={t("scrollNext", { name: title })}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </Carousel>
      </div>
    </section>
  );
}
