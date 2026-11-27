import { getTranslations } from "next-intl/server";

// Where an invalid, tampered or retired newsletter click link lands. It shows nothing about the ministry, the campaign or the visitor.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("NewsletterLink");
  return { title: t("pageTitle"), robots: { index: false, follow: false } };
}

export default async function NewsletterLinkPage() {
  const t = await getTranslations("NewsletterLink");
  return <main id="main-content" className="mx-auto w-full max-w-xl px-4 py-12">
    <div role="status" className="space-y-2" data-newsletter-link-unavailable>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
    </div>
  </main>;
}
