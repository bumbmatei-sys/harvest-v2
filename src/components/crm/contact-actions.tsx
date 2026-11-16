/** Derived from Shadcn UI Kit item tables21 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 5). Visual reference only; local changes: docs/ui-sources.md. */
import { getTranslations } from "next-intl/server";
import { Mail, Phone } from "lucide-react";
import { mailtoHref, telHref } from "@/lib/copy-text";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";

/**
 * Header quick actions on a person record: write, call and copy the stored email and phone.
 * Presentation only: it shows identifiers the page already reads and sends nothing.
 */
export async function ContactActions({ email, phone }: { email: string; phone: string }) {
  const t = await getTranslations("Crm");
  if (!email && !phone) return null;
  return <ul aria-label={t("quickActions")} className="mt-2 flex flex-wrap items-center gap-2">
    {email && <li className="flex min-w-0 max-w-full items-center rounded-lg border bg-card">
      <Button asChild variant="ghost" size="responsive" className="min-w-0 justify-start rounded-r-none px-3 lg:h-8"><a href={mailtoHref(email)}><Mail aria-hidden="true" /><span className="truncate">{t("emailAction")}</span></a></Button>
      <CopyButton value={email} label={t("copyEmail")} />
    </li>}
    {phone && <li className="flex min-w-0 max-w-full items-center rounded-lg border bg-card">
      <Button asChild variant="ghost" size="responsive" className="min-w-0 justify-start rounded-r-none px-3 lg:h-8"><a href={telHref(phone)}><Phone aria-hidden="true" /><span className="truncate">{t("callAction")}</span></a></Button>
      <CopyButton value={phone} label={t("copyPhone")} />
    </li>}
  </ul>;
}
