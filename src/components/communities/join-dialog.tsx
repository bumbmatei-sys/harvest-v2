"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useCrmRequest } from "@/components/crm/request";
import { message } from "@/i18n/messages";

/**
 * Join (open) or accept an invitation (by link token or, from the account page, by invite id). The person accepts the
 * current rules, when the community has any, and confirms they are 18 or older (PRD launch policy).
 */
export function JoinDialog({ slug, name, rules, rulesVersion, invite, inviteId, signedIn, signInHref, action: kind }: {
  slug: string; name: string; rules: string | null; rulesVersion: number; invite?: string; inviteId?: string; signedIn: boolean; signInHref: string; action?: "join" | "accept";
}) {
  const t = useTranslations("JoinDialog"), request = useCrmRequest(), router = useRouter();
  const [open, setOpen] = useState(false), [rulesOk, setRulesOk] = useState(false), [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const action = t(kind ?? (invite || inviteId ? "accept" : "join"));
  if (!signedIn) return <Button asChild className="min-h-11 w-full"><Link href={signInHref} prefetch={false}>{action}</Link></Button>;
  const ready = adult && (!rules || rulesOk) && !busy;
  async function submit() {
    setBusy(true); setError("");
    const result = await request<{ outcome: string }>(`/api/communities/${slug}/join`, { method: "POST",
      body: { rulesVersion, adult, ...(invite ? { invite } : {}), ...(inviteId ? { inviteId } : {}) } });
    if (result.ok) { router.push(`/communities/${slug}/home`); return; }
    setBusy(false); setError(result.error);
    // New rules: reload them and ask again.
    if (result.error === message("Errors.communityRulesChanged")) { setRulesOk(false); router.refresh(); }
  }
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setError(""); }}>
    <DialogTrigger asChild><Button className="min-h-11 w-full">{action}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{t("title", { name })}</DialogTitle></DialogHeader>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {rules && <section aria-label={t("rules")} className="max-h-60 overflow-y-auto rounded-md border p-3 text-sm whitespace-pre-line">{rules}</section>}
      <div className="space-y-2">
        {rules && <Label htmlFor="join-rules" className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal">
          <Checkbox id="join-rules" checked={rulesOk} onCheckedChange={(v) => setRulesOk(v === true)} />{t("acceptRules")}</Label>}
        <Label htmlFor="join-adult" className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal">
          <Checkbox id="join-adult" checked={adult} onCheckedChange={(v) => setAdult(v === true)} />{t("adult")}</Label>
      </div>
      <DialogFooter><Button className="min-h-11" disabled={!ready} onClick={() => void submit()}>{busy ? t("joining") : action}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
