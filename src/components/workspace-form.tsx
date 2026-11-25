"use client";
import { errorMessage } from "@/i18n/messages";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Controller } from "react-hook-form";
import { z } from "zod";
import { useHydrated } from "@/hooks/use-hydrated";
import { useHarvestForm } from "@/hooks/use-harvest-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { AudienceField } from "@/components/audience-field";
import { audiences } from "@/lib/audience";
import { browserTimeZone } from "@/lib/time-zone";
export function WorkspaceForm() {
  const t = useTranslations("ComponentsWorkspaceForm");
  const router = useRouter();
  const hydrated = useHydrated();
  // The type starts empty (null) so a person must choose one; the refine turns "none chosen" into the field message.
  const schema = useMemo(() => z.object({
    name: z.string().trim().min(1, t("nameRequired")).max(100, t("nameTooLong")),
    audience: z.enum(audiences).nullable().refine((value) => value !== null, t("chooseAMinistryType")),
  }), [t]);
  const { form, submit, formError, submitting } = useHarvestForm(schema, { name: "", audience: null });
  const { register, reset, formState: { errors } } = form;
  const busy = submitting;
  const onSubmit = submit(async ({ name, audience }) => {
    const response = await fetch("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, audience, timeZone: browserTimeZone() }) });
    if (response.status === 401) { router.replace("/sign-in"); return; }
    if (!response.ok) return { message: errorMessage((await response.json()).error) };
    reset(); router.refresh();
  });
  return <div className="space-y-6">
    {formError && <Alert variant="destructive" role="alert"><AlertDescription>{formError}</AlertDescription></Alert>}
    <form onSubmit={onSubmit} noValidate><FieldGroup>
      <Field data-invalid={errors.name ? true : undefined}><FieldLabel htmlFor="workspace-name">{t("workspaceName")}</FieldLabel>
        <Input id="workspace-name" required maxLength={100} aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? "workspace-name-error" : undefined} disabled={!hydrated || busy} {...register("name")} />
        {errors.name && <FieldError id="workspace-name-error">{errors.name.message}</FieldError>}</Field>
      <Controller control={form.control} name="audience" render={({ field, fieldState }) => <div className="space-y-2">
        <AudienceField id="new-ministry-audience" value={field.value} onChange={field.onChange} disabled={!hydrated || busy} required />
        {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}</div>} />
      <Field orientation="horizontal"><Button size="responsive" disabled={!hydrated || busy}>{busy ? <><Spinner decorative size="sm" />{t("pleaseWait")}</> : t("createWorkspace")}</Button></Field>
    </FieldGroup></form>
  </div>;
}
