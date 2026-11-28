/** Derived from Shadcn UI Kit item stat-card12 (premium), registry retrieved 2026-11-28, approved 2026-11-27 (Account and newsletter screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import * as React from "react";
import {
  CalendarClock,
  Copy,
  MoreVertical,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type StatusAction = { id: "change" | "cancel" | "duplicate"; label: string; onClick: () => void; disabled?: boolean };

/**
 * The dispatch state of a scheduled or finished email: a state badge, a short line, the scheduled day, time and zone as three figures, the recipients
 * bar, and its actions (icon buttons with tooltips from 640px, a menu on phones). `children` holds the change-time form while it is open.
 */
export function ReviewStatus({ title, state, stateLabel, tone, description, stats, recipients, actions, moreLabel, children }: {
  title: string; state: string; stateLabel: string; tone: "live" | "off" | "warn"; description?: string;
  stats?: { key: string; label: string; value: string }[]; recipients?: { label: string; value: string; percent: number; percentLabel: string; progressLabel: string };
  actions: StatusAction[]; moreLabel: string; children?: React.ReactNode;
}) {
  const icons = { change: CalendarClock, cancel: X, duplicate: Copy } as const;

  return (
    <Card className="w-full" data-dispatch-state={state}>
      <CardHeader>
        <CardTitle role="heading" aria-level={3} className="flex flex-wrap items-center gap-2">
          {title}
          <Badge variant="outline" className="gap-1.5 font-normal">
            <span
              className={cn(
                "size-1.5 rounded-full",
                tone === "live" ? "bg-success" : tone === "warn" ? "bg-warning" : "bg-muted-foreground",
              )}
            />
            {stateLabel}
          </Badge>
        </CardTitle>
        {description && <CardDescription>
          {description}
        </CardDescription>}
        {actions.length > 0 && <CardAction className="flex items-center gap-0.5">
          <TooltipProvider><div className="hidden items-center gap-0.5 sm:flex">
            {actions.map((action) => {
              const Icon = icons[action.id];
              return (
                <Tooltip key={action.id}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-responsive"
                      className="text-muted-foreground"
                      aria-label={action.label}
                      aria-disabled={action.disabled || undefined}
                      onClick={() => { if (!action.disabled) action.onClick(); }}
                    >
                      <Icon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{action.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </div></TooltipProvider>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-responsive"
                className="text-muted-foreground sm:hidden"
                aria-label={moreLabel}
              >
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {actions.map((action) => {
                const Icon = icons[action.id];
                return (
                  <DropdownMenuItem key={action.id} className="min-h-11" disabled={action.disabled} onSelect={action.onClick}>
                    <Icon /> {action.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>}
      </CardHeader>
      {(stats?.length || children) && <CardContent className="flex flex-col gap-4">
        {stats && stats.length > 0 && <dl className="grid grid-cols-3 divide-x">
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0 space-y-1 px-4 first:pl-0">
              <dt className="text-muted-foreground truncate text-xs">
                {stat.label}
              </dt>
              <dd className="text-base font-semibold tracking-tight break-words tabular-nums sm:text-xl" data-scheduled={stat.key}>
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>}
        {children}
      </CardContent>}
      {recipients && <CardFooter className="flex-col items-stretch gap-2 border-t">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{recipients.label}</span>
          <span className="font-medium tabular-nums">
            {recipients.value}
            <span className="text-muted-foreground ml-1.5 font-normal">
              {recipients.percentLabel}
            </span>
          </span>
        </div>
        <Progress
          value={recipients.percent}
          className="h-1.5"
          aria-label={recipients.progressLabel}
        />
      </CardFooter>}
    </Card>
  );
}
