/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/pages/products/[id]/page.tsx and apps/courses/components/instructor-section.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. The landing sections themselves are kit-derived files under components/catalog/landing/. */
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import "@/components/docs/docs-prose.css";
import { BookOpen } from "lucide-react";
import { getDb } from "@/db/client";
import { optionalSession } from "@/server/page-session";
import { freeCatalogEnabled } from "@/server/free-catalog-mode";
import { getCatalogContent, getPublicCatalogItem } from "@/server/free-catalog";
import { publicLanding } from "@/server/catalog-landing";
import { formatMoney } from "@/lib/catalog-landing";
import { AccessError } from "@/server/permissions";
import { PublicFrame } from "@/components/connect/public-frame";
import { Button } from "@/components/ui/button";
import { RichTextView } from "@/components/rich-text/rich-text-view";
import { LandingAbout } from "@/components/catalog/landing/landing-about";
import { LandingBuyBox } from "@/components/catalog/landing/landing-buy-box";
import { LandingCta } from "@/components/catalog/landing/landing-cta";
import { LandingFaq } from "@/components/catalog/landing/landing-faq";
import { LandingHero, LandingNav } from "@/components/catalog/landing/landing-hero";
import { LandingIncluded } from "@/components/catalog/landing/landing-included";
import { LandingReviews } from "@/components/catalog/landing/landing-reviews";
import { ReviewForm } from "@/components/catalog/landing/review-form";
import { DownloadList } from "@/components/catalog/download-list";
import { EnrolButton } from "@/components/catalog/enrol-button";
import { publicPath, type CatalogKind } from "@/lib/catalog";
import { continueLesson, percentComplete } from "@/lib/course-progress";
import { Progress } from "@/components/ui/progress";
import Link from "next/link";

const missing = (error: unknown) => { if (error instanceof AccessError && error.status === 404) return null; throw error; };

/**
 * The item's metadata, or null when it is not published, archived, or not of this kind. A listed or unlisted item resolves by its exact address; a hidden
 * one only for a signed-in member of a community whose shelf shows it (C13/C16), so it stays invisible to everyone else.
 */
export async function resolvePublicItem(slug: string, kind: CatalogKind) {
  if (!freeCatalogEnabled()) return null;
  const session = await optionalSession();
  const item = await getPublicCatalogItem(getDb(), slug, session?.user.id).catch(missing);
  if (!item) return null;
  if (item.kind !== kind) redirect(publicPath(item.kind, item.slug));
  return item;
}

/**
 * The landing page of a course or download (Product landing page, founder order): creator bar, hero, long sales text, the buy box (a sticky right column on wide
 * screens), what's included, reviews, about the creator, questions, the final call to action and the footer. Everything comes from public.catalog_landing, which
 * answers only while the item is published and visible. Checkout is off: a priced item shows its price with the button turned off; a free item keeps the existing
 * enrol or get step. Signed in, the content read tells whether the person has it: a course then shows progress and a download lists its files.
 */
