"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCrmRequest } from "@/components/crm/request";
import type { Answers, Question } from "@/lib/questions";

export type ApplicationRow = { id: string; name: string; status: "pending" | "info_requested" | "approved" | "declined" | "withdrawn"; answers: Answers;
  questionsVersion: number; infoRequest: string | null; reviewerNote: string | null; createdAt: string | Date; updatedAt: string | Date };
export type ApplicationQueue = { questions: Question[]; questionsVersion: number; applications: ApplicationRow[] };

/** C07: the community's application queue for owners and admins. Reviewer notes stay private to staff. */
export function CommunityApplications({ endpoint, initial }: { endpoint: string; initial: ApplicationQueue }) {
  const t = useTranslations("CommunityApplications"), format = useFormatter(), request = useCrmRequest();
  const [queue, setQueue] = useState(initial), [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const current = queue.applications.find((a) => a.id === openId) ?? null;
  const label = (id: string) => queue.questions.find((q) => q.id === id)?.label ?? t("removedQuestion");
  async function refresh() { const result = await request<ApplicationQueue>(`${endpoint}/applications`, { method: "GET" }); if (result.ok) setQueue(result.data); }
  function open(row: ApplicationRow) { setOpenId(row.id); setMessage(""); setNote(row.reviewerNote ?? ""); setError(""); }
  async function decide(body: Record<string, unknown>) {
    if (!current) return;
    setBusy(true); setError("");
    const result = await request(`${endpoint}/applications/${current.id}`, { method: "PATCH", body });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    await refresh();
    if (body.action !== "note") setOpenId(null);
  }
  const noteChange = () => note.trim() !== (current?.reviewerNote ?? "") ? { note: note.trim() || undefined } : {};
  return <section className="space-y-3" aria-labelledby="community-applications-title">
    <h3 id="community-applications-title" className="text-base font-semibold">{t("title")}</h3>
    {queue.applications.length === 0
      ? <p className="text-sm text-muted-foreground">{t("empty")}</p>
      : <div className="overflow-x-auto"><Table aria-label={t("title")}>
        <TableHeader><TableRow><TableHead>{t("name")}</TableHead><TableHead>{t("applied")}</TableHead><TableHead>{t("status")}</TableHead><TableHead><span className="sr-only">{t("actions")}</span></TableHead></TableRow></TableHeader>
        <TableBody>{queue.applications.map((row) => <TableRow key={row.id}>
          <TableCell>{row.name.trim() || <span className="text-muted-foreground">{t("unnamed")}</span>}</TableCell>
          <TableCell>{format.dateTime(new Date(row.createdAt), { dateStyle: "medium" })}</TableCell>
          <TableCell><Badge variant={row.status === "pending" ? "secondary" : "outline"}>{t(`statuses.${row.status}`)}</Badge></TableCell>
          <TableCell className="text-right"><Button variant="outline" className="min-h-11" onClick={() => open(row)} aria-label={t("viewNamed", { name: row.name.trim() || t("unnamed") })}>{t("view")}</Button></TableCell>
        </TableRow>)}</TableBody></Table></div>}
    <Sheet open={current !== null} onOpenChange={(next) => { if (!next) setOpenId(null); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {current && <>
          <SheetHeader><SheetTitle>{current.name.trim() || t("unnamed")}</SheetTitle></SheetHeader>
          <div className="space-y-5 p-4">
            {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
            <dl className="space-y-3">{Object.entries(current.answers).map(([id, value]) => <div key={id}>
              <dt className="text-sm font-medium">{label(id)}</dt><dd className="text-sm whitespace-pre-line break-words">{Array.isArray(value) ? value.join(", ") : value}</dd></div>)}</dl>
            {current.answers && Object.keys(current.answers).length === 0 && <p className="text-sm text-muted-foreground">{t("noAnswers")}</p>}
            {current.infoRequest && <p className="text-sm"><span className="font-medium">{t("askedFor")} </span>{current.infoRequest}</p>}
            <div className="space-y-2"><Label htmlFor="application-note">{t("note")}</Label>
              <Textarea id="application-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
              {note.trim() !== (current.reviewerNote ?? "") && !["pending", "info_requested"].includes(current.status) &&
                <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void decide({ action: "note", note: note.trim() || null })}>{t("saveNote")}</Button>}</div>
            {["pending", "info_requested"].includes(current.status) && <>
              <div className="space-y-2"><Label htmlFor="application-message">{t("message")}</Label>
                <Textarea id="application-message" rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
              <div className="flex flex-wrap gap-2">
                <Button className="min-h-11" disabled={busy} onClick={() => void decide({ action: "approve", ...noteChange() })}>{t("approve")}</Button>
                <Button variant="outline" className="min-h-11" disabled={busy || !message.trim()} onClick={() => void decide({ action: "request_info", message: message.trim(), ...noteChange() })}>{t("requestInfo")}</Button>
                <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void decide({ action: "decline", ...noteChange() })}>{t("decline")}</Button>
              </div>
            </>}
          </div>
        </>}
      </SheetContent>
    </Sheet>
  </section>;
}
