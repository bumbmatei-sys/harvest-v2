"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export function EraseContact({ tenantId, contactId }: { tenantId: string; contactId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function erase() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workspaces/${tenantId}/contacts/${contactId}/erase`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "erase" }),
      });
      if (response.status === 401) { router.replace("/sign-in"); return; }
      if (!response.ok) { setError((await response.json()).error ?? "Could not erase this contact. Try again."); return; }
      setOpen(false); router.replace(`/workspaces/${tenantId}/contacts`); router.refresh();
    } catch { setError("Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  return <AlertDialog open={open} onOpenChange={(value) => { if (!busy) { setOpen(value); setError(""); } }}>
    <AlertDialogTrigger asChild><Button variant="ghost" size="sm" className="text-destructive"><Trash2 aria-hidden="true" />Erase contact</Button></AlertDialogTrigger>
    <AlertDialogContent className="rounded-xl bg-card"><AlertDialogHeader><AlertDialogTitle>Erase this contact?</AlertDialogTitle><AlertDialogDescription>This permanently removes their name, identifiers, notes and consent evidence. Only anonymous consent facts remain. This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} variant="destructive" onClick={(event) => { event.preventDefault(); void erase(); }}>{busy ? "Erasing…" : "Erase personal data"}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