export async function CatalogPublicPage({ slug, kind }: { slug: string; kind: CatalogKind }) {
  const item = await resolvePublicItem(slug, kind);
  if (!item) notFound();
  const t = await getTranslations("CatalogPublic"), l = await getTranslations("CatalogLanding"), session = await optionalSession();
  const landing = await publicLanding(getDb(), slug, session?.user.id ?? null);
  if (!landing) notFound();
  const content = session ? await getCatalogContent(getDb(), session.user.id, slug).catch(missing) : null;
  const here = publicPath(kind, slug), signIn = `/sign-in?personal=1&next=${encodeURIComponent(here)}`;
  const money = (cents: number) => formatMoney(cents, landing.price?.currency ?? "USD");
  const paid = landing.price !== null, price = landing.price ? money(landing.price.cents) : t("free");
  const oldPrice = landing.price?.oldCents ? money(landing.price.oldCents) : null, saleEndsAt = landing.price?.saleEndsAt ?? null;
  const featured = landing.reviews.find((review) => review.body) ?? null;
  const cta = landing.cta.label || l(paid ? "seeOptions" : "getIt");
  const action = content
    ? kind === "course"
      ? <CourseProgress slug={slug} lessons={content.lessons} completed={content.completed ?? []} />
      : <p className="text-sm text-muted-foreground">{t("owned")}</p>
    : <EnrolButton slug={slug} kind={kind} signedIn={Boolean(session)} signInHref={signIn} />;
  return <PublicFrame personal notice={false} header={<LandingNav host={landing.host} signInHref={session ? null : signIn} />}
    footer={<div className="flex flex-wrap items-center justify-between gap-3"><p className="font-medium text-foreground">{l("footer.creator", { host: landing.host })}</p><p>{l("footer.soldBy", { host: landing.host })}</p></div>}>
    <div className="space-y-16" data-slot="catalog-landing">
      <LandingHero landing={landing} kind={kind} cta={cta} />
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-10">
        {landing.body && <section aria-labelledby="landing-text" className="min-w-0 space-y-4">
          <h2 id="landing-text" className="text-2xl font-semibold tracking-tight">{l("salesText", { kind: kind === "course" ? "course" : "download" })}</h2>
          <RichTextView format="doc" doc={landing.body} className="min-h-0! text-base" />
        </section>}
        {/* On wide screens the box takes no height in the grid (so the text rows keep their own height) and stays in view while the text scrolls. */}
        <aside className="min-w-0 lg:relative lg:col-start-2 lg:row-span-6 lg:row-start-1">
          <div className="lg:absolute lg:inset-0"><div className="lg:sticky lg:top-6">
            <LandingBuyBox title={landing.title} price={price} oldPrice={oldPrice} saleEndsAt={saleEndsAt} paid={paid} action={action} featured={featured}
              included={landing.included} host={landing.host} />
          </div></div>
        </aside>
        {kind === "download" && content && <section aria-labelledby="catalog-files" className="min-w-0 space-y-3"><h2 id="catalog-files" className="text-lg font-semibold">{t("files")}</h2>
          <DownloadList slug={slug} files={content.files} /></section>}
        {landing.included.length > 0 && <div className="min-w-0"><LandingIncluded items={landing.included} /></div>}
        <div className="min-w-0"><LandingReviews reviews={landing.reviews} rating={landing.rating}
          form={landing.viewer.canReview || landing.viewer.review ? <ReviewForm slug={slug} initial={landing.viewer.review} signInHref={null} /> : !session ? <ReviewForm slug={slug} initial={null} signInHref={signIn} /> : undefined} /></div>
        {(landing.about.heading || landing.about.body || landing.about.photo) && <div className="min-w-0"><LandingAbout heading={landing.about.heading} body={landing.about.body}
          photoSrc={landing.about.photo ? `/api/catalog/${slug}/photo` : null} host={landing.host} /></div>}
        {landing.faq.length > 0 && <div className="min-w-0"><LandingFaq faqs={landing.faq} /></div>}
      </div>
      <LandingCta quote={landing.cta.quote || landing.title} priceLine={oldPrice ? l("cta.sale", { price, old: oldPrice }) : price} label={cta} href="#buy" />
    </div>
  </PublicFrame>;
}

/** The enrolled learner's stored progress: a percentage of published lessons and a link to where they left off (or to the first lesson). */
async function CourseProgress({ slug, lessons, completed }: { slug: string; lessons: { id: string }[]; completed: string[] }) {
  const t = await getTranslations("CatalogPublic");
  const done = lessons.filter((lesson) => completed.includes(lesson.id)).length, percent = percentComplete(done, lessons.length);
  const next = continueLesson(lessons, completed), href = `/courses/${slug}/learn${next ? `?lesson=${next}` : ""}`;
  return <>
    <p className="text-sm text-muted-foreground">{t("enrolled")}</p>
    <div className="space-y-2"><Progress value={percent} aria-label={t("percentComplete", { percent })} />
      <p className="text-sm font-medium tabular-nums">{t("percentComplete", { percent })}</p></div>
    <Button asChild className="min-h-11 w-full"><Link href={href}><BookOpen aria-hidden="true" />{t(done > 0 ? "continue" : "start")}</Link></Button>
    <Button asChild variant="outline" className="min-h-11 w-full"><Link href="/account/notes" prefetch={false}>{t("myNotes")}</Link></Button>
  </>;
}
