/** Derived from Shadcn UI Kit item chart69 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Community screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ArrowUpDown, BookOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState } from "@/components/empty-state";
import { ShelfAction, ShelfBadges } from "@/components/communities/shelf-action";
import type { ShelfItem } from "@/server/community-shelf";

type FilterKey = "all" | "enrolled" | "available";
type SortKey = "shelf" | "name";

const filters: FilterKey[] = ["all", "enrolled", "available"];
const sorts: SortKey[] = ["shelf", "name"];

/**
 * C13 Classroom as the kit's course list card: enrolled count, All / Enrolled / Not enrolled, a sort menu and one row per course with its
 * marks and the access step. The shelf order (featured first, then the owner's order) is the default.
 */
export function CommunityClassroom({ items }: { items: ShelfItem[] }) {
  const t = useTranslations("CommunityShelf");
  const [filter, setFilter] = React.useState<FilterKey>("all");
  const [sort, setSort] = React.useState<SortKey>("shelf");
  const title = t("classroomTitle");

  const enrolledCount = items.filter((course) => course.enrolled).length;

  const visible = React.useMemo(() => {
    const list = items.filter((course) => {
      if (filter === "enrolled") return course.enrolled;
      if (filter === "available") return !course.enrolled;
      return true;
    });
    return sort === "name" ? [...list].sort((a, b) => a.title.localeCompare(b.title)) : list;
  }, [items, filter, sort]);

  return (
    <div className="min-w-0 p-4 lg:p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle><h2 id="shelf-title" className="text-xl font-semibold">{title}</h2></CardTitle>
          {items.length > 0 && <CardDescription>
            {t("enrolledSummary", { enrolled: enrolledCount, count: items.length })}
          </CardDescription>}
          {items.length > 1 && <CardAction>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-responsive" aria-label={t("sortCourses")}>
                  <ArrowUpDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuLabel>{t("sortBy")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(value) => setSort(value as SortKey)}
                >
                  {sorts.map((item) => (
                    <DropdownMenuRadioItem key={item} value={item} className="min-h-11 lg:min-h-0">
                      {t(`sorts.${item}`)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>}
        </CardHeader>

        <CardContent className="space-y-4">
          {items.length === 0 ? <EmptyState icon={BookOpen} title={t("emptyClassroom")} /> : <>
            {items.length > 1 && <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              value={filter}
              onValueChange={(value) => value && setFilter(value as FilterKey)}
              className="w-full"
              aria-label={t("filterCourses")}
            >
              {filters.map((item) => (
                <ToggleGroupItem
                  key={item}
                  value={item}
                  className="min-h-11 flex-1 lg:min-h-8"
                >
                  {t(`filters.${item}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>}

            <ul className="divide-y" aria-label={title} aria-live="polite">
              {visible.map((course) => (
                <li key={course.id}>
                  <div
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-sm py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {course.title}
                      </p>
                      {course.summary && <p className="text-muted-foreground truncate text-xs">
                        {course.summary}
                      </p>}
                    </div>
                    <span className="sm:order-last">
                      <ShelfBadges item={course} />
                    </span>
                    <div className="col-span-2 sm:col-span-1">
                      <ShelfAction item={course} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {visible.length === 0 && <p className="text-muted-foreground pt-4 text-center text-sm">{t("noMatches")}</p>}
          </>}
        </CardContent>
      </Card>
    </div>
  );
}
