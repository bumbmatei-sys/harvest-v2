/** Derived from Shadcn UI Kit item product-list5 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Community screens). Kit code; local changes: docs/ui-sources.md. */
import Link from "next/link";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";

export type CategoryPill = { key: string; label: string; emoji: string | null; hostsOnly: boolean; href: string; active: boolean };

/**
 * The forum's category filter as the kit's category pills: All posts first, then each category; the chosen one is filled. Each pill is a
 * link (the filter lives in the address), so the page stays shareable and works without JavaScript.
 */
export function CategoryPills({ label, hostsOnlyLabel, categories }: { label: string; hostsOnlyLabel: string; categories: CategoryPill[] }) {
  return (
    <nav
      className="flex flex-wrap gap-1.5"
      aria-label={label}
    >
      {categories.map((category) => (
        <Button
          key={category.key}
          variant={category.active ? "default" : "outline"}
          asChild
          className="min-h-11 rounded-full lg:min-h-9"
        >
          <Link href={category.href} prefetch={false} aria-current={category.active ? "page" : undefined}>
            {category.emoji && <span aria-hidden="true">{category.emoji}</span>}
            {category.label}
            {category.hostsOnly && <Lock className="size-3.5" aria-label={hostsOnlyLabel} />}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
