"use client";
/* eslint-disable @next/next/no-img-element */
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { pagedSteps, recall, validateBlock, validateForm, type AnswerError, type FormAnswers, type FormBlock, type FormDefinition } from "@/lib/crm-forms";
import { FormField } from "@/components/forms/form-fields";

/** Token-based looks for the cover, background and button swatches. Colours come from theme tokens, so every theme and both modes work. */
export const coverClass: Record<FormDefinition["cover"], string> = {
  none: "", dawn: "bg-gradient-to-r from-chart-4/50 to-chart-1/40", sea: "bg-gradient-to-r from-chart-2/50 to-chart-3/40", field: "bg-gradient-to-r from-chart-3/50 to-chart-4/30",
  dusk: "bg-gradient-to-r from-chart-5/50 to-chart-2/40", stone: "bg-gradient-to-r from-muted to-accent",
};
export const backgroundClass: Record<FormDefinition["settings"]["background"], string> = {
  plain: "bg-background", muted: "bg-muted", accent: "bg-accent", "chart-1": "bg-chart-1/15", "chart-2": "bg-chart-2/15", "chart-3": "bg-chart-3/15", "chart-4": "bg-chart-4/15", "chart-5": "bg-chart-5/15",
};
export const buttonClass: Record<FormDefinition["settings"]["buttonColor"], string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90", foreground: "bg-foreground text-background hover:bg-foreground/90", "chart-1": "bg-chart-1 text-primary-foreground hover:bg-chart-1/90",
  "chart-2": "bg-chart-2 text-primary-foreground hover:bg-chart-2/90", "chart-3": "bg-chart-3 text-primary-foreground hover:bg-chart-3/90", "chart-4": "bg-chart-4 text-primary-foreground hover:bg-chart-4/90",
  "chart-5": "bg-chart-5 text-primary-foreground hover:bg-chart-5/90", destructive: "bg-destructive text-primary-foreground hover:bg-destructive/90",
};
const wide: readonly FormBlock["type"][] = ["long", "info", "choice", "multi", "upload", "signature", "consent", "rating", "vote"];

/** The form's cover band (nothing for "none"). */
export function FormCover({ cover, className }: { cover: FormDefinition["cover"]; className?: string }) {
  return cover === "none" ? null : <div className={cn("h-28 w-full rounded-xl sm:h-36", coverClass[cover], className)} data-form-cover />;
}

export function FormHeader({ form, answers }: { form: FormDefinition; answers: FormAnswers }) {
  return <header className="space-y-3">
    <FormCover cover={form.cover} />
    {form.logoUrl && <img src={form.logoUrl} alt="" className="size-16 rounded-xl border object-cover" />}
    <h2 className="text-2xl font-semibold tracking-tight">{recall(form.title, form, answers)}</h2>
    {form.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{recall(form.description, form, answers)}</p>}
  </header>;
}

/**
 * The form a respondent sees: one or two columns, or one question per page (progress, Back, Next and Enter). Used by the Preview tab and the Settings
 * canvas today and by the hosted form later. `onSubmit` is optional: in the builder nothing is saved or sent, and the end page says so.
 */
