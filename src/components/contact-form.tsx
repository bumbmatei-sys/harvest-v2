"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { contactInput } from "@/lib/contact-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useRequest } from "@/hooks/use-request";

/**
 * Create a person. Editing happens inline on the record page. When opened from a
 * company, the new person is linked to it in the same transaction.
 */
export function ContactForm({ tenantId, company, variant = "default" }: { tenantId: string; company?: { id: string; name: string }; variant?: "default" | "outline" }) {
  const crmRequest = useRequest();
  const t = useTranslations("ComponentsContactForm");
  const router = useRouter();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const { title = "", ...details } = form;
    const parsed = contactInput.safeParse(details);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message && parsed.error.issues[0].code === "custom" ? parsed.error.issues[0].message : t("invalidDetails")); return; }
    setBusy(true);
    const result = await crmRequest<{ id: string }>(`/api/workspaces/${tenantId}/contacts`, { method: "POST", body: company ? { ...parsed.data, companyId: company.id, title: title.trim() } : parsed.data }, "ComponentsContactForm.couldNotSaveThisContactTryAgain");
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setOpen(false);
    if (company) router.refresh(); else router.push(`/workspaces/${tenantId}/crm/people/${result.data.id}`);
  }
  return <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (value) setError(""); }}>
    <DialogTrigger asChild><Button size="responsive" variant={variant}><Plus aria-hidden="true" />{company ? t("newPerson") : t("addContact")}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[460px]">
      <DialogHeader><DialogTitle>{company ? t("addAPersonAtCompany", { company: company.name }) : t("addAContact")}</DialogTitle><DialogDescription>{t("keepTheDetailsThatHelpYouStayConnected")}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Field className="gap-2"><FieldLabel htmlFor="contact-name">{t("fullName")}</FieldLabel><Input id="contact-name" name="name" required maxLength={100} autoComplete="name" autoFocus /></Field>
        <Field className="gap-2"><FieldLabel htmlFor="contact-email">{t("emailAddress")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel><Input id="contact-email" name="email" type="email" autoComplete="email" maxLength={254} /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field className="gap-2"><FieldLabel htmlFor="contact-phone">{t("phone")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel><Input id="contact-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} placeholder={t("49")} /></Field><Field className="gap-2"><FieldLabel htmlFor="contact-social">{t("socialHandle")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel><Input id="contact-social" name="social" maxLength={100} placeholder={t("handle")} /></Field></div>
        {company && <Field className="gap-2"><FieldLabel htmlFor="contact-title">{t("roleAtCompany", { company: company.name })} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel><Input id="contact-title" name="title" maxLength={100} /></Field>}
        <Field className="gap-2"><FieldLabel htmlFor="contact-notes">{t("notes")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel><Textarea id="contact-notes" name="notes" maxLength={5000} placeholder={t("aLittleContextForYourNextConversation")} /></Field>
        <Separator /><DialogFooter><DialogClose asChild><Button variant="ghost" type="button" disabled={busy}>{t("cancel")}</Button></DialogClose><Button disabled={busy}>{busy ? t("saving") : t("saveContact")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
