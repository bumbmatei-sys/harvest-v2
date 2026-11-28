"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EnrolButton } from "@/components/catalog/enrol-button";
import { publicPath } from "@/lib/catalog";
import type { ShelfItem } from "@/server/community-shelf";

/**
 * The canonical access step for a shelf item (C13, C16): enrol for free, then Continue (course lessons) or Open (download files).
 * A shelf link grants nothing by itself.
 */
export function ShelfAction({ item }: { item: ShelfItem }) {
  const t = useTranslations("CommunityShelf"), page = publicPath(item.kind, item.slug), course = item.kind === "course";
  if (item.enrolled) return <Button asChild size="responsive"><Link href={course ? `${page}/learn` : page} prefetch={false} aria-label={t(course ? "continueNamed" : "openNamed", { name: item.title })}>
    {t(course ? "continue" : "open")}</Link></Button>;
  return <div className="flex flex-wrap items-start gap-2">
    <Button asChild variant="outline" size="responsive"><Link href={page} prefetch={false} aria-label={t("detailsNamed", { name: item.title })}>{t("details")}</Link></Button>
    <EnrolButton slug={item.slug} kind={item.kind} signedIn signInHref={page} ariaLabel={t(course ? "enrolNamed" : "getNamed", { name: item.title })} />
  </div>;
}

/** Featured and Enrolled (Yours) marks for a shelf item. */
export function ShelfBadges({ item }: { item: ShelfItem }) {
  const t = useTranslations("CommunityShelf"), course = item.kind === "course";
  if (!item.featured && !item.enrolled) return null;
  return <span className="flex flex-wrap gap-1">{item.featured && <Badge>{t("featured")}</Badge>}{item.enrolled && <Badge variant="outline">{t(course ? "enrolled" : "owned")}</Badge>}</span>;
}
