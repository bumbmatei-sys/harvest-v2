"use client";
import { CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { accentVars } from "@/components/accent-icon";
import { CampaignTypeArt } from "@/components/campaigns/campaign-type-art";
import { campaignTypes } from "@/lib/campaigns";
import { cn } from "@/lib/utils";

/**
 * The five campaign types as selectable cards (a radio group). Used by the start page, where picking one begins a draft, and by step 1, where it
 * changes the draft's type. No state of its own: the caller owns the value, the busy flag and what happens on a pick.
 */
export function TypeCards({ value, onPick, disabled, labelledBy }: { value: typeof campaignTypes[number] | null; onPick: (type: typeof campaignTypes[number]) => void; disabled?: boolean; labelledBy: string }) {
  const t = useTranslations("CampaignWizard.types");
  return <div role="radiogroup" aria-labelledby={labelledBy} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {campaignTypes.map((type) => {
      const selected = value === type;
      return <button key={type} type="button" role="radio" aria-checked={selected} disabled={disabled} onClick={() => onPick(type)} style={accentVars("primary")}
        className={cn("group relative flex min-h-11 flex-col overflow-hidden rounded-xl border bg-card text-left shadow-xs outline-none transition-[border-color,box-shadow] hover:border-ring hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
          selected && "border-[color:var(--accent-current)] ring-1 ring-[color:var(--accent-current)] hover:border-[color:var(--accent-current)]")}>
        <CampaignTypeArt type={type} className="border-b" />
        {selected && <span aria-hidden="true" className="absolute top-2.5 right-2.5 flex size-6 items-center justify-center rounded-full bg-background text-[color:var(--accent-current)] shadow-sm"><CircleCheck className="size-5" /></span>}
        <span className="min-w-0 p-4"><span className="block text-sm font-semibold">{t(`${type}.label`)}</span><span className="mt-1 block text-sm text-muted-foreground">{t(`${type}.description`)}</span></span>
      </button>;
    })}
  </div>;
}
