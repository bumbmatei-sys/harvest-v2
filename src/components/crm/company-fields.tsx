"use client";
import { useTranslations } from "next-intl";
import { Globe } from "lucide-react";
import { normalizeDomain } from "@/lib/crm-input";
import { InlineField } from "./inline-field";

export function CompanyFields({ domain }: { domain: string }) {
  const t = useTranslations("Crm");
  return <InlineField field="domain" label={t("fields.domain")} icon={<Globe aria-hidden="true" />} value={domain} maxLength={300} placeholder={t("domainPlaceholder")}
    href={domain ? `https://${domain}` : undefined} validate={(value) => normalizeDomain(value) === undefined ? t("enterAValidDomain") : null} />;
}
export function CompanyDescription({ value }: { value: string }) {
  const t = useTranslations("Crm");
  return <InlineField field="description" label={t("fields.description")} value={value} multiline hideLabel maxLength={2000} emptyLabel={t("addADescription")} />;
}
