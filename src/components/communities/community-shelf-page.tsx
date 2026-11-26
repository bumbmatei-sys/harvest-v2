import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { freeCatalogEnabled } from "@/server/free-catalog-mode";
import { communityShelf } from "@/server/community-shelf";
import { pageSession } from "@/server/page-session";
import { CommunityShelf } from "@/components/communities/community-shelf";
import type { CatalogKind } from "@/lib/catalog";

/** Server half of the Classroom and Products tabs: someone who may not read the community gets its public page, as on every member tab. */
export async function CommunityShelfPage({ slug, kind }: { slug: string; kind: CatalogKind }) {
  if (!freeCatalogEnabled()) notFound();
  const session = await pageSession("personal");
  const shelf = await communityShelf(getDb(), session.user.id, slug, kind);
  if (!shelf) redirect(`/communities/${encodeURIComponent(slug)}`);
  return <CommunityShelf kind={kind} items={shelf.items} />;
}
