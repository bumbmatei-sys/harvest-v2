"use client";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { phoneField, socialField } from "@/lib/contact-input";
import { InlineField } from "./inline-field";

const emailField = z.union([z.email().max(254), z.literal("")]);
function check(schema: z.ZodType, invalid: string) {
  return (value: string) => { const result = schema.safeParse(value); return result.success ? null : (result.error.issues.find((issue) => issue.code === "custom")?.message ?? invalid); };
}

/** Identifier fields. Uniqueness is enforced on save by the tenant-scoped index. */
export function ContactFields({ email, phone, social, icons }: { email: string; phone: string; social: string; icons: Record<"email" | "phone" | "social", React.ReactNode> }) {
  const t = useTranslations("Crm");
  return <div className="space-y-0.5">
    <InlineField field="email" label={t("fields.email")} icon={icons.email} value={email} type="email" maxLength={254} href={email ? `mailto:${email}` : undefined} validate={check(emailField, t("enterAValidEmail"))} />
    <InlineField field="phone" label={t("fields.phone")} icon={icons.phone} value={phone} type="tel" maxLength={40} placeholder={t("phonePlaceholder")} href={phone ? `tel:${phone}` : undefined} validate={check(phoneField, t("checkThisValue"))} />
    <InlineField field="social" label={t("fields.social")} icon={icons.social} value={social} maxLength={100} validate={check(socialField, t("checkThisValue"))} />
  </div>;
}
export function ContactNotes({ value }: { value: string }) {
  const t = useTranslations("Crm");
  return <InlineField field="notes" label={t("fields.notes")} value={value} multiline hideLabel maxLength={5000} emptyLabel={t("addANote")} />;
}
