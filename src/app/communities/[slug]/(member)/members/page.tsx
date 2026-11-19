import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { memberDirectory } from "@/server/community-forum";
import { pageSession } from "@/server/page-session";
import { communitiesEnabled } from "@/server/communities-mode";
import { orPublicPage } from "@/server/community-member-page";
import { MemberList } from "@/components/communities/member-list";
import { ReportDialog } from "@/components/communities/report-dialog";

// C09: members of the community, names and roles only. Kit PR 7: the shared member list (cards on phones).
export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!communitiesEnabled()) notFound();
  const session = await pageSession("personal"), { slug } = await params;
  const { members } = await memberDirectory(getDb(), session.user.id, slug).catch(orPublicPage(slug));
  const t = await getTranslations("CommunityForum");
  return <section className="min-w-0 space-y-4 p-4 lg:p-6" aria-labelledby="members-title">
    <h2 id="members-title" className="text-xl font-semibold">{t("members", { count: members.length })}</h2>
    <MemberList label={t("members", { count: members.length })} audience="member" unnamedLabel={t("unnamed")}
      members={members.map((m) => ({ id: m.userId, href: `/communities/${slug}/members/${encodeURIComponent(m.userId)}`, name: m.name, role: m.role, joinedAt: m.joinedAt ? new Date(m.joinedAt).toISOString() : null,
        action: m.userId !== session.user.id ? <ReportDialog slug={slug} targetType="member" targetId={m.userId} name={m.name.trim() || t("unnamed")} compact /> : undefined }))} />
  </section>;
}
