import { getTranslations } from "next-intl/server";
import { ConfirmSignup } from "@/components/newsletter/confirm-signup";

// The link in a sign-up confirmation message. Opening it only shows a button, so a link scanner cannot confirm for someone; the button posts the
// address and token to the public confirmation endpoint.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("NewsletterForms.confirm");
  return { title: t("pageTitle"), robots: { index: false, follow: false } };
}

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const email = typeof query.email === "string" ? query.email : "", token = typeof query.token === "string" ? query.token : "";
  return <main id="main-content" className="mx-auto w-full max-w-xl px-4 py-12"><ConfirmSignup email={email} token={token} /></main>;
}
