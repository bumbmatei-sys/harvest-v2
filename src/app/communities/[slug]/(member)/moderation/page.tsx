import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { heldItems, moderationAppeals, moderationHistory, moderationMembers, moderationQueue } from "@/server/community-moderation";
import { communitiesEnabled } from "@/server/communities-mode";
import { AccessError } from "@/server/permissions";
import { pageSession } from "@/server/page-session";
import { ModerationPanel } from "@/components/communities/moderation-panel";

// C12a: hosts only. Everyone else gets the neutral not-found answer from the services.
export default async function ModerationPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!communitiesEnabled()) notFound();
  const session = await pageSession("personal"), { slug } = await params, db = getDb(), me = session.user.id;
  // Members who are not hosts (and non-members, whom the layout redirects) get not found.
  const notHost = (error: unknown): never => { if (error instanceof AccessError && error.status === 404) notFound(); throw error; };
  const { context, items: queue } = await moderationQueue(db, me, slug).catch(notHost);
  const [held, members, history, appeals] = await Promise.all([heldItems(db, me, slug), moderationMembers(db, me, slug), moderationHistory(db, me, slug), moderationAppeals(db, me, slug)]);
  return <ModerationPanel slug={context.slug} me={me} role={context.role} queue={queue} held={held.items} members={members.members} history={history.entries} appeals={appeals.items} />;
}
