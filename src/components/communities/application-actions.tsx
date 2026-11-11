"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { answersComplete, QuestionFields } from "@/components/forms/question-fields";
import { useCrmRequest } from "@/components/crm/request";
import type { MyApplication } from "@/server/community-joining";

/** The applicant's own actions: withdraw a pending application, or edit answers after the community asked for more. */
export function ApplicationActions({ application }: { application: MyApplication }) {
  const t = useTranslations("MyCommunities"), request = useCrmRequest(), router = useRouter();
  const [open, setOpen] = useState(false), [answers, setAnswers] = useState(application.answers), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function send(body: Record<string, unknown>) {
    setBusy(true); setError("");
    const result = await request(`/api/account/community-applications/${application.id}`, { method: "PATCH", body });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setOpen(false); router.refresh();
  }
  if (application.status === "declined") return null;
  return <div className="flex flex-wrap gap-2">
    {error && !open && <Alert variant="destructive" role="alert" className="w-full"><AlertDescription>{error}</AlertDescription></Alert>}
    {application.status === "info_requested" && <Dialog open={open} onOpenChange={(next) => { setOpen(next); setError(""); }}>
      <DialogTrigger asChild><Button className="min-h-11">{t("editAnswers")}</Button></DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{application.name}</DialogTitle></DialogHeader>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {application.infoRequest && <p className="text-sm"><span className="font-medium">{t("askedFor")} </span>{application.infoRequest}</p>}
        <QuestionFields questions={application.joinQuestions} values={answers} onChange={setAnswers} idPrefix={`application-${application.id}`} />
        <DialogFooter><Button className="min-h-11" disabled={busy || !answersComplete(application.joinQuestions, answers)}
          onClick={() => void send({ action: "resubmit", questionsVersion: application.currentQuestionsVersion, answers })}>{t("resubmit")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>}
    <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void send({ action: "withdraw" })}>{t("withdraw")}</Button>
  </div>;
}
