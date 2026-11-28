/** Derived from Shadcn UI Kit item list-block30 (premium), registry retrieved 2026-11-28, approved 2026-11-27 (Account and newsletter screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export type ChecklistItem = { id: string; level: "pass" | "warn" | "fail"; text: string; fix?: { label: string; href?: string; onFix?: () => void } };

/**
 * The checks before scheduling, as the kit's numbered setup list: a passed check shows a tick, a problem keeps its number with a way to fix it.
 * The status line under the title counts what blocks scheduling; the bar shows how many checks pass.
 */
export function ReviewChecklist({ title, status, blocking, progressLabel, items }: {
  title: string; status: string; blocking: number; progressLabel: string; items: ChecklistItem[];
}) {
  const passed = items.filter((item) => item.level === "pass").length;
  const percent = items.length ? Math.round((passed / items.length) * 100) : 0;

  return (
    <Card className="w-full">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle role="heading" aria-level={3}>{title}</CardTitle>
          <CardDescription className="text-xs font-medium" role="status" data-blocking={blocking}>
            {status}
          </CardDescription>
        </div>
        <Progress
          value={percent}
          className="h-1.5"
          aria-label={progressLabel}
        />
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-0.5" data-review-checklist>
          {items.map((item, index) => {
            const done = item.level === "pass";
            const current = item.level === "fail";
            return (
              <li
                key={item.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-lg p-2.5",
                  current && "bg-muted/50",
                )}
                data-item={item.id}
                data-level={item.level}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
                    done && "bg-primary text-primary-foreground border-primary",
                    current && "border-destructive text-destructive",
                    !done && !current && "text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {done ? <Check className="size-3.5" /> : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      done && "text-muted-foreground",
                    )}
                  >
                    {item.text}
                  </p>
                </div>
                {!done && item.fix && (item.fix.href
                  ? <Button asChild size="sm" variant={current ? "default" : "outline"} className="min-h-11" data-fix={item.id}>
                    <Link href={item.fix.href}>{item.fix.label}<ChevronRight data-icon="inline-end" aria-hidden="true" /></Link></Button>
                  : <Button type="button" size="sm" variant={current ? "default" : "outline"} className="min-h-11" data-fix={item.id} onClick={item.fix.onFix}>
                    {item.fix.label}
                    <ChevronRight data-icon="inline-end" aria-hidden="true" />
                  </Button>)}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
