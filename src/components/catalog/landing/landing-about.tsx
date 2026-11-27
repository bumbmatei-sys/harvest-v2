/** Derived from Shadcn UI Kit item feature9 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Product landing page). Local changes: docs/ui-sources.md. */
import { useTranslations } from "next-intl";
import { UserRound } from "lucide-react";

/** About the creator: the large photo (through the public photo route) or a token fallback, the heading and the bio. */
export function LandingAbout({ heading, body, photoSrc, host }: { heading: string; body: string; photoSrc: string | null; host: string }) {
  const t = useTranslations("CatalogLanding.about");
  return (
    <section className="w-full" aria-labelledby="landing-about">
      <div className="space-y-8 lg:space-y-4">
        <div className="grid items-start gap-4 sm:gap-4 lg:grid-cols-2 lg:gap-10">
          <figure className="bg-muted relative aspect-4/3 w-full overflow-hidden rounded-xl">
            {photoSrc
              // eslint-disable-next-line @next/next/no-img-element -- a short signed redirect from the server, not optimisable
              ? <img src={photoSrc} className="absolute inset-0 size-full object-cover" alt={t("photo")} />
              : <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-linear-to-br from-primary/20 via-primary/5 to-muted text-muted-foreground"><UserRound className="size-12" strokeWidth={1.5} /></div>}
          </figure>

          <div className="space-y-4 lg:space-y-6">
            <div className="space-y-2">
              <div className="text-muted-foreground text-xs tracking-wider uppercase">
                <span
                  className="bg-primary me-2 inline-block size-2 rounded-full"
                  aria-hidden="true"
                />
                {t("eyebrow")}
              </div>

              <h2 id="landing-about" className="text-2xl leading-tight font-bold text-balance sm:text-3xl lg:text-4xl/tight">
                {heading || host}
              </h2>
            </div>

            {body && <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line sm:text-base lg:text-lg">
              {body}
            </p>}
          </div>
        </div>
      </div>
    </section>
  );
}
