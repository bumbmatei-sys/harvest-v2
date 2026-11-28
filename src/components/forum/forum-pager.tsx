/** Derived from Shadcn UI Kit item pagination1 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Community screens). Kit code; local changes: docs/ui-sources.md. */
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";

type PaginationProps = {
  label: string;
  newer: { label: string; href: string | null };
  older: { label: string; href: string | null };
};

/** Newer and Older on the forum feed, as the kit's previous and next pair; an end with no page is shown disabled. */
export function ForumPager({ label, newer, older }: PaginationProps) {
  return (
    <Pagination aria-label={label}>
      <PaginationContent className="w-full justify-between gap-3">
        <PaginationItem>
          <Button
            aria-disabled={newer.href ? undefined : true}
            asChild
            className="bg-card min-h-11 aria-disabled:pointer-events-none aria-disabled:opacity-50"
            role={newer.href ? undefined : "link"}
            variant="outline">
            {newer.href ? <Link href={newer.href} prefetch={false}>
              <ChevronLeftIcon aria-hidden="true" className="-ms-1 opacity-60" size={16} />
              {newer.label}
            </Link> : <a>
              <ChevronLeftIcon aria-hidden="true" className="-ms-1 opacity-60" size={16} />
              {newer.label}
            </a>}
          </Button>
        </PaginationItem>
        <PaginationItem>
          <Button
            aria-disabled={older.href ? undefined : true}
            asChild
            className="bg-card min-h-11 aria-disabled:pointer-events-none aria-disabled:opacity-50"
            role={older.href ? undefined : "link"}
            variant="outline">
            {older.href ? <Link href={older.href} prefetch={false}>
              {older.label}
              <ChevronRightIcon aria-hidden="true" className="-me-1 opacity-60" size={16} />
            </Link> : <a>
              {older.label}
              <ChevronRightIcon aria-hidden="true" className="-me-1 opacity-60" size={16} />
            </a>}
          </Button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