export function PublicForm({ form, ministryName, idPrefix = "pf", onSubmit, preview = true, className, header = true, frameClassName }: {
  form: FormDefinition; ministryName?: string | null; idPrefix?: string; onSubmit?: (answers: FormAnswers) => void | Promise<void>; preview?: boolean; className?: string;
  /** False when the host page shows the title and description itself (the public sign-up page). */
  header?: boolean;
  /** Replaces the default bordered frame classes (the ministry's background still applies). */
  frameClassName?: string;
}) {
  const t = useTranslations("CrmForms.public");
  const { settings } = form;
  const [answers, setAnswers] = useState<FormAnswers>({}), [errors, setErrors] = useState<Record<string, AnswerError>>({});
  const [step, setStep] = useState(-1), [done, setDone] = useState(false), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const paged = settings.layout === "paged";
  const steps = useMemo(() => pagedSteps(form.blocks), [form.blocks]);
  const set = (block: FormBlock, value: string | string[]) => { setAnswers((current) => ({ ...current, [block.id]: value })); setErrors((current) => { const next = { ...current }; delete next[block.id]; return next; }); };
  // Harvest's fixed minimum line sits under the ministry's own consent text. The checkbox is never pre-ticked.
  // A sign-up form carries its own frozen copy of the line, so what a visitor saw never changes when the standard wording does.
  const fixedNotice = form.newsletter?.fixedNotice || t("fixedNotice", { ministry: ministryName?.trim() || t("fixedNoticeFallback") });
  const submitClass = cn("min-h-11 w-full", buttonClass[settings.buttonColor]);

  async function submit() {
    const found = validateForm(form, answers);
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      if (paged) setStep(Math.max(0, steps.findIndex((s) => s.some((b) => b.id === first))));
      requestAnimationFrame(() => document.getElementById(`${idPrefix}-${first}`)?.focus());
      return;
    }
    setBusy(true); setFailed(false);
    try { await onSubmit?.(answers); setDone(true); } catch { setFailed(true); } finally { setBusy(false); }
  }
  function next() {
    const blocks = steps[step] ?? [], found: Record<string, AnswerError> = {};
    for (const block of blocks) { const error = validateBlock(block, answers[block.id]); if (error) found[block.id] = error; }
    setErrors(found);
    if (Object.keys(found).length) return;
    if (step >= steps.length - 1) void submit(); else setStep(step + 1);
  }
  function again() { setAnswers({}); setErrors({}); setStep(-1); setDone(false); }

  const frame = (children: React.ReactNode) => <div className={cn(settings.theme === "dark" && "dark", "rounded-xl", className)}>
    <div className={cn(frameClassName ?? "rounded-xl border p-4 sm:p-8", "text-foreground", backgroundClass[settings.background])} data-public-form data-layout={settings.layout}>
      <div className="mx-auto w-full max-w-2xl space-y-6">{children}</div></div></div>;

  if (done) return frame(<div className="space-y-4" role="status" data-form-done>
    <h2 className="text-2xl font-semibold tracking-tight">{recall(form.endTitle, form, answers)}</h2>
    {form.endBody && <p className="whitespace-pre-line text-sm text-muted-foreground">{recall(form.endBody, form, answers)}</p>}
    {preview && <p className="text-sm text-muted-foreground" data-preview-note>{settings.redirectUrl ? t("previewRedirect", { url: settings.redirectUrl }) : t("previewNothingSaved")}</p>}
    {settings.showResubmit && <Button type="button" variant="outline" className="min-h-11" onClick={again}>{t("resubmit")}</Button>}
  </div>);

  if (paged) {
    const blocks = step >= 0 ? steps[step] ?? [] : [];
    return frame(<>
      {step < 0 ? <div className="space-y-6" data-form-welcome>{header && <FormHeader form={form} answers={answers} />}
        <Button type="button" className={submitClass} onClick={() => setStep(0)}>{settings.startLabel}</Button></div>
        : <form noValidate onSubmit={(event) => { event.preventDefault(); next(); }} className="space-y-6" data-form-step={step + 1}>
          <div className="space-y-2"><Progress value={((step + 1) / steps.length) * 100} aria-label={t("progress", { current: step + 1, total: steps.length })} />
            <p className="text-xs text-muted-foreground">{t("progress", { current: step + 1, total: steps.length })}</p></div>
          <div className="space-y-6" key={step}>{blocks.map((block, i) => <FormField key={block.id} block={block} value={answers[block.id]} onChange={(value) => set(block, value)} error={errors[block.id]} idPrefix={idPrefix} fixedNotice={block.type === "consent" ? fixedNotice : undefined} noticeText={!form.newsletter} autoFocus={i === blocks.length - 1} onEnter={block.type === "long" || block.type === "consent" ? undefined : next} />)}</div>
          {failed && <p role="alert" className="text-sm text-destructive" data-submit-failed>{t("submitFailed")}</p>}
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setStep(step - 1)}><ArrowLeft aria-hidden="true" />{t("back")}</Button>
            <Button type="submit" className={cn("min-h-11", buttonClass[settings.buttonColor])} disabled={busy}>{step >= steps.length - 1 ? settings.buttonLabel : t("next")}{step < steps.length - 1 && <ArrowRight aria-hidden="true" />}</Button>
          </div></form>}
    </>);
  }

  return frame(<form noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }} className="space-y-6">
    {header && <FormHeader form={form} answers={answers} />}
    <div className={cn("grid gap-5", settings.layout === "two" && "sm:grid-cols-2")}>
      {form.blocks.map((block) => <div key={block.id} className={cn("min-w-0", settings.layout === "two" && wide.includes(block.type) && "sm:col-span-2")}>
        <FormField block={block} value={answers[block.id]} onChange={(value) => set(block, value)} error={errors[block.id]} idPrefix={idPrefix} fixedNotice={block.type === "consent" ? fixedNotice : undefined} noticeText={!form.newsletter} /></div>)}
    </div>
    {failed && <p role="alert" className="text-sm text-destructive" data-submit-failed>{t("submitFailed")}</p>}
    <Button type="submit" className={submitClass} disabled={busy}>{settings.buttonLabel}</Button>
  </form>);
}
