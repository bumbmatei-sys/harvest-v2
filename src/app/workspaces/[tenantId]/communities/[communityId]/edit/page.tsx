import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { getCommunity, listCommunityMembers, listInvites } from "@/server/communities";
import { communitiesEnabled } from "@/server/communities-mode";
import { listApplications } from "@/server/community-applications";
import { AccessError, can } from "@/server/permissions";
import { AccessState } from "@/components/access-state";
import { CommunityEditor } from "@/components/communities/community-editor";

export default async function CommunityEditPage({ params }: { params: Promise<{ tenantId: string; communityId: string }> }) {
  if (!communitiesEnabled()) notFound();
  const session = await pageSession(), { tenantId, communityId } = await params;
  if (!z.uuid().safeParse(tenantId).success || !z.uuid().safeParse(communityId).success) return <AccessState />;
  const db = getDb(), denied = (error: unknown) => { if (error instanceof AccessError) return null; throw error; };
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch(denied);
  if (!workspace) return <AccessState />;
  const community = await getCommunity(db, session.user.id, tenantId, communityId).catch(denied);
  if (!community) return <AccessState />;
  const writable = can(workspace.role, "communities:manage");
  // Only managers see the roster; an access change between the two reads shows an empty roster rather than an error page.
  const members = writable ? (await listCommunityMembers(db, session.user.id, tenantId, communityId).catch(denied)) ?? [] : [];
  const invites = writable ? (await listInvites(db, session.user.id, tenantId, communityId).catch(denied)) ?? [] : [];
  const applications = writable ? (await listApplications(db, session.user.id, tenantId, communityId).catch(denied)) : null;
  return <CommunityEditor initial={community} members={members} invites={invites} applications={applications} host={workspace.name}
    endpoint={`/api/workspaces/${tenantId}/communities/${communityId}`} listHref={`/workspaces/${tenantId}/communities`} writable={writable} />;
}
