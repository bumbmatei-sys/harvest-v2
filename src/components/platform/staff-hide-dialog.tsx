"use client";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

/** Harvest staff: hide something that was reported, with a required reason (shown to the ministry). Shared by the giving and community review screens. */
export function StaffHideDialog({ id, title, reasonLabel, cancelLabel, hideLabel, onClose, onHide }: { id: string; title: string; reasonLabel: string; cancelLabel: string; hideLabel: string;
  onClose: () => void; onHide: (reason: string) => Promise<string | undefined> }) {
  const [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit() {
    if (!reason.trim()) return;
    setBusy(true); setError("");
    const problem = await onHide(reason.trim());
    setBusy(false);
    if (problem) setError(problem);
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
      <DialogHeader><DialogTitle className="break-words">{title}</DialogTitle></DialogHeader>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <Field><FieldLabel htmlFor={id}>{reasonLabel}</FieldLabel>
        <Textarea id={id} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <DialogFooter><Button type="button" variant="outline" size="responsive" disabled={busy} onClick={onClose}>{cancelLabel}</Button>
        <Button type="button" variant="destructive" size="responsive" disabled={busy || !reason.trim()} onClick={() => void submit()}>{hideLabel}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
