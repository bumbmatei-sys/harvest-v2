/** Derived from Shadcn UI Kit item product-list5 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Discover redesign, PR #338). Local changes: docs/ui-sources.md. */
"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Chip = { id: string; label: string; active: boolean; count?: number; href?: string; onSelect?: () => void };

/**
 * A labelled row of filter chips (type, category or price). Chips with an `href` are links (the page URL is the state); the others are toggle buttons. The row scrolls
 * sideways on a phone and wraps from 1024px.
 */
export function ChipRow({ label, chips, className }: { label: string; chips: Chip[]; className?: string }) {
  return (
    <nav
      className={cn("-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0 [&::-webkit-scrollbar]:hidden", className)}
      aria-label={label}
    >
      <span aria-hidden="true" className="text-muted-foreground me-1 shrink-0 text-xs">{label}</span>
      {chips.map((chip) => chip.href
        ? <Button
          key={chip.id}
          variant={chip.active ? "default" : "outline"}
          size="responsive"
          className="shrink-0 rounded-full"
          asChild
        >
          <Link href={chip.href} prefetch={false} aria-current={chip.active ? "page" : undefined}>
            {chip.label}
            {chip.count !== undefined && <span className={cn("text-xs", !chip.active && "text-muted-foreground")}>{chip.count}</span>}
          </Link>
        </Button>
        : <Button
          key={chip.id}
          type="button"
          variant={chip.active ? "default" : "outline"}
          size="responsive"
          aria-pressed={chip.active}
          onClick={chip.onSelect}
          className="shrink-0 rounded-full"
        >
          {chip.label}
        </Button>)}
    </nav>
  );
}
