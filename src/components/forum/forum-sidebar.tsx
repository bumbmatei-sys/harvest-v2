/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/social-media/components/social-media-sidebar.tsx. Harvest changes: the kit's sample menu becomes the forum's categories (links kept in the URL, hosts-only marked) with the composer below, as in the kit; the search box, profile header, settings button, phone sheet and upgrade banner are dropped (no forum search, no sample person); on phones the categories scroll sideways in the same card; catalogue strings. Notes: docs/ui-sources.md. */
import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface NavItem {
  id?: string;
  label: string;
  emoji: string | null;
  hostsOnly: boolean;
  href: string;
  active?: boolean;
}

/** The forum's left column: category links and the "New post" button (the composer is passed in, since it needs the viewer's permissions). */
export function ForumSidebar({ navItems, composer }: { navItems: NavItem[]; composer?: ReactNode }) {
  const t = useTranslations("CommunityForum");
  return (
    <aside className="flex min-w-0 flex-col gap-4 p-0.5">
      <Card className="bg-muted min-w-0 flex-1 py-4">
        <CardContent className="min-w-0 px-4">
          <nav aria-label={t("categories")} className="min-w-0 flex-1">
            <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:space-y-1 lg:overflow-visible lg:pb-0">
              {navItems.map((item) => (
                <li key={item.id ?? "all"} className="shrink-0">
                  <Link
                    href={item.href}
                    prefetch={false}
                    aria-current={item.active ? "page" : undefined}
                    className={cn("flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
                      item.active
                        ? "bg-background text-foreground font-medium shadow-xs"
                        : "text-muted-foreground hover:bg-background/60 hover:text-foreground")}>
                    <div className="flex items-center gap-3">
                      {item.emoji && <span aria-hidden="true">{item.emoji}</span>}
                      <span>{item.label}</span>
                    </div>
                    {item.hostsOnly && <Lock className="size-3.5" aria-label={t("hostsOnly")} />}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {composer}
        </CardContent>
      </Card>
    </aside>
  );
}
