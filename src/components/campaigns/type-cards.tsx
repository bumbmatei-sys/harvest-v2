"use client";
import { Megaphone, Plane, Presentation, HandHeart, Puzzle, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { campaignTypes } from "@/lib/campaigns";
import { cn } from "@/lib/utils";

const icons: Record<typeof campaignTypes[number], LucideIcon> = {
  evangelistic_crusade: Megaphone, mission_trip: Plane, conference: Presentation, local_outreach: HandHeart, custom_project: Puzzle,
};

/**
 * The five campaign types as selectable cards (a radio group). Used by the start page, where picking one begins a draft, and by step 1, where it
 * changes the draft's type. No state of its own: the caller owns the value, the busy flag and what happens on a pick.
 */
export function TypeCards({ value, onPick, disabled, labelledBy }: { value: typeof campaignTypes[number] | null; onPick: (type: typeof campaignTypes[number]) => void; disabled?: boolean; labelledBy: string }) {
  const t = useTranslations("CampaignWizard.types");
  return <div role="radiogroup" aria-labelledby={labelledBy} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {campaignTypes.map((type) => {
      const Icon = icons[type], selected = value === type;
      return <button key={type} type="button" role="radio" aria-checked={selected} disabled={disabled} onClick={() => onPick(type)}
        className={cn("flex min-h-11 items-start gap-3 rounded-xl border bg-card p-4 text-left shadow-xs outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
          selected && "border-primary bg-muted/50")}>
        <span aria-hidden="true" className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg border", selected ? "border-primary bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}><Icon className="size-5" /></span>
        <span className="min-w-0"><span className="block text-sm font-semibold">{t(`${type}.label`)}</span><span className="mt-1 block text-sm text-muted-foreground">{t(`${type}.description`)}</span></span>
      </button>;
    })}
  </div>;
}
