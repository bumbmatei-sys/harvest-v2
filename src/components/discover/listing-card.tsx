/** Derived from Shadcn UI Kit item product-cards8 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Discover redesign, PR #338). Local changes: docs/ui-sources.md. */
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { BookOpen, Ellipsis, Eye, FileText, Flag, MessagesSquare } from "lucide-react";
import type { DiscoverCard } from "@/server/discover/public";
import { categoryIcons, publicHref, typeIcons } from "@/lib/discover-ui";
import type { DiscoverCategory } from "@/lib/discover-ui";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { SaleLine } from "./sale-line";

export type ListingCardItem = Pick<DiscoverCard, "type" | "id" | "slug" | "name" | "summary" | "hostName" | "category" | "language" | "audience" | "free" | "pricing" | "admission" | "updatedAt"> & {
  /** Optional data a surface may carry: a cover image from Harvest's own file route, a formatted price, the old price and the end of a running sale. */
  coverUrl?: string | null; price?: string | null; oldPrice?: string | null; saleEndsAt?: string | null;
};
const admissionKeys = ["open", "apply", "invite", "entitlement"] as const;
const contentIcons = { course: BookOpen, product: FileText, community: MessagesSquare } as const;

/** The type badge and the category mark of a listing, shared by the card and the quick look so both name the type the same way. */
export function ListingMark({ item, className }: { item: Pick<ListingCardItem, "type" | "category">; className?: string }) {
  const t = useTranslations("DiscoverScreens");
  const Type = typeIcons[item.type], Category = item.category ? categoryIcons[item.category as DiscoverCategory] : undefined;
  return <div className={className}>
    <Badge variant="secondary" className="gap-1.5"><Type className="size-3.5" aria-hidden="true" />{t(`typeNames.${item.type}`)}</Badge>
    {item.category && Category && <Badge variant="outline" className="gap-1.5"><Category className="size-3.5" aria-hidden="true" />{t(`categories.${item.category as DiscoverCategory}`)}</Badge>}
  </div>;
}

