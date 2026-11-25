"use client";
import { CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { FormSection } from "@/components/form-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { WizardStep } from "@/lib/campaign-wizard";
import { currencyDigits, currencyOptions, type WizardForm } from "@/lib/campaign-wizard-form";
import type { SetStep } from "@/components/campaigns/wizard-steps";

type Props = { form: WizardForm; set: SetStep; disabled: boolean; problems: Record<string, string>; onEdit: (step: WizardStep) => void };

/** One Yes / No question as two radio cards; "No" is the answer when it is not turned on. */
function YesNo({ id, label, value, disabled, onChange }: { id: string; label: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  const t = useTranslations("CampaignWizard.budget");
  return <FormSection as="fieldset" title={label}>
    <RadioGroup value={value ? "yes" : "no"} onValueChange={(next) => onChange(next === "yes")} disabled={disabled} aria-label={label} className="grid max-w-sm grid-cols-2 gap-3">
      {(["yes", "no"] as const).map((answer) => <Label key={answer} htmlFor={`${id}-${answer}`} className="flex min-h-11 items-center gap-3 rounded-xl border bg-card p-4 font-normal has-data-[state=checked]:border-primary has-data-[state=checked]:bg-muted/50">
        <RadioGroupItem id={`${id}-${answer}`} value={answer} /><span className="text-sm font-medium">{t(answer)}</span></Label>)}
    </RadioGroup>
  </FormSection>;
}

/**
 * Step 6: exactly the PRD's five fields: preferred currency, estimated total budget, enable campaign fundraising, fundraising goal (optional) and allow online
 * donations. Settings only: nothing is collected, no payment provider is contacted and no donation page exists. The goal and online donations need
 * fundraising on and say so while it is off; fundraising also needs its tool on in Campaign Features. Amounts are typed as plain numbers in the currency's own units.
 */
export function BudgetStep({ form, set, disabled, problems, onEdit }: Props) {
  const t = useTranslations("CampaignWizard.budget"), budget = form.budget;
  const update = (patch: Partial<WizardForm["budget"]>, delay = 800) => set("budget", (current) => ({ ...current, budget: { ...current.budget, ...patch } }), delay);
  const names = (() => { try { return new Intl.DisplayNames(undefined, { type: "currency" }); } catch { return null; } })();
  const codes = currencyOptions.includes(budget.currency as never) ? [...currencyOptions] : [budget.currency, ...currencyOptions];
  const digits = currencyDigits(budget.currency), off = !budget.fundraisingEnabled;
  const toolOff = budget.fundraisingEnabled && !form.tools.modules.includes("fundraising_donations");
  const bad = (id: string, code?: string) => code ? { "aria-invalid": true as const, "aria-describedby": id } : {};
  return <div className="max-w-3xl space-y-6">
    <div className="grid gap-4 sm:grid-cols-2">
      <Field><FieldLabel htmlFor="budget-currency">{t("currency")}</FieldLabel>
        <NativeSelect id="budget-currency" className="min-h-11" value={budget.currency} disabled={disabled} onChange={(event) => update({ currency: event.target.value }, 120)}>
          {codes.map((code) => { const name = names?.of(code); return <option key={code} value={code}>{[code, name && name !== code ? name : ""].filter(Boolean).join(" · ")}</option>; })}
        </NativeSelect></Field>
      <Field><FieldLabel htmlFor="budget-estimated">{t("estimated")}</FieldLabel>
        <Input id="budget-estimated" className="min-h-11" inputMode="decimal" autoComplete="off" value={budget.estimated} maxLength={24} disabled={disabled} onChange={(event) => update({ estimated: event.target.value })} {...bad("budget-estimated-problem", problems.estimated)} />
        {problems.estimated && <p id="budget-estimated-problem" role="alert" className="text-sm text-destructive">{t("amountProblem", { digits })}</p>}</Field>
    </div>
    <YesNo id="budget-fundraising" label={t("fundraising")} value={budget.fundraisingEnabled} disabled={disabled}
      onChange={(on) => update(on ? { fundraisingEnabled: true } : { fundraisingEnabled: false, onlineDonations: false, goal: "" }, 120)} />
    <div className="grid gap-4 sm:grid-cols-2">
      <Field><FieldLabel htmlFor="budget-goal">{t("goal")}</FieldLabel>
        <Input id="budget-goal" className="min-h-11" inputMode="decimal" autoComplete="off" value={budget.goal} maxLength={24} disabled={disabled || off} onChange={(event) => update({ goal: event.target.value })} {...bad("budget-goal-problem", problems.goal)} />
        {problems.goal && <p id="budget-goal-problem" role="alert" className="text-sm text-destructive">{t("amountProblem", { digits })}</p>}
        {off && <p className="text-xs text-muted-foreground">{t("needsFundraising")}</p>}</Field>
    </div>
    <div className="space-y-2"><YesNo id="budget-online" label={t("online")} value={budget.onlineDonations} disabled={disabled || off} onChange={(on) => update({ onlineDonations: on }, 120)} />
      {off && <p className="text-xs text-muted-foreground">{t("needsFundraising")}</p>}</div>
    {toolOff && <Alert role="status"><CircleAlert aria-hidden="true" /><AlertDescription className="flex flex-wrap items-center gap-3">{t("toolMissing")}
      <Button type="button" variant="outline" className="min-h-11" onClick={() => onEdit("tools")}>{t("goToTools")}</Button></AlertDescription></Alert>}
    <p className="text-sm text-muted-foreground">{t("nothingCollected")}</p>
  </div>;
}
