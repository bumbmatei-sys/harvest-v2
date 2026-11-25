/** Layout and behaviour modelled on Shadcn UI Kit items stepper1 and form-layout1 (inside the shared EditorShell), approved by the founder 25 Nov 2026; code written for Harvest, no kit code copied. Notes: docs/ui-sources.md. */
"use client";
import { useTranslations } from "next-intl";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { StatusBadge } from "@/components/status-badge";
import { ObjectiveArt, objectiveIcon } from "@/components/ads/objective-art";
import { buyingTypes, goalsFor, type Draft } from "@/lib/ads/create";
import type { AdGoal } from "@/lib/ads/ads";

/**
 * Step 02, Objective. The buying type on top (auction is the only one the server accepts), then two columns: the objectives as radio rows with an icon tile, and a detail panel with the
 * illustration, a title, one line and "Good for" chips for the chosen objective (a generic explainer before one is chosen). On a phone the detail sits under the list.
 */
export function ObjectiveStep({ draft, set, bad }: { draft: Draft; set: <K extends keyof Draft>(key: K, value: Draft[K]) => void; bad: (field: string) => boolean }) {
  const t = useTranslations("Ads.wizard.objective"), l = useTranslations("Ads");
  const goals = goalsFor(draft.mode), chosen = draft.goal === "" ? null : draft.goal as AdGoal;
  return <div className="flex flex-col gap-6">
    <Field><FieldLabel htmlFor="ads-buying">{t("buying")}</FieldLabel>
      <NativeSelect id="ads-buying" className="min-h-11 w-full sm:w-72" value={draft.buying} onChange={(event) => set("buying", event.target.value as Draft["buying"])}>
        {buyingTypes.map((type) => <option key={type} value={type}>{t(`buyingType.${type}`)}</option>)}</NativeSelect></Field>
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <Field data-invalid={bad("goal") || undefined}><FieldLabel id="ads-objective-label">{t("list")}</FieldLabel>
        <RadioGroup value={draft.goal} onValueChange={(value) => set("goal", value as AdGoal)} aria-labelledby="ads-objective-label" aria-invalid={bad("goal") || undefined} className="gap-2" data-ads-objectives>
          {goals.map((goal) => { const Icon = objectiveIcon[goal]; return <label key={goal} htmlFor={`ads-objective-${goal}`}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-muted/50 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50">
            <RadioGroupItem value={goal} id={`ads-objective-${goal}`} aria-label={l(`goals.${goal}`)} />
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="size-5" /></span>
            <span className="min-w-0 flex-1 text-sm font-medium">{l(`goals.${goal}`)}</span></label>; })}
        </RadioGroup>
        {bad("goal") && <FieldError>{l("wizard.errors.goal")}</FieldError>}</Field>
      <section aria-live="polite" aria-label={t("detail")} data-ads-objective-detail className="flex min-w-0 flex-col items-start gap-3 rounded-xl border bg-card p-4">
        <ObjectiveArt objective={chosen} />
        <h3 className="text-base font-semibold">{chosen ? l(`goals.${chosen}`) : t("genericTitle")}</h3>
        <p className="text-sm text-muted-foreground">{chosen ? t(`items.${chosen}.description`) : t("genericBody")}</p>
        {chosen && <div className="flex flex-col gap-2"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("goodFor")}</p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">{[1, 2, 3].map((n) => <li key={n}><StatusBadge tone="neutral" label={t(`items.${chosen}.good${n}`)} /></li>)}</ul></div>}
      </section>
    </div>
  </div>;
}
