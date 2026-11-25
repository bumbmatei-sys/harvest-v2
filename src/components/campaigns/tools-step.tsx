"use client";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AccentIcon } from "@/components/accent-icon";
import { moduleMarks } from "@/components/campaigns/wizard-icons";
import { campaignTemplates, moduleKeys, type ModuleKey } from "@/lib/campaign-wizard";
import type { CampaignType, WizardForm } from "@/lib/campaign-wizard-form";
import type { SetStep } from "@/components/campaigns/wizard-steps";

/**
 * Step 5: a grid of tool cards, the PRD's 18 modules by name. The ones recommended for the chosen type are marked (the template already selected them when
 * the type was picked). Switching is saved with the rest of the step. The AI Campaign Copilot is listed but not available yet: off, and it cannot be switched on.
 */
export function ToolsStep({ form, set, disabled, type }: { form: WizardForm; set: SetStep; disabled: boolean; type: CampaignType | null }) {
  const t = useTranslations("CampaignWizard"), recommended: readonly ModuleKey[] = type ? campaignTemplates[type].modules : [];
  const toggle = (key: ModuleKey, on: boolean) => set("tools", (current) => ({ ...current, tools: { modules: on ? [...current.tools.modules, key] : current.tools.modules.filter((entry) => entry !== key) } }), 120);
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="group" aria-label={t("steps.tools")}>
    {moduleKeys.map((key) => {
      const later = key === "ai_copilot", on = !later && form.tools.modules.includes(key), name = t(`modules.${key}`);
      return <Label key={key} htmlFor={`tool-${key}`} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border bg-card p-4 font-normal has-data-[state=checked]:border-primary has-data-[state=checked]:bg-muted/50 has-[button:disabled]:opacity-60">
        <span className="flex min-w-0 items-center gap-3"><AccentIcon icon={moduleMarks[key].icon} accent={moduleMarks[key].accent} />
          <span className="flex min-w-0 flex-col items-start gap-1.5"><span className="text-sm font-medium">{name}</span>
            {later ? <Badge variant="outline">{t("tools.comingLater")}</Badge> : recommended.includes(key) && <Badge variant="secondary">{t("tools.recommended")}</Badge>}</span></span>
        <Switch id={`tool-${key}`} checked={on} disabled={disabled || later} aria-label={t("tools.toggle", { name })} onCheckedChange={(next) => toggle(key, next)} />
      </Label>;
    })}
  </div>;
}
