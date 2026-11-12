import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { forumContext } from "@/server/community-forum";
import { pageSession } from "@/server/page-session";
import { CommunityShell } from "@/components/communities/community-shell";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

// C09: the member area. Only active members with a valid grant (or a host role) reach it; everyone else gets the
// public page, which answers exactly as it does for anyone (no hint that member content exists).
export default async function MemberLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  if (!communitiesEnabled()) notFound();
  const session = await pageSession("personal"), { slug } = await params;
  const ctx = await forumContext(getDb(), session.user.id, slug);
  if (!ctx) redirect(`/communities/${encodeURIComponent(slug)}`);
  return <CommunityShell slug={ctx.slug} name={ctx.name}>{children}</CommunityShell>;
}
