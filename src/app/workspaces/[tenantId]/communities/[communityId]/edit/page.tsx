import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { getCommunity, listCategories, listCommunityMembers, listInvites } from "@/server/communities";
import { communitiesEnabled } from "@/server/communities-mode";
import { listApplications } from "@/server/community-applications";
import { AccessError, can } from "@/server/permissions";
import { AccessState } from "@/components/access-state";
import { chatChannelSettings, communityChatEnabled } from "@/server/community-chat";
import { discoverGateOpen, discoverRouteDeps } from "@/server/discover/gate";
import { listMyListings } from "@/server/discover/owner";
import { CommunityEditor } from "@/components/communities/community-editor";
import { communityTakedownFor } from "@/server/community-takedown";
import { freeCatalogEnabled } from "@/server/free-catalog-mode";
import { listCommunityShelf } from "@/server/free-catalog";

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
  const categories = (await listCategories(db, session.user.id, tenantId, communityId).catch(denied)) ?? [];
  const chat = writable && communityChatEnabled() ? await chatChannelSettings(db, session.user.id, tenantId, communityId).catch(denied) : null;
  // The Discover card's listing is read here, so the editor (and its live preview) makes no request of its own on load.
  const discoverOpen = discoverGateOpen();
  const listing = discoverOpen ? (await listMyListings(db, session.user.id, tenantId, discoverRouteDeps()).catch(denied))?.items.find((item) => item.type === "community" && item.id === communityId) : undefined;
  // C13/C16: the ministry's published courses and products with this community's links; changing them needs catalogue rights.
  const shelfItems = freeCatalogEnabled() ? await listCommunityShelf(db, session.user.id, tenantId, communityId).catch(denied) : null;
  const shelf = shelfItems ? { tenantId, items: shelfItems, writable: can(workspace.role, "catalog:manage") } : null;
  // 0137: whether Harvest staff paused it; only owners and admins can read the reason (row security), everyone else reads "not paused".
  const takedown = await communityTakedownFor(db, session.user.id, tenantId, communityId).catch(denied);
  return <CommunityEditor harvestPause={takedown?.hidden ? { reason: takedown.reason } : null} chat={chat} shelf={shelf} initial={community} members={members} invites={invites} applications={applications} categories={categories} host={workspace.name}
    endpoint={`/api/workspaces/${tenantId}/communities/${communityId}`} listHref={`/workspaces/${tenantId}/communities`} writable={writable} discoverTenant={discoverOpen ? tenantId : undefined} discoverListing={listing} />;
}
