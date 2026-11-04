"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { contactInput } from "@/lib/contact-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { getContact } from "@/server/contacts";
type Contact = Awaited<ReturnType<typeof getContact>>;
export function ContactForm({ tenantId, contact, variant = "default" }: { tenantId: string; contact?: Contact; variant?: "default" | "outline" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const parsed = contactInput.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) { const issue = parsed.error.issues[0]; setError(`${issue.path.join(" ")}: ${issue.message}`); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/workspaces/${tenantId}/contacts${contact ? `/${contact.id}` : ""}`, { method: contact ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      if (response.status === 401) { router.replace("/sign-in"); return; }
      const data = await response.json();
      if (!response.ok) { setError(data.error ?? "Could not save this contact. Try again."); return; }
      setOpen(false);
      if (!contact) router.push(`/workspaces/${tenantId}/contacts/${data.id}`);
      router.refresh();
    } catch { setError("Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  const value = (kind: "email" | "phone" | "social") => contact?.identifiers.find((item) => item.kind === kind)?.value ?? "";
  return <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (value) setError(""); }}>
    <DialogTrigger asChild><Button size="sm" variant={variant}>{contact ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />}{contact ? "Edit contact" : "Add contact"}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[460px]">
      <DialogHeader><DialogTitle>{contact ? "Edit contact" : "Add a contact"}</DialogTitle><DialogDescription>Keep the details that help you stay connected. Adding a contact does not grant marketing consent.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="space-y-2"><Label htmlFor="contact-name">Full name</Label><Input id="contact-name" name="name" required maxLength={100} autoComplete="name" defaultValue={contact?.name} autoFocus /></div>
        <div className="space-y-2"><Label htmlFor="contact-email">Email address <span className="text-xs text-muted-foreground">(optional)</span></Label><Input id="contact-email" name="email" type="email" autoComplete="email" maxLength={254} defaultValue={value("email")} /></div>
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="contact-phone">Phone <span className="text-xs text-muted-foreground">(optional)</span></Label><Input id="contact-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} placeholder="+49…" defaultValue={value("phone")} /></div><div className="space-y-2"><Label htmlFor="contact-social">Social handle <span className="text-xs text-muted-foreground">(optional)</span></Label><Input id="contact-social" name="social" maxLength={100} placeholder="@handle" defaultValue={value("social")} /></div></div>
        <div className="space-y-2"><Label htmlFor="contact-notes">Notes <span className="text-xs text-muted-foreground">(optional)</span></Label><Textarea id="contact-notes" name="notes" maxLength={5000} defaultValue={contact?.notes} placeholder="A little context for your next conversation…" /></div>
        <DialogFooter className="border-t pt-4"><DialogClose asChild><Button variant="ghost" type="button" disabled={busy}>Cancel</Button></DialogClose><Button disabled={busy}>{busy ? "Saving…" : "Save contact"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
