import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { MemberProfileView } from "@/components/communities/member-profile-view";
import { communitiesEnabled } from "@/server/communities-mode";
import { communityChatEnabled } from "@/server/community-chat";
import { dmList } from "@/server/community-dm";
import { memberProfile } from "@/server/community-member-profile";
import { AccessError } from "@/server/permissions";
import { pageSession } from "@/server/page-session";

export const metadata = { title: "Member profile", robots: { index: false, follow: false } };

// C09b: a member's profile inside one community. A target the viewer may not see answers the same neutral 404 as an unknown one.
export default async function MemberProfilePage({ params, searchParams }: { params: Promise<{ slug: string; userId: string }>; searchParams: Promise<{ tab?: string; page?: string }> }) {
  if (!communitiesEnabled()) notFound();
  const session = await pageSession("personal"), { slug, userId } = await params, query = await searchParams;
  const db = getDb(), me = session.user.id;
  const profile = await memberProfile(db, me, slug, userId, query.page)
    .catch((error: unknown) => { if (error instanceof AccessError && error.status === 404) notFound(); throw error; });
  const chat = communityChatEnabled() && profile.context.chatEnabled;
  // Own settings: the member-message switch is shown only where private messages exist; the owning service answers it.
  let acceptMembers: boolean | null = null;
  if (profile.self && chat) {
    const list = await dmList(db, me, slug).catch(() => null);
    if (list && list.outcome === "ok" && (list as { policy?: string }).policy === "members") acceptMembers = (list as { acceptMembers?: boolean }).acceptMembers ?? true;
  }
  return <MemberProfileView profile={profile} tab={profile.self && query.tab === "settings" ? "settings" : "activity"} chat={chat}
    prefs={profile.context.prefs} acceptMembers={acceptMembers} me={me} />;
}
