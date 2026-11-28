"use client";
/** Post details on the forum card and post page (27 Nov 2026): photos, location with "Open in maps", feeling and tagged people in the author row, and host-linked items as small cards. Harvest-written on the shared Item, Badge and StatusBadge components; no kit code. */
import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { BookOpen, CalendarDays, ClipboardList, FileText, MapPin, Package, Smile, type LucideIcon } from "lucide-react";

import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { StatusBadge } from "@/components/status-badge";
import { mapsHref } from "@/lib/maps-link";
import type { ForumItemKind } from "@/lib/forum";
import type { ForumPostDetails } from "@/server/community-forum";
import { cn } from "@/lib/utils";

export type PostDetailsData = ForumPostDetails;
export type LinkedItem = ForumPostDetails["linkedItems"][number];

export const itemKindIcon: Record<ForumItemKind, LucideIcon> = { article: FileText, product: Package, course: BookOpen, event: CalendarDays, form: ClipboardList };

export const hasDetails = (d: PostDetailsData | undefined): d is PostDetailsData =>
  Boolean(d && (d.location || d.feeling || d.photos.length || d.mentions.length || d.linkedItems.length));

/** "feeling grateful · with Ruth Adams and Samuel Cole", under the author's name. */
export function PostDetailsByline({ slug, details }: { slug: string; details: PostDetailsData }) {
  const t = useTranslations("CommunityForum"), format = useFormatter();
  if (!details.feeling && !details.mentions.length) return null;
  return <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
    {details.feeling && <span className="inline-flex items-center gap-1"><Smile className="size-3.5" aria-hidden="true" />{t("feelingLine", { feeling: t(`feelings.${details.feeling}`) })}</span>}
    {details.feeling && details.mentions.length > 0 && <span aria-hidden="true">{t("dot")}</span>}
    {details.mentions.length > 0 && <span className="min-w-0 break-words">{t.rich("withPeople", { people: () => format.list(details.mentions.map((m) =>
      <Link key={m.userId} href={`/communities/${slug}/members/${encodeURIComponent(m.userId)}`} prefetch={false} className="font-medium text-foreground hover:underline">{m.name.trim() || t("unnamed")}</Link>), { type: "conjunction" }) })}</span>}
  </span>;
}

/** The location as text with an "Open in maps" link built from it (no embedded map). */
export function PostLocation({ location }: { location: string }) {
  const t = useTranslations("CommunityForum"), href = mapsHref(location);
  return <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
    <MapPin className="text-muted-foreground size-4 shrink-0" aria-hidden="true" /><span className="sr-only">{t("location")}</span>
    <span className="min-w-0 break-words">{location}</span>
    {href && <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline lg:min-h-0">{t("openInMaps")}</a>}
  </p>;
}

/** Photos: one wide, or a two-column grid; the feed shows four with a "+N" on the last. */
export function PostPhotos({ slug, photos, limit, href }: { slug: string; photos: PostDetailsData["photos"]; limit?: number; href?: string }) {
  const t = useTranslations("CommunityForum");
  if (!photos.length) return null;
  const shown = limit ? photos.slice(0, limit) : photos, extra = photos.length - shown.length;
  return <ul aria-label={t("photos")} className={cn("grid gap-1 overflow-hidden rounded-lg ring-1 ring-foreground/5", shown.length > 1 && "grid-cols-2")}>
    {shown.map((photo, i) => {
      const img = <>
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated redirect to a short-lived signed URL; not optimisable */}
        <img src={`/api/communities/${slug}/files/${photo.id}`} alt={t("photoAlt", { n: i + 1, total: photos.length })}
          className={cn("w-full bg-muted object-cover", shown.length === 1 ? "aspect-video" : "aspect-square")} />
        {extra > 0 && i === shown.length - 1 && <span className="absolute inset-0 flex items-center justify-center bg-foreground/60 text-2xl font-semibold text-background" aria-hidden="true">{t("morePhotos", { count: extra })}</span>}
      </>;
      return <li key={photo.id} className={cn("relative", shown.length === 3 && i === 0 && "col-span-2")}>
        {href && extra > 0 && i === shown.length - 1 ? <Link href={href} prefetch={false} aria-label={t("photos")} className="block">{img}</Link> : img}
      </li>;
    })}
  </ul>;
}

function Cover({ src, kind }: { src: string | null; kind: ForumItemKind }) {
  const [failed, setFailed] = useState(false), Icon = itemKindIcon[kind];
  if (!src || failed) return <ItemMedia variant="icon" className="size-11"><Icon aria-hidden="true" /></ItemMedia>;
  // eslint-disable-next-line @next/next/no-img-element -- public or access-checked cover route; not optimisable
  return <ItemMedia variant="image" className="size-11"><img src={src} alt="" onError={() => setFailed(true)} /></ItemMedia>;
}

/** One linked item: cover, title, kind and the price label from data. A removed or hidden item shows "No longer available" and no link. */
export function LinkedItemCard({ item, action }: { item: LinkedItem; action?: React.ReactNode }) {
  const t = useTranslations("CommunityForum");
  const kind = <ItemDescription>{t(`attachKinds.${item.kind}`)}</ItemDescription>;
  if (!item.available) return <Item variant="muted" size="sm" className="min-w-0 flex-nowrap">
    <Cover src={null} kind={item.kind} />
    <ItemContent className="min-w-0"><ItemTitle className="text-muted-foreground">{t("linkUnavailable")}</ItemTitle>{kind}</ItemContent>
    {action && <ItemActions>{action}</ItemActions>}
  </Item>;
  const body = <>
    <Cover src={item.cover} kind={item.kind} />
    <ItemContent className="min-w-0"><ItemTitle className="line-clamp-2 break-words">{item.title}</ItemTitle>{kind}</ItemContent>
    {(item.price === "free" || action) && <ItemActions>{item.price === "free" && <StatusBadge tone="neutral" label={t("priceFree")} />}{action}</ItemActions>}
  </>;
  return action ? <Item variant="outline" size="sm" className="min-w-0 flex-nowrap">{body}</Item>
    : <Item variant="outline" size="sm" className="min-h-11 min-w-0 flex-nowrap" asChild><a href={item.href}>{body}</a></Item>;
}

export function LinkedItemCards({ items }: { items: LinkedItem[] }) {
  const t = useTranslations("CommunityForum");
  if (!items.length) return null;
  return <ul aria-label={t("linkedItems")} className="space-y-2">{items.map((item) => <li key={`${item.kind}:${item.id}`}><LinkedItemCard item={item} /></li>)}</ul>;
}
