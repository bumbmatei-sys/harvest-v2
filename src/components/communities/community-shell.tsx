"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarDays, Info, LayoutList, Mail, MessagesSquare, Package, ShieldCheck, Users, Wheat } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Member layout for a community (C09). Design follows the Eden reference (icon rail with Chat, Forum, Events, Products,
 * Members, Messages); style is Studio Admin through the shared tokens. On phones the rail becomes a bottom bar.
 */
export function CommunityShell({ slug, name, moderation = null, children }: { slug: string; name: string; moderation?: number | null; children: React.ReactNode }) {
  const t = useTranslations("CommunityShell"), pathname = usePathname(), base = `/communities/${slug}`;
  type Item = { id: string; icon: typeof Info; soon?: true; href?: string; match?: string[]; badge?: number };
  const items: Item[] = [
    { id: "chat", icon: MessagesSquare, soon: true }, { id: "forum", icon: LayoutList, href: `${base}/forum`, match: [`${base}/forum`, `${base}/posts`] },
    { id: "events", icon: CalendarDays, soon: true }, { id: "products", icon: Package, soon: true },
    { id: "members", icon: Users, href: `${base}/members`, match: [`${base}/members`] }, { id: "messages", icon: Mail, soon: true },
    { id: "about", icon: Info, href: `${base}/about`, match: [`${base}/about`] },
    // C12a: hosts only, with open reports plus held items as a badge.
    ...(moderation === null ? [] : [{ id: "moderation", icon: ShieldCheck, href: `${base}/moderation`, match: [`${base}/moderation`], badge: moderation }]),
  ];
  const entry = (item: Item, compact: boolean) => {
    const Icon = item.icon, label = t(`items.${item.id}` as "items.forum");
    const inner = <><span className="relative"><Icon className="size-5" aria-hidden="true" />
      {item.badge ? <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 font-medium text-primary-foreground" aria-hidden="true">{item.badge > 99 ? t("manyItems") : item.badge}</span> : null}</span>
      <span className={cn("text-[11px] leading-tight", compact && "sr-only sm:not-sr-only")}>{label}</span>
      {item.badge ? <span className="sr-only">{t("toReview", { count: item.badge })}</span> : null}</>;
    const classes = "flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-md px-1 py-1.5 text-center";
    if (item.soon || !item.href || !item.match) return <span key={item.id} aria-disabled="true" title={t("comingSoon")} className={cn(classes, "cursor-not-allowed text-muted-foreground/60")}>
      {inner}<span className="sr-only">{t("comingSoon")}</span></span>;
    const active = item.match.some((m) => pathname.startsWith(m));
    return <Link key={item.id} href={item.href} aria-current={active ? "page" : undefined} prefetch={false}
      className={cn(classes, active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>{inner}</Link>;
  };
  return <div className="flex min-h-dvh bg-background">
    <a href="#community-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3">{t("skip")}</a>
    <nav aria-label={t("navigation")} className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col items-center gap-1 border-r p-2 md:flex">
      <Link href="/account/communities" prefetch={false} className="mb-2 flex size-11 items-center justify-center rounded-md hover:bg-muted" aria-label={t("myCommunities")}>
        <Wheat className="size-6" aria-hidden="true" /></Link>
      {items.map((item) => entry(item, false))}
    </nav>
    <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
      <header className="flex min-h-14 items-center gap-3 border-b px-4"><h1 className="min-w-0 truncate text-base font-semibold">{name}</h1></header>
      <main id="community-main" tabIndex={-1} className="min-w-0 flex-1 outline-none">{children}</main>
    </div>
    <nav aria-label={t("navigation")} className="fixed inset-x-0 bottom-0 z-40 grid border-t bg-background px-1 py-1 md:hidden" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => entry(item, true))}
    </nav>
  </div>;
}
