"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/form-section";
import { Stepper } from "@/components/stepper";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { WizardLayout } from "@/components/wizard-layout";
import { KitFieldExample } from "./kit-field-example";

const stepIds = ["details", "audience", "review"] as const;

function StepperExamples() {
  const t = useTranslations("UiShowcase.forms");
  const steps = stepIds.map(id => ({ id, label: t(`steps.${id}`) }));
  const navSteps = stepIds.map((id, index) => ({ id, label: t(`steps.${id}`), done: index === 0, disabled: index === 2, badge: index === 2 ? t("soon") : undefined }));
  return <div className="space-y-6">
    <div className="space-y-2"><h3 className="text-sm font-medium">{t("stepperTitle")}</h3><div data-example-stepper="wizard"><Stepper steps={steps} current="audience" label={t("stepperLabel")} /></div></div>
    <div className="space-y-2"><h3 className="text-sm font-medium">{t("stepperAllSteps")}</h3><div data-example-stepper="full"><Stepper steps={steps} current="review" label={t("stepperFullLabel")} compact="never" /></div></div>
    <div className="space-y-2"><h3 className="text-sm font-medium">{t("stepperNavTitle")}</h3><div data-example-stepper="nav"><Stepper layout="nav" steps={navSteps} current="audience" label={t("stepperNavLabel")} onSelect={() => undefined} /></div></div>
  </div>;
}

function WizardExample() {
  const t = useTranslations("UiShowcase.forms");
  const [current, setCurrent] = useState<string>("details"), [name, setName] = useState(""), [touched, setTouched] = useState(false), [finished, setFinished] = useState(false);
  const invalid = touched && name.trim().length === 0;
  const steps = stepIds.map(id => ({ id, label: t(`steps.${id}`) }));
  return <div className="space-y-3" data-example-wizard>
    <h3 className="text-sm font-medium">{t("wizardTitle")}</h3>
    {finished ? <Alert role="status"><AlertDescription>{t("wizardDone")}</AlertDescription>
      <Button size="responsive" variant="outline" className="mt-3" onClick={() => { setFinished(false); setCurrent("details"); setName(""); setTouched(false); }}>{t("restart")}</Button></Alert>
      : <WizardLayout steps={steps} current={current} stepsLabel={t("wizardLabel")} onStepChange={setCurrent} error={invalid ? t("wizardError") : undefined}
        validate={id => { if (id !== "details") return true; setTouched(true); return name.trim().length > 0; }} onFinish={() => setFinished(true)}>
        {current === "details" && <Field data-invalid={invalid ? true : undefined}><FieldLabel htmlFor="example-wizard-name">{t("fieldName")}</FieldLabel>
          <Input id="example-wizard-name" className="min-h-11" value={name} aria-invalid={invalid} aria-describedby={invalid ? "example-wizard-name-error" : undefined} onChange={event => setName(event.target.value)} />
          {invalid && <FieldError id="example-wizard-name-error">{t("fieldRequired")}</FieldError>}</Field>}
        {current === "audience" && <p className="text-sm">{t("audienceBody")}</p>}
        {current === "review" && <p className="text-sm">{t("reviewBody", { name })}</p>}
      </WizardLayout>}
  </div>;
}

function SectionExamples() {
  const t = useTranslations("UiShowcase.forms");
  return <div className="space-y-6" data-example-sections>
    <FormSection title={t("sectionStacked")} description={t("sectionDescription")}><KitFieldExample /></FormSection>
    <FormSection divided layout="split" title={t("sectionSplit")} actions={<Button size="responsive" variant="outline">{t("sectionAction")}</Button>}>
      <Field><FieldLabel htmlFor="example-section-city">{t("fieldCity")}</FieldLabel><Input id="example-section-city" className="min-h-11" /></Field></FormSection>
    <FormSection divided as="fieldset" title={t("sectionGroup")}>
      <Field><FieldLabel htmlFor="example-section-first">{t("fieldFirst")}</FieldLabel><Input id="example-section-first" className="min-h-11" /></Field></FormSection>
  </div>;
}

function SaveBarExamples() {
  const t = useTranslations("UiShowcase.forms");
  const [saved, setSaved] = useState(""), [value, setValue] = useState(""), [busy, setBusy] = useState(false), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const dirty = value !== saved;
  function save() { setBusy(true); timer.current = setTimeout(() => { setSaved(value); setBusy(false); }, 700); }
  return <div className="space-y-4">
    <div className="space-y-2" data-example-savebar="live"><h3 className="text-sm font-medium">{t("saveBarLive")}</h3>
      <Field><FieldLabel htmlFor="example-save-title">{t("fieldTitle")}</FieldLabel><Input id="example-save-title" className="min-h-11" value={value} onChange={event => setValue(event.target.value)} /></Field>
      <StickySaveBar guard={false} dirty={dirty} busy={busy} onSave={save} onDiscard={() => setValue(saved)} /></div>
    <div className="grid gap-4 md:grid-cols-3">{(["hidden", "visible", "busy"] as const).map(state => <div key={state} className="space-y-2" data-example-savebar={state}><h3 className="text-sm font-medium">{t(`saveBar.${state}`)}</h3>
      <StickySaveBar guard={false} dirty={state !== "hidden"} busy={state === "busy"} onSave={() => undefined} onDiscard={() => undefined} className="static" /></div>)}</div>
  </div>;
}

export function FormPartsExamples() {
  return <div className="space-y-8"><StepperExamples /><WizardExample /><SectionExamples /><SaveBarExamples /></div>;
}
