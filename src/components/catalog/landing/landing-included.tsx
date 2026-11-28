/** Derived from Shadcn UI Kit item feature13 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Product landing page). Local changes: docs/ui-sources.md. */
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

/** "What's included": the owner's list, numbered 01, 02 and so on, in the kit's two-column step grid. */
export function LandingIncluded({ items }: { items: string[] }) {
  const t = useTranslations("CatalogLanding.included");
  return (
    <section className="w-full" aria-labelledby="landing-included">
      <div>
        <header className="mb-8 max-w-2xl">
          <div className="mb-2 flex">
            <Badge variant="outline">{t("badge")}</Badge>
          </div>
          <h2 id="landing-included" className="text-3xl leading-tight font-bold text-balance md:text-4xl">
            {t("title")}
          </h2>
        </header>

        <ol className="grid gap-8 md:grid-cols-2 lg:gap-10">
          {items.map((item, index) => (
            <li key={index} className="flex gap-3 sm:gap-4">
              <div aria-hidden="true" className="text-primary flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium sm:size-12 sm:text-lg">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div className="space-y-1.5 self-center">
                <h3 className="font-medium md:text-lg break-words">{item}</h3>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
