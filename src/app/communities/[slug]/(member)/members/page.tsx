import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { memberDirectory } from "@/server/community-forum";
import { pageSession } from "@/server/page-session";
import { communitiesEnabled } from "@/server/communities-mode";
import { orPublicPage } from "@/server/community-member-page";
import { Badge } from "@/components/ui/badge";

// C09: members of the community, names and roles only.
export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!communitiesEnabled()) notFound();
  const session = await pageSession("personal"), { slug } = await params;
  const { members } = await memberDirectory(getDb(), session.user.id, slug).catch(orPublicPage(slug));
  const t = await getTranslations("CommunityForum"), roles = await getTranslations("CommunityEditor.roles"), format = await getFormatter();
  return <section className="mx-auto w-full max-w-3xl space-y-4 p-4 lg:p-6" aria-labelledby="members-title">
    <h2 id="members-title" className="text-xl font-semibold">{t("members", { count: members.length })}</h2>
    <ul className="divide-y rounded-lg border">{members.map((m) => <li key={m.userId} className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium" aria-hidden="true">{(m.name.trim() || "?").slice(0, 1).toUpperCase()}</span>
      <span className="min-w-0 flex-1 break-words font-medium">{m.name.trim() || t("unnamed")}</span>
      {m.role !== "member" && <Badge variant="secondary">{roles(m.role as "owner")}</Badge>}
      {m.joinedAt && <span className="text-sm text-muted-foreground">{t("joined", { date: format.dateTime(new Date(m.joinedAt), { dateStyle: "medium" }) })}</span>}
    </li>)}</ul>
  </section>;
}
