"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { companyInput } from "@/lib/crm-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useCrmRequest } from "./request";

export function CompanyForm({ tenantId, variant = "default" }: { tenantId: string; variant?: "default" | "outline" }) {
  const crmRequest = useCrmRequest();
  const t = useTranslations("Crm");
  const router = useRouter();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [existing, setExisting] = useState("");
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setExisting("");
    const parsed = companyInput.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) { setError(parsed.error.issues.find((issue) => issue.code === "custom")?.message ?? t("checkTheCompanyDetails")); return; }
    setBusy(true);
    const result = await crmRequest<{ id: string }>(`/api/workspaces/${tenantId}/companies`, { method: "POST", body: { ...parsed.data, domain: parsed.data.domain ?? "" } });
    setBusy(false);
    if (!result.ok) { setError(result.error); if (result.details?.existingId) setExisting(String(result.details.existingId)); return; }
    setOpen(false); router.push(`/workspaces/${tenantId}/crm/companies/${result.data.id}`);
  }
  return <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (value) { setError(""); setExisting(""); } }}>
    <DialogTrigger asChild><Button size="sm" variant={variant}><Plus aria-hidden="true" />{t("addCompany")}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[460px]">
      <DialogHeader><DialogTitle>{t("addACompany")}</DialogTitle><DialogDescription>{t("companiesGroupThePeopleYouWorkWith")}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription className="gap-2">{error}{existing && <Link href={`/workspaces/${tenantId}/crm/companies/${existing}`} className="font-medium underline underline-offset-4">{t("openExistingCompany")}</Link>}</AlertDescription></Alert>}
        <Field className="gap-2"><FieldLabel htmlFor="company-name">{t("companyName")}</FieldLabel><Input id="company-name" name="name" required maxLength={100} autoComplete="organization" autoFocus /></Field>
        <Field className="gap-2"><FieldLabel htmlFor="company-domain">{t("domain")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel><Input id="company-domain" name="domain" maxLength={300} inputMode="url" placeholder={t("domainPlaceholder")} aria-describedby="company-domain-help" /><FieldDescription id="company-domain-help">{t("domainHelp")}</FieldDescription></Field>
        <Field className="gap-2"><FieldLabel htmlFor="company-description">{t("description")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel><Textarea id="company-description" name="description" maxLength={2000} /></Field>
        <Separator /><DialogFooter><DialogClose asChild><Button variant="ghost" type="button" disabled={busy}>{t("cancel")}</Button></DialogClose><Button disabled={busy}>{busy ? t("saving") : t("saveCompany")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
