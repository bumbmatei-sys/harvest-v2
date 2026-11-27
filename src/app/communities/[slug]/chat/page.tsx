import { notFound } from "next/navigation";
import { z } from "zod";
import { ChatLayout } from "@/components/communities/chat/chat-layout";
import { CommunityShell } from "@/components/communities/community-shell";
import { getDb } from "@/db/client";
import { chatUnreadTotal } from "@/lib/chat-view";
import { communityCan } from "@/lib/community-permissions";
import { chatManageSettings, chatStaffPage, chatState, communityChatEnabled } from "@/server/community-chat";
import { memberDirectory } from "@/server/community-forum";
import { moderationCount } from "@/server/community-moderation";
import { unreadCount } from "@/server/community-notifications";
import { AccessError } from "@/server/permissions";
import { pageSession } from "@/server/page-session";
import { freeCatalogEnabled } from "@/server/free-catalog-mode";

export const metadata = { robots: { index: false, follow: false } };
// Keep the composer above the on-screen keyboard instead of letting the keyboard cover it.
export const viewport = { interactiveWidget: "resizes-content", viewportFit: "cover" } as const;

export default async function ChatPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ channel?: string }>;
}) {
  if (!communityChatEnabled()) notFound();
  const { slug } = await params;
  const channel = z.uuid().safeParse((await searchParams).channel);
  const session = await pageSession("personal");
  const db = getDb(), me = session.user.id;
  const unavailable = (error: unknown): never => {
    if (error instanceof AccessError && error.status === 404) notFound();
    throw error;
  };
  const [staff, forum, state] = await Promise.all([
    chatStaffPage(db, me, slug).catch(unavailable),
    memberDirectory(db, me, slug).catch((error: unknown) => {
      if (error instanceof AccessError && error.status === 404) return undefined;
      throw error;
    }),
    chatState(db, me, slug).catch(unavailable),
  ]);
  const role = staff?.scope.role ?? forum?.context.role;
  if (!role || !communityCan(role, "chat:read") || !("channels" in state) || (!staff && !forum?.context.chatEnabled)) notFound();
  const [unread, moderation, manage] = await Promise.all([
    forum ? unreadCount(db, me, slug) : 0,
    forum?.context.canModerate ? moderationCount(db, me, slug) : null,
    communityCan(role, "chat:manage_channels") ? chatManageSettings(db, me, slug).catch(unavailable) : undefined,
  ]);
  const access = { role, moderate: communityCan(role, "chat:moderate"), restore: communityCan(role, "chat:restore"), muted: staff?.scope.muted ?? !!forum?.context.mutedUntil };
  const members = staff?.members ?? forum?.members ?? [], hidden = staff?.hidden ?? [];
  const name = staff?.scope.name ?? forum?.context.name ?? slug;
  return <CommunityShell slug={slug} name={name} chat chatView shelf={freeCatalogEnabled()} initialChatUnread={chatUnreadTotal(state.channels)} moderation={moderation} notifications={forum ? { unread, prefs: forum.context.prefs } : undefined}>
    <ChatLayout key={`${me}:${slug}:${channel.data ?? ""}`} slug={slug} me={me} access={access} initial={state.channels} initialChannel={channel.data} members={members} hidden={hidden} manage={manage} initialDmUnread={state.dm?.unreadConversations ?? 0} />
  </CommunityShell>;
}
