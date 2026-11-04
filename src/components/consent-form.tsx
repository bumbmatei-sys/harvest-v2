"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
export function ConsentForm({ tenantId, contactId }: { tenantId: string; contactId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workspaces/${tenantId}/contacts/${contactId}/consents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
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
        <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="consent-channel">Channel</Label><Select name="channel" defaultValue="email"><SelectTrigger id="consent-channel" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="email">Email</SelectItem><SelectItem value="sms">SMS</SelectItem><SelectItem value="social">Social</SelectItem></SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="consent-status">Status</Label><Select name="status" defaultValue="unknown"><SelectTrigger id="consent-status" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">Unknown</SelectItem><SelectItem value="granted">Granted</SelectItem><SelectItem value="withdrawn">Withdrawn</SelectItem></SelectContent></Select></div></div>
        <div className="space-y-2"><Label htmlFor="consent-source">Source</Label><Input id="consent-source" name="source" required maxLength={200} placeholder="Where the person shared their choice" /></div>
        <div className="space-y-2"><Label htmlFor="consent-evidence">Evidence</Label><Textarea id="consent-evidence" name="evidence" required maxLength={2000} placeholder="Reference or details supporting this record" /></div>
        <DialogFooter className="border-t pt-4"><DialogClose asChild><Button type="button" variant="ghost" disabled={busy}>Cancel</Button></DialogClose><Button disabled={busy}>{busy ? "Saving…" : "Save consent record"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
