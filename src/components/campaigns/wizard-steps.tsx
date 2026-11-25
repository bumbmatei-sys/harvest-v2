"use client";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { FormSection } from "@/components/form-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { TypeCards } from "@/components/campaigns/type-cards";
import type { WizardForm } from "@/lib/campaign-wizard-form";
import type { EditableStep } from "@/lib/campaign-wizard-form";
import { campaignStructures } from "@/lib/campaigns";
import { timeZoneOptions } from "@/lib/event-form";

export type SetStep = (step: EditableStep, update: (form: WizardForm) => WizardForm, delay?: number) => void;
type StepProps = { form: WizardForm; set: SetStep; disabled: boolean; problems: Record<string, string> };
/** A field-level problem, tied to its control by id so assistive technology reads it with the field. */
function Problem({ id, code }: { id: string; code?: string }) {
  const t = useTranslations("CampaignWizard.problems");
  return code ? <p id={id} role="alert" className="text-sm text-destructive">{t(code)}</p> : null;
}
const described = (id: string, code?: string) => code ? { "aria-invalid": true as const, "aria-describedby": id } : {};
// Text edits wait for a pause before saving; a switch, card or list change saves almost at once.
const TYPING = 800, DISCRETE = 120;

export function TypeStep({ form, set, disabled, problems }: StepProps) {
  const t = useTranslations("CampaignWizard");
  return <div className="space-y-3">
    <h3 id="wizard-type-label" className="sr-only">{t("steps.type")}</h3>
    <TypeCards value={form.type} labelledBy="wizard-type-label" disabled={disabled} onPick={(type) => set("type", (current) => ({ ...current, type }), DISCRETE)} />
    {problems.type && <p role="alert" className="text-sm text-destructive">{t("issues.TYPE_REQUIRED")}</p>}
    {form.type && <p className="text-xs text-muted-foreground">{t("changeType")}</p>}
  </div>;
}

/** Step 2, in the PRD's order: name, description, goal or mission, then the optional cover (its own control, passed in, because it saves on its own). */
export function BasicsStep({ form, set, disabled, problems, cover }: StepProps & { cover?: ReactNode }) {
  const t = useTranslations("CampaignWizard.basics");
  const update = (key: keyof WizardForm["basics"], value: string) => set("basics", (current) => ({ ...current, basics: { ...current.basics, [key]: value } }), TYPING);
  return <div className="space-y-4">
    <Field><FieldLabel htmlFor="campaign-name">{t("name")}</FieldLabel>
      <Input id="campaign-name" className="min-h-11" value={form.basics.name} maxLength={200} required disabled={disabled} onChange={(event) => update("name", event.target.value)} {...described("campaign-name-problem", problems.name)} />
      <Problem id="campaign-name-problem" code={problems.name} /></Field>
    <Field><FieldLabel htmlFor="campaign-description">{t("description")}</FieldLabel>
      <Textarea id="campaign-description" rows={4} value={form.basics.description} maxLength={5000} disabled={disabled} onChange={(event) => update("description", event.target.value)} /></Field>
    <Field><FieldLabel htmlFor="campaign-mission">{t("mission")}</FieldLabel>
      <Textarea id="campaign-mission" rows={3} value={form.basics.mission} maxLength={5000} disabled={disabled} onChange={(event) => update("mission", event.target.value)} /></Field>
    {cover}
  </div>;
}

export function PlaceStep({ form, set, disabled, problems }: StepProps) {
  const t = useTranslations("CampaignWizard.place");
  const update = (key: keyof WizardForm["place"], value: string, delay = TYPING) => set("place", (current) => ({ ...current, place: { ...current.place, [key]: value } }), delay);
  const zones = timeZoneOptions(form.place.timeZone);
  function pickMine() { try { update("timeZone", Intl.DateTimeFormat().resolvedOptions().timeZone, DISCRETE); } catch { /* no time zone available */ } }
  return <div className="space-y-6">
    <FormSection as="fieldset" title={t("structure")}>
      <RadioGroup value={form.place.structure} onValueChange={(value) => update("structure", value, DISCRETE)} disabled={disabled} aria-label={t("structure")} className="grid gap-3 sm:grid-cols-3">
        {campaignStructures.map((value) => <Label key={value} htmlFor={`campaign-structure-${value}`}
          className="flex min-h-11 items-center gap-3 rounded-xl border bg-card p-4 font-normal has-data-[state=checked]:border-primary has-data-[state=checked]:bg-muted/50">
          <RadioGroupItem id={`campaign-structure-${value}`} value={value} />
          <span className="min-w-0 text-sm font-medium">{t(`structures.${value}`)}</span>
        </Label>)}
      </RadioGroup>
    </FormSection>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field><FieldLabel htmlFor="campaign-country">{t("country")}</FieldLabel>
        <Input id="campaign-country" className="min-h-11" value={form.place.country} maxLength={100} autoComplete="country-name" disabled={disabled} onChange={(event) => update("country", event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="campaign-city">{t("cityRegion")}</FieldLabel>
        <Input id="campaign-city" className="min-h-11" value={form.place.cityRegion} maxLength={200} disabled={disabled} onChange={(event) => update("cityRegion", event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="campaign-start">{t("startDate")}</FieldLabel>
        <Input id="campaign-start" type="date" className="min-h-11" value={form.place.startDate} disabled={disabled} onChange={(event) => update("startDate", event.target.value, DISCRETE)} /></Field>
      <Field><FieldLabel htmlFor="campaign-end">{t("endDate")}</FieldLabel>
        <Input id="campaign-end" type="date" className="min-h-11" value={form.place.endDate} min={form.place.startDate || undefined} disabled={disabled} onChange={(event) => update("endDate", event.target.value, DISCRETE)} {...described("campaign-end-problem", problems.endDate)} />
        <Problem id="campaign-end-problem" code={problems.endDate} /></Field>
    </div>
    <Field><FieldLabel htmlFor="campaign-time-zone">{t("timeZone")}</FieldLabel>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-64 [&_[data-slot=native-select-wrapper]]:w-full">
          <NativeSelect id="campaign-time-zone" className="min-h-11" value={form.place.timeZone} disabled={disabled} onChange={(event) => update("timeZone", event.target.value, DISCRETE)} {...described("campaign-zone-problem", problems.timeZone)}>
            <option value="">{t("timeZonePlaceholder")}</option>
            {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </NativeSelect>
        </div>
        <Button type="button" variant="outline" className="min-h-11" disabled={disabled} onClick={pickMine}>{t("useMine")}</Button>
      </div>
      <Problem id="campaign-zone-problem" code={problems.timeZone} /></Field>
  </div>;
}

