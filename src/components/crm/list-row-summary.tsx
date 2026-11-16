/** Derived from Shadcn UI Kit item tables19 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 5). Visual reference only; local changes: docs/ui-sources.md. */
import { Globe, Mail, Phone, UsersRound, type LucideIcon } from "lucide-react";
import type { StatusTone } from "@/lib/status-tone";
import { StatusBadge } from "@/components/status-badge";

export type RowSummaryLink = { kind: "email" | "phone" | "domain" | "people"; text: string; href: string; label?: string; external?: boolean };
export type RowSummaryData = { status?: { text: string; tone: StatusTone }; links?: RowSummaryLink[] };
const icons: Record<RowSummaryLink["kind"], LucideIcon> = { email: Mail, phone: Phone, domain: Globe, people: UsersRound };

/**
 * Phone card details under a list row's name: the consent status and tappable contact links.
 * Shown only while the grid card is narrower than its first extra column (the grid hides this
 * once it can show the real columns), so a phone reads like a contact card without a second layout.
 * Links are named by their visible text (a label is only for counts that need context) and are 44px tall; each link is its own tab stop, so keyboard users reach them while the grid hides its columns.
 */
export function RowSummary({ data, indent }: { data: RowSummaryData; indent: string }) {
  if (!data.status && !data.links?.length) return null;
  return <div data-row-summary className={`flex flex-wrap items-center gap-x-3 gap-y-0 pb-1 @xl:hidden ${indent}`}>
    {data.status && <StatusBadge tone={data.status.tone} label={data.status.text} dot />}
    {data.links?.map((link) => { const Icon = icons[link.kind]; return <a key={`${link.kind}:${link.href}`} href={link.href} aria-label={link.label} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined}
      className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-1.5 rounded-sm text-xs text-muted-foreground hover:text-foreground hover:underline"><Icon className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{link.text}</span></a>; })}
  </div>;
}
