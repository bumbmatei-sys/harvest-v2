"use client";
import { errorMessage } from "@/i18n/messages";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { contactInput } from "@/lib/contact-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { getContact } from "@/server/contacts";
type Contact = Awaited<ReturnType<typeof getContact>>;
export function ContactForm({ tenantId, contact, variant = "default" }: { tenantId: string; contact?: Contact; variant?: "default" | "outline" }) {
  const t = useTranslations("ComponentsContactForm");
  const router = useRouter();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const parsed = contactInput.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) { setError(t("invalidDetails")); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/workspaces/${tenantId}/contacts${contact ? `/${contact.id}` : ""}`, { method: contact ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      if (response.status === 401) { router.replace("/sign-in"); return; }
      const data = await response.json();
      if (!response.ok) { setError(errorMessage(data.error, "ComponentsContactForm.couldNotSaveThisContactTryAgain")); return; }
      setOpen(false);
      if (!contact) router.push(`/workspaces/${tenantId}/contacts/${data.id}`);
      router.refresh();
    } catch { setError(t("couldNotConnectPleaseTryAgain")); }
    finally { setBusy(false); }
  }
  const value = (kind: "email" | "phone" | "social") => contact?.identifiers.find((item) => item.kind === kind)?.value ?? "";
  return <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (value) setError(""); }}>
    <DialogTrigger asChild><Button size="sm" variant={variant}>{contact ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />}{contact ? t("editContact") : t("addContact")}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[460px]">
      <DialogHeader><DialogTitle>{contact ? t("editContact") : t("addAContact")}</DialogTitle><DialogDescription>{t("keepTheDetailsThatHelpYouStayConnected")}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Field className="gap-2"><FieldLabel htmlFor="contact-name">{t("fullName")}</FieldLabel><Input id="contact-name" name="name" required maxLength={100} autoComplete="name" defaultValue={contact?.name} autoFocus /></Field>
        <Field className="gap-2"><FieldLabel htmlFor="contact-email">{t("emailAddress")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel><Input id="contact-email" name="email" type="email" autoComplete="email" maxLength={254} defaultValue={value("email")} /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field className="gap-2"><FieldLabel htmlFor="contact-phone">{t("phone")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel><Input id="contact-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} placeholder={t("49")} defaultValue={value("phone")} /></Field><Field className="gap-2"><FieldLabel htmlFor="contact-social">{t("socialHandle")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel><Input id="contact-social" name="social" maxLength={100} placeholder={t("handle")} defaultValue={value("social")} /></Field></div>
        <Field className="gap-2"><FieldLabel htmlFor="contact-notes">{t("notes")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel><Textarea id="contact-notes" name="notes" maxLength={5000} defaultValue={contact?.notes} placeholder={t("aLittleContextForYourNextConversation")} /></Field>
        <Separator /><DialogFooter><DialogClose asChild><Button variant="ghost" type="button" disabled={busy}>{t("cancel")}</Button></DialogClose><Button disabled={busy}>{busy ? t("saving") : t("saveContact")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
