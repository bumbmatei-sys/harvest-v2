/** Derived from Shadcn UI Kit item cta2 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Product landing page). Local changes: docs/ui-sources.md. */
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/** The final call to action: the owner's quote, the price line and the button to the buy box (it scrolls there; buying happens in the buy box). */
export function LandingCta({ quote, priceLine, label, href, secondary }: { quote: string; priceLine: string; label: string; href: string; secondary?: { label: string; href: string } }) {
  return (
    <section className="relative w-full overflow-hidden rounded-2xl border px-4 py-16 sm:px-6 sm:py-32 lg:px-8" aria-labelledby="landing-cta">
      <div className="relative z-10 space-y-4 text-center">
        <h2 id="landing-cta" className="text-3xl font-bold text-balance lg:text-4xl/tight">
          {quote}
        </h2>
        <p className="text-muted-foreground lg:text-lg">
          {priceLine}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button size="lg" className="min-h-11" asChild>
            <Link href={href}>{label}</Link>
          </Button>
          {secondary && <Button variant="link" size="lg" className="min-h-11" asChild>
            <Link href={secondary.href}>
              {secondary.label}
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </Button>}
        </div>
      </div>

      <div
        aria-hidden="true"
        className="absolute inset-0 z-0 dark:opacity-15"
        style={{
          backgroundImage: `
        linear-gradient(to right, var(--border) 1px, transparent 1px),
        linear-gradient(to bottom, var(--border) 1px, transparent 1px)
      `,
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 0 0",
          maskImage: `
        repeating-linear-gradient(
              to right,
              black 0px,
              black 3px,
              transparent 3px,
              transparent 8px
            ),
            repeating-linear-gradient(
              to bottom,
              black 0px,
              black 3px,
              transparent 3px,
              transparent 8px
            ),
            radial-gradient(ellipse 70% 60% at 50% 0%, black 60%, transparent 100%)
      `,
          WebkitMaskImage: `
 repeating-linear-gradient(
              to right,
              black 0px,
              black 3px,
              transparent 3px,
              transparent 8px
            ),
            repeating-linear-gradient(
              to bottom,
              black 0px,
              black 3px,
              transparent 3px,
              transparent 8px
            ),
            radial-gradient(ellipse 70% 60% at 50% 0%, black 60%, transparent 100%)
      `,
          maskComposite: "intersect",
          WebkitMaskComposite: "source-in",
        }}
      />
    </section>
  );
}
