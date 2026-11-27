"use client";
import type { CatalogKind } from "@/lib/catalog";
import type { ShelfItem } from "@/server/community-shelf";
import { CommunityClassroom } from "@/components/communities/community-classroom";
import { CommunityProducts } from "@/components/communities/community-products";

/**
 * C13 Classroom (courses) and C16 Products (downloads) in the member area. The featured item comes first; hidden items appear only here.
 * Classroom is a list of course rows, Products a grid; each item's action is the canonical access step (ShelfAction).
 */
export function CommunityShelf({ kind, items }: { kind: CatalogKind; items: ShelfItem[] }) {
  return kind === "course" ? <CommunityClassroom items={items} /> : <CommunityProducts items={items} />;
}
