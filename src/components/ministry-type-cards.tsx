/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/pages/settings/appearance/page.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { Church, Globe, HeartHandshake, Sparkles, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { audiences, type Audience } from "@/lib/audience";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const icons: Record<Audience, LucideIcon> = { church: Church, ministry_nonprofit: HeartHandshake, evangelist_missionary: Globe, creator: Sparkles };

/** The ministry type as selectable cards, one icon each. Radios underneath, so keyboard and screen readers work as for any radio group. */
export function MinistryTypeCards({ id, value, onChange, disabled, labelledBy }: { id: string; value: Audience | null; onChange: (value: Audience) => void; disabled?: boolean; labelledBy: string }) {
  const t = useTranslations("ComponentsAudienceField");
  return <RadioGroup aria-labelledby={labelledBy} value={value ?? ""} onValueChange={(next) => onChange(next as Audience)} disabled={disabled} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    {audiences.map((audience) => { const Icon = icons[audience];
      return <Label key={audience} htmlFor={`${id}-${audience}`} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border bg-card p-3 font-medium transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" aria-hidden="true"><Icon className="size-4" /></span>
        <span className="min-w-0 flex-1">{t(audience)}</span>
        <RadioGroupItem id={`${id}-${audience}`} value={audience} />
      </Label>; })}
  </RadioGroup>;
}
