import { getTranslations } from "next-intl/server";
import { HostedSignup } from "@/components/newsletter/hosted-signup";

// Public sign-up page for a published newsletter form. It carries no data of its own: the form is fetched from the hosted forms server, which answers 404
// for anything missing, retired or not served in this environment (production), and the page then says so.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("NewsletterForms.hosted");
  return { title: t("pageTitle"), robots: { index: false, follow: false } };
}

export default async function SubscribePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params, query = await searchParams;
  return <main id="main-content" className="w-full"><HostedSignup slug={slug} embed={query.embed === "1"} /></main>;
}
