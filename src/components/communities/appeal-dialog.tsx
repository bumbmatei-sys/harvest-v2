"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useCrmRequest } from "@/components/crm/request";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { moderationLimits } from "@/lib/moderation";

/** C12b: a banned member sends one appeal per ban from their account page. */
export function AppealDialog({ slug, name }: { slug: string; name: string }) {
  const t = useTranslations("Appeal"), request = useCrmRequest(), router = useRouter();
  const [open, setOpen] = useState(false), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    const result = await request("/api/account/community-appeals", { method: "POST", body: { slug, message: message.trim() } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setOpen(false); router.refresh();
  }
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) { setMessage(""); setError(""); } }}>
    <DialogTrigger asChild><Button variant="outline" className="min-h-11 w-full sm:w-auto" aria-label={t("openNamed", { name })}>{t("open")}</Button></DialogTrigger>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>{t("title", { name })}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="space-y-2"><Label htmlFor="appeal-message">{t("message")}</Label>
          <Textarea id="appeal-message" rows={5} value={message} maxLength={moderationLimits.appeal} onChange={(e) => setMessage(e.target.value)} /></div>
      </div>
      <DialogFooter><Button className="min-h-11" disabled={busy || !message.trim()} onClick={() => void submit()}>{t("send")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
