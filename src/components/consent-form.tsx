"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { consentNoticeVersions, consentPurposes } from "@/lib/contact-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
export function ConsentForm({ tenantId, contactId }: { tenantId: string; contactId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      data.occurredAt = new Date(`${data.occurredAt}:00Z`).toISOString();
      const response = await fetch(`/api/workspaces/${tenantId}/contacts/${contactId}/consents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (response.status === 401) { router.replace("/sign-in"); return; }
      if (!response.ok) { setError((await response.json()).error ?? "Could not record consent. Try again."); return; }
      setOpen(false); router.refresh();
    } catch { setError("Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (value) setError(""); }}>
    <DialogTrigger asChild><Button variant="outline" size="sm"><Plus aria-hidden="true" />Record consent</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[460px]"><DialogHeader><DialogTitle>Record consent</DialogTitle><DialogDescription>Record the person’s choice and supporting evidence. Each record is kept in the history.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="grid grid-cols-2 gap-4"><Field className="gap-2"><FieldLabel htmlFor="consent-channel">Channel</FieldLabel><Select name="channel" defaultValue="email"><SelectTrigger id="consent-channel" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="email">Email</SelectItem><SelectItem value="sms">SMS</SelectItem><SelectItem value="social">Social</SelectItem></SelectContent></Select></Field>
        <Field className="gap-2"><FieldLabel htmlFor="consent-status">Status</FieldLabel><Select name="status" defaultValue="unknown"><SelectTrigger id="consent-status" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">Unknown</SelectItem><SelectItem value="granted">Granted</SelectItem><SelectItem value="withdrawn">Withdrawn</SelectItem></SelectContent></Select></Field></div>
        <div className="grid grid-cols-2 gap-4"><Field className="gap-2"><FieldLabel htmlFor="consent-purpose">Purpose</FieldLabel><Select name="purpose" defaultValue="marketing"><SelectTrigger id="consent-purpose" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{consentPurposes.map((purpose) => <SelectItem key={purpose} value={purpose}>{purpose.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></Field><Field className="gap-2"><FieldLabel htmlFor="consent-version">Wording version</FieldLabel><Select name="noticeVersion" defaultValue="notice-v1"><SelectTrigger id="consent-version" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{consentNoticeVersions.map((version) => <SelectItem key={version} value={version}>{version}</SelectItem>)}</SelectContent></Select></Field></div>
        <Field className="gap-2"><FieldLabel htmlFor="consent-occurred">Consent occurred at (UTC)</FieldLabel><Input id="consent-occurred" name="occurredAt" type="datetime-local" required defaultValue={new Date().toISOString().slice(0, 16)} /><p className="text-xs text-muted-foreground">When the person made this choice. Recording time and your account are saved separately.</p></Field>
        <Alert><AlertDescription>Use an evidence reference where possible. Avoid names, email addresses and other personal details in source or evidence. Erasing the contact also redacts these fields.</AlertDescription></Alert>
        <Field className="gap-2"><FieldLabel htmlFor="consent-source">Source</FieldLabel><Input id="consent-source" name="source" required maxLength={200} placeholder="Where the person shared their choice" /></Field>
        <Field className="gap-2"><FieldLabel htmlFor="consent-evidence">Evidence</FieldLabel><Textarea id="consent-evidence" name="evidence" required maxLength={2000} placeholder="Reference or details supporting this record" /></Field>
        <Separator /><DialogFooter><DialogClose asChild><Button type="button" variant="ghost" disabled={busy}>Cancel</Button></DialogClose><Button disabled={busy}>{busy ? "Saving…" : "Save consent record"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
