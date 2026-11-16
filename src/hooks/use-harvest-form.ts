"use client";
import { useMemo, useState } from "react";
import { useForm, type DefaultValues, type FieldValues, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { splitFailure, type SubmitFailure } from "@/lib/form";

/**
 * Shared form plumbing: react-hook-form with a zod schema, server and network failures mapped onto fields and an inline form-level message,
 * and `dirty` for the StickySaveBar. Build the schema inside the component with catalogue messages (never raw strings). Validation runs on
 * blur and then on change, and the first invalid field is focused on submit. The handler returns nothing on success or a `SubmitFailure`
 * (field messages and/or one message); a thrown error shows the generic connection message.
 */
export function useHarvestForm<Schema extends z.ZodObject>(schema: Schema, defaultValues: DefaultValues<z.input<Schema>>) {
  type Input = z.input<Schema> & FieldValues;
  const t = useTranslations("ComponentsForm");
  const form = useForm<Input, unknown, z.output<Schema>>({ resolver: zodResolver(schema) as never, defaultValues: defaultValues as DefaultValues<Input>, mode: "onTouched" });
  const [formError, setFormError] = useState<string | null>(null);
  const known = useMemo(() => Object.keys(schema.shape), [schema]);
  const { handleSubmit, setError, formState: { isDirty, isSubmitting } } = form;

  /** Returns the `onSubmit` for a form element. */
  function submit(onValid: (values: z.output<Schema>) => Promise<SubmitFailure | void> | SubmitFailure | void) {
    return handleSubmit(async (values) => {
      setFormError(null);
      try {
        const failure = await onValid(values);
        if (!failure) return;
        const { fields, form: message } = splitFailure(failure, known);
        for (const [name, text] of Object.entries(fields)) setError(name as never, { type: "server", message: text });
        setFormError(message ?? (Object.keys(fields).length ? t("fixHighlighted") : t("couldNotSave")));
      } catch { setFormError(t("couldNotConnect")); }
    }, () => setFormError(t("fixHighlighted")));
  }
  return { form: form as UseFormReturn<Input, unknown, z.output<Schema>>, submit, formError, setFormError, dirty: isDirty, submitting: isSubmitting };
}
