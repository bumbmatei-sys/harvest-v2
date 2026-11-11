"use client";
import { useTranslations } from "next-intl";
import { audiences, type Audience } from "@/lib/audience";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

/** Shared ministry-type choice for creating a ministry and for its settings. */
export function AudienceField({ id, value, onChange, disabled, required }: { id: string; value: Audience | null; onChange: (value: Audience) => void; disabled?: boolean; required?: boolean }) {
  const t = useTranslations("ComponentsAudienceField");
  return <div className="space-y-2">
    <p id={`${id}-label`} className="text-sm font-medium">{t("ministryType")}</p>
    <RadioGroup aria-labelledby={`${id}-label`} value={value ?? ""} onValueChange={(next) => onChange(next as Audience)} disabled={disabled} required={required} className="gap-1">
      {audiences.map((audience) => <Label key={audience} htmlFor={`${id}-${audience}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 font-normal hover:bg-muted lg:min-h-9">
        <RadioGroupItem id={`${id}-${audience}`} value={audience} />{t(audience)}
      </Label>)}
    </RadioGroup>
  </div>;
}
