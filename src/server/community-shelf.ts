import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { catalogItems, communityProductLinks, entitlements } from "../db/schema";
import type { CatalogKind } from "../lib/catalog";
import { freeCatalogEnabled } from "./free-catalog-mode";
import { forumContextTx, type ForumContext } from "./community-forum";
import { withUser } from "./tenancy";

export type ShelfItem = { id: string; kind: CatalogKind; slug: string; title: string; summary: string; enrolled: boolean };

/**
 * C13 classroom (courses) and C16 products shelf (downloads): the published items a community shows, for one of its members. The community must be
 * readable by the caller (the forum's test) and every row is read under RLS (migration 0121). A link grants nothing: `enrolled` is the caller's own
 * active free-enrolment grant, and opening an item still goes through the canonical course and product access check. Null when the member may not read the community.
 */
export async function communityShelf(db: Database, userId: string, slug: string, kind: CatalogKind): Promise<{ context: ForumContext; items: ShelfItem[] } | null> {
  if (!freeCatalogEnabled()) return null;
  return withUser(db, userId, async (tx) => {
    const context = await forumContextTx(tx, userId, slug);
    if (!context) return null;
    const enrolled = sql<boolean>`exists (select 1 from ${entitlements} e where e.tenant_id = ${catalogItems.tenantId} and e.catalog_item_id = ${catalogItems.id}
      and e.user_id = ${userId} and e.revoked_at is null and e.valid_from <= now() and (e.valid_until is null or e.valid_until > now()))`;
    const items = await tx.select({ id: catalogItems.id, kind: catalogItems.kind, slug: catalogItems.slug, title: catalogItems.title, summary: catalogItems.summary, enrolled })
      .from(communityProductLinks)
      .innerJoin(catalogItems, and(eq(catalogItems.tenantId, communityProductLinks.tenantId), eq(catalogItems.id, communityProductLinks.itemId)))
      .where(and(eq(communityProductLinks.tenantId, context.tenantId), eq(communityProductLinks.communityId, context.id), eq(catalogItems.kind, kind),
        eq(catalogItems.state, "published"), inArray(catalogItems.visibility, ["listed", "unlisted"])))
      .orderBy(asc(communityProductLinks.position), asc(catalogItems.title), asc(catalogItems.id)).limit(200);
    return { context, items };
  });
}
