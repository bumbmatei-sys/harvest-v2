import { notFound } from "next/navigation";
import { z } from "zod";
import { ChatLayout } from "@/components/communities/chat/chat-layout";
import { CommunityShell } from "@/components/communities/community-shell";
import { getDb } from "@/db/client";
import { communityCan } from "@/lib/community-permissions";
import { chatState, communityChatEnabled } from "@/server/community-chat";
import { memberDirectory } from "@/server/community-forum";
import { moderationCount } from "@/server/community-moderation";
import { unreadCount } from "@/server/community-notifications";
import { AccessError } from "@/server/permissions";
import { pageSession } from "@/server/page-session";

export const metadata = { robots: { index: false, follow: false } };

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
  const { context, members } = await memberDirectory(db, me, slug).catch(unavailable);
  if (!context.chatEnabled || !communityCan(context.role, "chat:read")) notFound();
  const [state, unread, moderation] = await Promise.all([
    chatState(db, me, slug).catch(unavailable),
    unreadCount(db, me, slug),
    context.canModerate ? moderationCount(db, me, slug) : null,
  ]);
  if (!("channels" in state)) notFound();
  const access = { role: context.role, moderate: communityCan(context.role, "chat:moderate"), restore: communityCan(context.role, "chat:restore"), muted: !!context.mutedUntil };
  return <CommunityShell slug={context.slug} name={context.name} chat chatView moderation={moderation} notifications={{ unread, prefs: context.prefs }}>
    <ChatLayout key={channel.data ?? slug} slug={context.slug} me={me} access={access} initial={state.channels} initialChannel={channel.data} members={members} />
  </CommunityShell>;
}
