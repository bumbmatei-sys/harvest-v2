import { notFound } from "next/navigation";
import { z } from "zod";
import { DmLayout } from "@/components/communities/chat/dm-layout";
import { CommunityShell } from "@/components/communities/community-shell";
import { getDb } from "@/db/client";
import type { DmList } from "@/lib/dm-view";
import { communityCan } from "@/lib/community-permissions";
import { chatStaffPage, communityChatEnabled } from "@/server/community-chat";
import { dmList } from "@/server/community-dm";
import { memberDirectory } from "@/server/community-forum";
import { moderationCount } from "@/server/community-moderation";
import { unreadCount } from "@/server/community-notifications";
import { AccessError } from "@/server/permissions";
import { pageSession } from "@/server/page-session";

export const metadata = { robots: { index: false, follow: false } };
// Keep the composer above the on-screen keyboard instead of letting the keyboard cover it.
export const viewport = { interactiveWidget: "resizes-content" } as const;

export default async function MessagesPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  if (!communityChatEnabled()) notFound();
  const { slug } = await params;
  const conversation = z.uuid().safeParse((await searchParams).c);
  const session = await pageSession("personal");
  const db = getDb(), me = session.user.id;
  const unavailable = (error: unknown): never => {
    if (error instanceof AccessError && error.status === 404) notFound();
    throw error;
  };
  const [staff, forum, list] = await Promise.all([
    chatStaffPage(db, me, slug).catch(unavailable),
    memberDirectory(db, me, slug).catch((error: unknown) => {
      if (error instanceof AccessError && error.status === 404) return undefined;
      throw error;
    }),
    dmList(db, me, slug).catch(unavailable),
  ]);
  const role = staff?.scope.role ?? forum?.context.role;
  if (!role || !communityCan(role, "chat:read") || list.outcome !== "ok" || (!staff && !forum?.context.chatEnabled)) notFound();
  const [unread, moderation] = await Promise.all([
    forum ? unreadCount(db, me, slug) : 0,
    forum?.context.canModerate ? moderationCount(db, me, slug) : null,
  ]);
  const members = staff?.members ?? forum?.members ?? [];
  const name = staff?.scope.name ?? forum?.context.name ?? slug;
  return <CommunityShell slug={slug} name={name} chat chatView moderation={moderation} notifications={forum ? { unread, prefs: forum.context.prefs } : undefined}>
    <DmLayout key={`${me}:${slug}:${conversation.data ?? ""}`} slug={slug} me={me} initial={list as unknown as DmList} initialConversation={conversation.data}
      members={members} host={communityCan(role, "chat:manage_channels")} />
  </CommunityShell>;
}
