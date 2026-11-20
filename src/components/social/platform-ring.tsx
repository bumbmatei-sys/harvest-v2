"use client";
import { useState } from "react";
import { joinParts } from "@/lib/social/join";
import Link from "next/link";
import { AlertTriangle, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CharacterCount } from "@/lib/social/characters";
import { ringShare, ringTone, type RingTone } from "@/lib/social/composer-state";
import { platformLabels } from "@/lib/social/labels";
import { PlatformLogo } from "@/components/social/platform-logo";
import type { SocialPlatform } from "@/lib/social/platforms";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

const radius = 19, circumference = 2 * Math.PI * radius;
const toneStroke: Record<RingTone, string> = { ok: "stroke-primary", near: "stroke-warning", over: "stroke-destructive", unknown: "stroke-muted-foreground" };

/** The ring alone (also used in rows that only display a platform). `count` is the shared per-platform counter result; nothing here counts. */
export function RingMark({ platform, count, active = true, size = 40, className }: { platform: SocialPlatform; count?: CharacterCount; active?: boolean; size?: number; className?: string }) {
  const tone = count ? ringTone(count) : "unknown", share = count && active ? ringShare(count) : 0;
  return <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }} data-tone={active ? tone : "idle"} aria-hidden="true">
    <svg viewBox="0 0 44 44" className="absolute inset-0 size-full -rotate-90">
      <circle cx="22" cy="22" r={radius} fill="none" strokeWidth="3" className="stroke-border" />
      {active && share > 0 && <circle cx="22" cy="22" r={radius} fill="none" strokeWidth="3" strokeLinecap="round" className={cn("transition-[stroke-dashoffset] duration-200", toneStroke[tone])}
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - share)} />}
    </svg>
    <span className={cn("inline-flex size-[30px] items-center justify-center rounded-full", active ? "bg-selected text-foreground" : "bg-muted text-muted-foreground")}><PlatformLogo platform={platform} className="size-3.5" /></span>
    {active && tone === "over" && <span className="absolute -right-0.5 -top-0.5 inline-flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground"><AlertTriangle className="size-2.5" /></span>}
  </span>;
}

/**
 * A connected account as a progress ring: the logo circle fills as text is written, turns to the warning colour from 85% of the limit and to the
 * danger colour over it, and shows the exact numbers in a popup on hover, keyboard focus or tap (a tap also toggles the account).
 * The number is always written out, so colour is never the only signal.
 */
export function PlatformRing({ platform, accountName, count, selected, disabledReason, onToggle }: {
  platform: SocialPlatform; accountName: string; count: CharacterCount; selected: boolean; disabledReason?: string; onToggle: () => void;
}) {
  const t = useTranslations("SocialPublish.ring"), [open, setOpen] = useState(false);
  const tone = ringTone(count), label = platformLabels[platform];
  const estimate = count.rule === "estimate";
  const numbers = count.limit === null ? t("noLimit", { used: count.used }) : t(estimate ? "usedOfEstimate" : "usedOf", { used: count.used, limit: count.limit });
  const status = count.limit === null ? t("noLimitShort") : count.remaining !== null && count.remaining < 0 ? t("over", { count: -count.remaining }) : t("left", { count: count.remaining ?? 0 });
  return <HoverCard open={open} onOpenChange={setOpen} openDelay={80} closeDelay={80}>
    <HoverCardTrigger asChild>
      <button type="button" role="checkbox" aria-checked={selected} aria-disabled={disabledReason ? true : undefined} data-platform={platform} data-tone={tone}
        onClick={() => { setOpen(true); if (!disabledReason) onToggle(); }}
        className={cn("group/ring relative inline-flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", disabledReason && "opacity-60")}>
        <RingMark platform={platform} count={count} active={selected} />
        <span className="sr-only">{joinParts([label, selected ? numbers : t("notSelected"), disabledReason], ". ")}</span>
      </button>
    </HoverCardTrigger>
    <HoverCardContent className="w-60 space-y-1" side="bottom" collisionPadding={12} data-testid="ring-popup">
      <p className="text-sm font-semibold">{label}<span className="font-normal text-muted-foreground"> {accountName}</span></p>
      <p className="text-lg font-semibold tabular-nums">{numbers}</p>
      <p className={cn("text-xs", tone === "over" ? "font-medium text-destructive" : "text-muted-foreground")}>{status}</p>
      {estimate && <p className="text-xs text-muted-foreground">{t("estimate")}</p>}
      {disabledReason ? <p className="text-xs text-muted-foreground">{disabledReason}</p> : !selected && <p className="text-xs text-muted-foreground">{t("selectHint")}</p>}
    </HoverCardContent>
  </HoverCard>;
}

/** The dashed circle beside the account circles that opens Settings > Social accounts (the founder's first version has the same "+"). */
export function ConnectCircle({ href, label }: { href: string; label: string }) {
  return <Link href={href} prefetch={false} aria-label={label} title={label} data-testid="connect-account"
    className="inline-flex size-11 items-center justify-center rounded-full border border-dashed text-muted-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"><Plus className="size-4" aria-hidden="true" /></Link>;
}
