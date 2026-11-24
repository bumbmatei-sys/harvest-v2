"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

type Props = {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; label: string; initial?: string; submitLabel: string; maxLength?: number; required?: boolean;
  onSubmit: (name: string) => Promise<string | void>;
};
function NameForm({ onOpenChange, label, initial = "", submitLabel, maxLength = 80, required = true, onSubmit, busy, setBusy }: Omit<Props, "open" | "title"> & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const t = useTranslations("Docs");
  const [value, setValue] = useState(initial), [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || (required && !value.trim())) return;
    setBusy(true); setError("");
    const result = await onSubmit(value.trim());
    setBusy(false);
    if (typeof result === "string" && result) setError(result); else onOpenChange(false);
  }
  return <form onSubmit={submit} className="space-y-4">
    <div className="space-y-2"><Label htmlFor="docs-name">{label}</Label>
      <Input id="docs-name" className="min-h-11" value={value} maxLength={maxLength} onChange={(e) => setValue(e.target.value)} aria-invalid={Boolean(error)} onFocus={(e) => e.currentTarget.select()} autoFocus /></div>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <DialogFooter className="gap-2">
      <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)} disabled={busy}>{t("cancel")}</Button>
      <Button type="submit" className="min-h-11" disabled={busy || (required && !value.trim())}>{busy && <Spinner />}{submitLabel}</Button>
    </DialogFooter>
  </form>;
}
/** One name field in a dialog: new folder, rename folder, rename doc or page. `onSubmit` returns an error text to keep the dialog open. The form is mounted only while open, so it always starts from `initial`. */
export function NameDialog({ open, onOpenChange, title, ...form }: Props) {
  const [busy, setBusy] = useState(false);
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <NameForm onOpenChange={onOpenChange} busy={busy} setBusy={setBusy} {...form} />
    </DialogContent>
  </Dialog>;
}
