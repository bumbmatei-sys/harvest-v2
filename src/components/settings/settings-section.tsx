/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/pages/settings/layout.tsx and app/dashboard/(auth)/pages/settings/appearance/page.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One settings section: a card with a short title and one-line description in a label column on the left and the controls on the right from
 * `lg`, stacked below. `stacked` (the Settings pop-up) keeps the stack at every width. Hand-written layout over the shared Card.
 */
export function SettingsSection({ id, title, description, children, stacked = false, level = 2 }: { id: string; title: string; description: string; children: ReactNode; stacked?: boolean; level?: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  return <Card data-testid={`settings-section-${id}`}><CardContent className={cn("grid gap-4", !stacked && "lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-10")}>
    <div className="space-y-1"><Heading id={`${id}-title`} className="text-base font-medium">{title}</Heading><p className="text-sm text-muted-foreground">{description}</p></div>
    <div role="group" aria-labelledby={`${id}-title`} className="min-w-0">{children}</div>
  </CardContent></Card>;
}
