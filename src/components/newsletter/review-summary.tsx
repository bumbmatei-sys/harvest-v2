/** Derived from Shadcn UI Kit item list-block4 (premium), registry retrieved 2026-11-28, approved 2026-11-27 (Account and newsletter screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type SummaryDetail = { key: string; label: string; value: React.ReactNode; live?: boolean };

/** What goes out: a description list of label and value rows, with an optional status badge beside the title. */
export function ReviewSummary({ title, details, status }: { title: string; details: SummaryDetail[]; status?: { label: string; ready: boolean } }) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>{title}</CardTitle>
        {status && <CardAction>
          <Badge variant="outline">
            <span className={cn("size-1.5 rounded-full", status.ready ? "bg-success" : "bg-destructive")} />
            {status.label}
          </Badge>
        </CardAction>}
      </CardHeader>
      <CardContent>
        <dl className="divide-y border-t" data-review-summary>
          {details.map((detail) => (
            <div
              key={detail.key}
              className="grid gap-0.5 py-2 sm:grid-cols-3 sm:items-center sm:gap-4"
            >
              <dt className="text-muted-foreground text-sm">{detail.label}</dt>
              <dd className="flex min-h-7 items-center justify-between gap-2 text-sm font-medium sm:col-span-2">
                <span className="min-w-0 break-words tabular-nums" data-summary={detail.key} aria-live={detail.live ? "polite" : undefined}>{detail.value}</span>
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
