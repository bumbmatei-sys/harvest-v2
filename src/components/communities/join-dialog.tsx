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
import { answersComplete, QuestionFields } from "@/components/forms/question-fields";
import { useCrmRequest } from "@/components/crm/request";
import { message } from "@/i18n/messages";
import type { Answers, Question } from "@/lib/questions";

/**
 * Join (open), apply (approval on) or accept an invitation (by link token or, from the account page, by invite id).
 * Order: the owner's questions, then the rules (if any), then the 18+ confirmation (PRD launch policy).
 */
export function JoinDialog({ slug, name, rules, rulesVersion, questions, questionsVersion, apply = false, invite, inviteId, signedIn, signInHref, action: kind }: {
  slug: string; name: string; rules: string[]; rulesVersion: number; questions: Question[]; questionsVersion: number; apply?: boolean;
  invite?: string; inviteId?: string; signedIn: boolean; signInHref: string; action?: "join" | "accept" | "apply";
}) {
  const t = useTranslations("JoinDialog"), request = useCrmRequest(), router = useRouter();
  const [open, setOpen] = useState(false), [rulesOk, setRulesOk] = useState(false), [adult, setAdult] = useState(false), [answers, setAnswers] = useState<Answers>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [applied, setApplied] = useState(false);
  const invited = Boolean(invite || inviteId);
  const action = t(kind ?? (invited ? "accept" : apply ? "apply" : "join"));
  if (!signedIn) return <Button asChild className="min-h-11 w-full"><Link href={signInHref} prefetch={false}>{action}</Link></Button>;
  const ready = adult && (rules.length === 0 || rulesOk) && answersComplete(questions, answers) && !busy;
  async function submit() {
    setBusy(true); setError("");
    const result = await request<{ outcome: string }>(`/api/communities/${slug}/join`, { method: "POST",
      body: { rulesVersion, questionsVersion, answers, adult, ...(invite ? { invite } : {}), ...(inviteId ? { inviteId } : {}) } });
    if (result.ok) {
      if (result.data.outcome === "applied") { setBusy(false); setApplied(true); router.refresh(); return; }
      router.push(`/communities/${slug}/forum`); return;
    }
    setBusy(false); setError(result.error);
    // New rules or questions: reload them and ask again.
    if ([message("Errors.communityRulesChanged"), message("Errors.communityQuestionsChanged")].includes(result.error)) { setRulesOk(false); router.refresh(); }
  }
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setError(""); }}>
    <DialogTrigger asChild><Button className="min-h-11 w-full">{action}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{t("title", { name })}</DialogTitle></DialogHeader>
      {applied
        ? <><Alert role="status"><AlertDescription>{t("applied")}</AlertDescription></Alert>
          <DialogFooter><Button asChild variant="outline" className="min-h-11"><Link href="/account/communities" prefetch={false}>{t("myCommunities")}</Link></Button></DialogFooter></>
        : <>
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          {questions.length > 0 && <QuestionFields questions={questions} values={answers} onChange={setAnswers} idPrefix="join-question" />}
          {rules.length > 0 && <section aria-label={t("rules")} className="max-h-60 overflow-y-auto rounded-md border p-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm">{rules.map((rule, i) => <li key={i} className="break-words">{rule}</li>)}</ol></section>}
          <div className="space-y-2">
            {rules.length > 0 && <Label htmlFor="join-rules" className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal">
              <Checkbox id="join-rules" checked={rulesOk} onCheckedChange={(v) => setRulesOk(v === true)} />{t("acceptRules")}</Label>}
            <Label htmlFor="join-adult" className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal">
              <Checkbox id="join-adult" checked={adult} onCheckedChange={(v) => setAdult(v === true)} />{t("adult")}</Label>
          </div>
          <DialogFooter><Button className="min-h-11" disabled={!ready} onClick={() => void submit()}>{busy ? t("joining") : action}</Button></DialogFooter>
        </>}
    </DialogContent>
  </Dialog>;
}
