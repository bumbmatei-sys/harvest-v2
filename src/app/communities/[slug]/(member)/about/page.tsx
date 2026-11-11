import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { forumContext } from "@/server/community-forum";
import { pageSession } from "@/server/page-session";

export default async function AboutPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await pageSession("personal"), { slug } = await params;
  const ctx = await forumContext(getDb(), session.user.id, slug);
  if (!ctx) redirect(`/communities/${encodeURIComponent(slug)}`);
  const t = await getTranslations("CommunityForum");
  return <section className="mx-auto w-full max-w-3xl space-y-6 p-4 lg:p-6" aria-labelledby="about-title">
    <h2 id="about-title" className="text-xl font-semibold">{t("about")}</h2>
    {ctx.description && <p className="whitespace-pre-line break-words">{ctx.description}</p>}
    {ctx.rulesList.length > 0 && <div className="space-y-2"><h3 className="text-base font-semibold">{t("rules")}</h3>
      <ol className="list-decimal space-y-1 pl-6">{ctx.rulesList.map((rule, i) => <li key={i} className="break-words">{rule}</li>)}</ol></div>}
  </section>;
}
