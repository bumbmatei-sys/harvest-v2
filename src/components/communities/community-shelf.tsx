"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BookOpen, PackageOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { EnrolButton } from "@/components/catalog/enrol-button";
import { ListingCard, type ListingCardItem } from "@/components/discover/listing-card";
import { publicPath, type CatalogKind } from "@/lib/catalog";
import type { ShelfItem } from "@/server/community-shelf";

/**
 * C13 Classroom (courses) and C16 Products (downloads) in the member area. Reuses the Discover ListingCard; the action is the canonical access step:
 * enrol for free on the shelf, then Continue (course lessons) or Open (download files). A shelf link grants nothing by itself.
 */
export function CommunityShelf({ kind, items }: { kind: CatalogKind; items: ShelfItem[] }) {
  const t = useTranslations("CommunityShelf");
  const title = t(kind === "course" ? "classroomTitle" : "productsTitle");
  return <section className="min-w-0 space-y-4 p-4 lg:p-6" aria-labelledby="shelf-title">
    <h2 id="shelf-title" className="text-xl font-semibold">{title}</h2>
    {items.length === 0
      ? <EmptyState icon={kind === "course" ? BookOpen : PackageOpen} title={t(kind === "course" ? "emptyClassroom" : "emptyProducts")} />
      : <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={title}>
        {items.map((item) => <li key={item.id} className="min-w-0"><ShelfCard item={item} /></li>)}
      </ul>}
  </section>;
}

function ShelfCard({ item }: { item: ShelfItem }) {
  const t = useTranslations("CommunityShelf"), page = publicPath(item.kind, item.slug), course = item.kind === "course";
  const card: ListingCardItem = { type: course ? "course" : "product", id: item.id, slug: item.slug, name: item.title, summary: item.summary || null, hostName: "",
    category: null, language: null, audience: null, free: true, pricing: "free", admission: null, updatedAt: "" };
  const action = item.enrolled
    ? <Button asChild className="min-h-11"><Link href={course ? `${page}/learn` : page} prefetch={false} aria-label={t(course ? "continueNamed" : "openNamed", { name: item.title })}>
      {t(course ? "continue" : "open")}</Link></Button>
    : <>
      <Button asChild variant="outline" className="min-h-11"><Link href={page} prefetch={false} aria-label={t("detailsNamed", { name: item.title })}>{t("details")}</Link></Button>
      <EnrolButton slug={item.slug} kind={item.kind} signedIn signInHref={page} ariaLabel={t(course ? "enrolNamed" : "getNamed", { name: item.title })} />
    </>;
  return <ListingCard item={card} status={item.enrolled ? <Badge variant="outline">{t(course ? "enrolled" : "owned")}</Badge> : undefined} action={action} />;
}