/** No cover in the data: a token gradient with a dot grid and a small category mark, never a photograph or an invented image. */
export function ListingCoverFallback({ item }: { item: Pick<ListingCardItem, "type" | "category"> }) {
  const Mark = item.category ? categoryIcons[item.category as DiscoverCategory] : typeIcons[item.type];
  return <div aria-hidden="true" className="absolute inset-0 bg-linear-to-br from-primary/20 via-primary/5 to-muted">
    <div className="absolute inset-0 bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[14px_14px] opacity-70" />
    <span className="absolute right-3 bottom-3 flex size-9 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm"><Mark className="size-4" /></span>
  </div>;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");

/**
 * One listing card (community, course or product) on Discover, a community shelf and a link in bio page. Only the public fields the surface passes are shown: the cover is the
 * fallback unless a cover URL is given, the tags come from the listing's type, category and joining route, and the price is Free or Paid unless a price is given. The title covers
 * the card as its link to the public page; Quick look and Report sit in the menu on the cover. A surface with its own next step passes `action` instead of the card link.
 */
export function ListingCard({ item, onQuickLook, onReport, status, action, headingLevel = 3, className }: { item: ListingCardItem; onQuickLook?: () => void; onReport?: () => void;
  /** Extra badges among the tags, such as the viewer's enrolled state on a community shelf. */
  status?: React.ReactNode;
  /** Replaces the whole-card link, for a surface with its own next step (the community classroom and products shelf, the link in bio catalogue). */
  action?: React.ReactNode;
  headingLevel?: 2 | 3; className?: string }) {
  const t = useTranslations("DiscoverScreens");
  const href = publicHref(item), Heading = `h${headingLevel}` as const, Content = contentIcons[item.type];
  const Category = item.category ? categoryIcons[item.category as DiscoverCategory] : undefined;
  const admission = item.type === "community" ? item.admission?.find((a): a is typeof admissionKeys[number] => (admissionKeys as readonly string[]).includes(a)) : undefined;

  return (
    <Card data-slot="listing-card" data-type={item.type} className={cn("relative h-full gap-4 overflow-hidden py-4 pt-0 shadow-none", className)}>
      <figure className="bg-muted relative aspect-video overflow-hidden">
        {item.coverUrl
          // eslint-disable-next-line @next/next/no-img-element -- a same-origin file route: no remote image and no optimizer
          ? <img src={item.coverUrl} alt="" className="size-full object-cover" loading="lazy" />
          : <ListingCoverFallback item={item} />}

        <Badge className="absolute top-3 left-3 z-10">{t(`typeNames.${item.type}`)}</Badge>

        {(onQuickLook || onReport) && <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label={t("moreNamed", { name: item.name })}
              className="bg-background/90 hover:bg-background absolute top-2 right-2 z-10 size-11 rounded-full shadow-sm backdrop-blur-sm lg:top-3 lg:right-3 lg:size-8"
            >
              <Ellipsis className="size-4 text-muted-foreground" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onQuickLook && <DropdownMenuItem className="min-h-11 lg:min-h-8" onSelect={onQuickLook}><Eye aria-hidden="true" />{t("quickLook")}</DropdownMenuItem>}
            {onReport && <DropdownMenuItem className="min-h-11 lg:min-h-8" onSelect={onReport}><Flag aria-hidden="true" />{t("report.button")}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>}
      </figure>

      <CardContent className="flex flex-1 flex-col gap-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="leading-tight">
              <Heading className="line-clamp-2 break-words">
                {href && !action
                  ? <Link
                    href={href}
                    prefetch={false}
                    className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
                  >
                    {item.name}
                  </Link>
                  : item.name}
              </Heading>
            </CardTitle>
          </div>
        </div>

        <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
          <span className="sr-only">{t("includes")}</span>
          <span className="flex items-center gap-1 rounded-md border px-1.5 py-0.5">
            <Content aria-hidden="true" className="size-3.5" />
            {t(`contents.${item.type}`)}
          </span>
          {item.category && Category && <span className="flex items-center gap-1 rounded-md border px-1.5 py-0.5">
            <Category aria-hidden="true" className="size-3.5" />
            {t(`categories.${item.category as DiscoverCategory}`)}
          </span>}
          {admission && <span className="flex items-center gap-1 rounded-md border px-1.5 py-0.5">{t(`admission.${admission}`)}</span>}
          {status && <span className="flex items-center gap-1">{status}</span>}
        </div>

        {item.summary && <p className="text-muted-foreground line-clamp-2 text-sm break-words">{item.summary}</p>}
        {item.saleEndsAt && item.oldPrice && <SaleLine endsAt={item.saleEndsAt} />}

        <Separator className="mt-auto" />
      </CardContent>

      <CardFooter className="-mt-1 flex-col items-stretch gap-3 px-4">
        <div className="flex w-full items-center justify-between gap-3 text-xs">
          {item.hostName
            ? <div className="flex min-w-0 items-center gap-2">
              <Avatar size="sm" aria-hidden="true"><AvatarFallback>{initials(item.hostName)}</AvatarFallback></Avatar>
              <p className="text-muted-foreground truncate"><span className="sr-only">{t("byLabel")} </span>{item.hostName}</p>
            </div>
            : <span />}
          <p className="flex shrink-0 items-baseline gap-1.5 text-right">
            {item.oldPrice && <><span className="sr-only">{t("oldPrice")}</span><s className="text-muted-foreground">{item.oldPrice}</s></>}
            <span className="text-primary text-sm font-semibold">{item.price ?? (item.free ? t("free") : t("paid"))}</span>
          </p>
        </div>
        {action && <div className="relative z-10 flex flex-wrap items-center gap-2">{action}</div>}
      </CardFooter>
    </Card>
  );
}
