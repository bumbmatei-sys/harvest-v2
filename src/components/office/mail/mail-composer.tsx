/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/mail/components/mail-display.tsx (reply composer under the thread); code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Save, Send, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { OfficeApiError, parseRecipients, validEmail, type Draft, type MailApi } from "@/lib/office/mail";
import { notify } from "@/lib/toast";

/** What the composer opens with. A `draftRef` without text loads the saved draft first (some mailboxes list drafts without bodies). */
export type ComposeSeed = { draftRef?: string; to?: string[]; subject?: string; body?: string; reply?: boolean };
type Status = "idle" | "saving" | "saved" | "failed" | "conflict";

/**
 * Compose and reply drafts. A draft lives in the connected mailbox and is saved only by an explicit action, with the provider's version as the guard, so two
 * tabs cannot silently overwrite each other. Sending is hard-off in Harvest: the control stays visible but disabled with a short notice, and nothing here
 * ever calls a send route.
 */
export function MailComposer({ api, connectionId, seed, onClose, onSaved, onDeleted, onReconnect, onDirtyChange }: {
  api: MailApi; connectionId: string; seed: ComposeSeed; onClose: () => void; onSaved: (draft: Draft) => void; onDeleted: (ref: string) => void; onReconnect: () => void;
  /** Tells the page whether leaving would lose text, so it can ask before replacing this pane. */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useTranslations("OfficeMail"), c = useTranslations("OfficeMail.compose");
  const [needsLoad] = useState(() => !!seed.draftRef && seed.body === undefined);
  const [loading, setLoading] = useState<"loading" | "failed" | "ready">(needsLoad ? "loading" : "ready");
  const [to, setTo] = useState((seed.to ?? []).join(", ")), [subject, setSubject] = useState(seed.subject ?? ""), [body, setBody] = useState(seed.body ?? "");
  const [ref, setRef] = useState(seed.draftRef ?? null), [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle"), [error, setError] = useState<string | null>(null), [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(false);
  // One request id per composer, so a retried first save can never create a second draft.
  const requestId = useRef<string>(crypto.randomUUID()), first = useRef<HTMLInputElement>(null), text = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!needsLoad || !seed.draftRef) return;
    const controller = new AbortController();
    api.draft(connectionId, seed.draftRef, controller.signal).then((result) => {
      if (result.state === "reconnect_needed") return onReconnect();
      if (result.state !== "available") return setLoading("failed");
      setTo(result.data.to.join(", ")); setSubject(result.data.subject); setBody(result.data.body); setVersion(result.data.version ?? null); setLoading("ready");
    }, (failure: unknown) => { if (!(failure instanceof DOMException && failure.name === "AbortError")) setLoading("failed"); });
    return () => controller.abort();
  }, [api, connectionId, needsLoad, seed.draftRef, onReconnect]);
  useEffect(() => { if (loading === "ready") (seed.reply ? text : first).current?.focus(); }, [loading, seed.reply]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const edit = <T,>(set: (value: T) => void) => (value: T) => { set(value); setDirty(true); if (status !== "saving") setStatus("idle"); setError(null); };

  async function save() {
    const recipients = parseRecipients(to);
    if (recipients.length > 20) return setError(c("recipientsMax"));
    if (recipients.some((value) => !validEmail(value))) return setError(c("recipientsInvalid"));
    setStatus("saving"); setError(null);
    const content = { to: recipients, subject, body };
    try {
      const result = ref && version ? await api.updateDraft(connectionId, ref, version, content) : ref ? await api.draft(connectionId, ref).then((current) => current.state === "available" && current.data.version ? api.updateDraft(connectionId, ref, current.data.version, content) : current) : await api.createDraft(connectionId, content, requestId.current);
      if (result.state === "reconnect_needed") return onReconnect();
      if (result.state !== "available") { setStatus("failed"); return; }
      const saved = result.data as Draft;
      setRef(saved.ref); setVersion(saved.version ?? null); setDirty(false); setStatus("saved"); notify.success(c("saved")); onSaved(saved);
    } catch (failure) { setStatus(failure instanceof OfficeApiError && failure.conflict ? "conflict" : "failed"); }
  }

  async function remove() {
    if (!ref) return;
    const result = await api.deleteDraft(connectionId, ref);
    if (result.state !== "available") throw new OfficeApiError(0);
    notify.success(c("deleted")); onDeleted(ref);
  }

  const close = () => { if (dirty) setDiscard(true); else onClose(); };
  const back = <Button type="button" variant="ghost" size="icon-responsive" className="md:hidden" aria-label={t("thread.back")} onClick={close}><ArrowLeft aria-hidden="true" /></Button>;
  if (loading === "loading") return <div className="flex-1 space-y-4 p-4" role="status" aria-busy="true" aria-label={c("loading")}><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (loading === "failed") return <div className="flex flex-1 flex-col"><div className="border-b p-2">{back}</div><div className="p-4"><Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-2">{c("loadFailed")}<Button type="button" variant="outline" size="responsive" onClick={onClose}>{c("close")}</Button></AlertDescription></Alert></div></div>;

  return <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="composer" aria-label={seed.reply ? c("replyTitle") : c("title")}>
    <header className="flex items-center gap-2 border-b p-2 md:px-3">
      {back}
      <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{seed.reply ? c("replyTitle") : c("title")}</h2>
      <Button type="button" variant="ghost" size="icon-responsive" className="max-md:hidden" aria-label={c("close")} onClick={close} data-testid="composer-close"><X aria-hidden="true" /></Button>
    </header>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 md:p-4">
      <Field><FieldLabel htmlFor="mail-to">{c("to")}</FieldLabel><Input ref={first} id="mail-to" type="text" inputMode="email" autoComplete="off" value={to} onChange={(event) => edit(setTo)(event.target.value)} className="min-h-11 lg:min-h-9" /></Field>
      <Field><FieldLabel htmlFor="mail-subject">{c("subject")}</FieldLabel><Input id="mail-subject" type="text" maxLength={500} value={subject} onChange={(event) => edit(setSubject)(event.target.value)} className="min-h-11 lg:min-h-9" /></Field>
      <Field><FieldLabel htmlFor="mail-body">{c("body")}</FieldLabel><Textarea ref={text} id="mail-body" maxLength={20000} value={body} onChange={(event) => edit(setBody)(event.target.value)} className="min-h-48" /></Field>
      {error && <FieldError role="alert" data-testid="composer-error">{error}</FieldError>}
      {status === "failed" && <Alert variant="destructive" role="alert" data-testid="save-failed"><AlertDescription>{c("saveFailed")}</AlertDescription></Alert>}
      {status === "conflict" && <Alert variant="destructive" role="alert" data-testid="save-conflict"><AlertDescription>{c("conflict")}</AlertDescription></Alert>}
    </div>
    <footer className="space-y-2 border-t p-3">
      <p id="send-off" className="text-xs text-muted-foreground" data-testid="send-off">{c("sendOff")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="responsive" disabled={status === "saving" || (!to.trim() && !subject.trim() && !body.trim())} data-testid="save-draft">{status === "saving" ? <Spinner /> : <Save aria-hidden="true" />}{status === "saving" ? c("saving") : c("save")}</Button>
        <Button type="button" variant="outline" size="responsive" disabled aria-describedby="send-off" data-testid="send"><Send aria-hidden="true" />{c("send")}</Button>
        {ref && <ConfirmDialog tone="destructive" title={c("deleteTitle")} description={c("deleteBody")} confirmLabel={c("deleteConfirm")} cancelLabel={t("account.cancel")} failedLabel={c("deleteFailed")} onConfirm={remove}
          trigger={<Button type="button" variant="ghost" size="responsive" className="ml-auto" data-testid="delete-draft"><Trash2 aria-hidden="true" />{c("delete")}</Button>} />}
      </div>
    </footer>
    <ConfirmDialog open={discard} onOpenChange={setDiscard} tone="destructive" title={c("discardTitle")} description={c("discardBody")} confirmLabel={c("discard")} cancelLabel={t("account.cancel")} onConfirm={() => { setDiscard(false); onClose(); }} />
  </form>;
}
