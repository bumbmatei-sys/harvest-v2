/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/mail/components/mail-display.tsx and mail-display-mobile.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MailCheck, MailOpen, Reply, ShieldAlert, Star } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { PersonLink } from "@/components/office/mail/person-link";
import { OfficeApiError, type MailApi, type Marker, type Message, type ThreadDetail } from "@/lib/office/mail";
import { notify } from "@/lib/toast";

type Load = { status: "loading" } | { status: "error" } | { status: "gone" } | { status: "ready"; data: ThreadDetail };
type Change = { read?: boolean; starred?: boolean; contactId?: string | null };

/**
 * The open thread: its messages exactly as the mailbox returns them right now (plain text, remote images never load, nothing stored by Harvest), with the
 * Harvest-only read and star markers, the explicit person link and the reply action. A failure shows an error, never invented text.
 */
export function MailThread({ tenantId, api, connectionId, threadRef, canReply, onBack, onMarker, onReply, onReconnect }: {
  tenantId: string; api: MailApi; connectionId: string; threadRef: string; canReply: boolean;
  onBack: () => void; onMarker: (marker: Marker) => void; onReply: (thread: ThreadDetail, message: Message) => void; onReconnect: () => void;
}) {
  const t = useTranslations("OfficeMail"), th = useTranslations("OfficeMail.thread");
  const [load, setLoad] = useState<Load>({ status: "loading" }), [busy, setBusy] = useState(false);
  const run = useRef(0), opened = useRef(false), title = useRef<HTMLHeadingElement>(null);

  const read = useCallback(async () => {
    const mine = ++run.current, controller = new AbortController();
    try {
      const result = await api.thread(connectionId, threadRef, controller.signal);
      if (mine !== run.current) return;
      if (result.state === "available") setLoad({ status: "ready", data: result.data });
      else if (result.state === "reconnect_needed") onReconnect();
      else setLoad({ status: "error" });
    } catch (error) {
      if (mine !== run.current || (error instanceof DOMException && error.name === "AbortError")) return;
      setLoad({ status: error instanceof OfficeApiError && error.unavailable ? "gone" : "error" });
    }
  }, [api, connectionId, threadRef, onReconnect]);
  useEffect(() => { void Promise.resolve().then(read); const current = run; return () => { current.current++; }; }, [read]);

  const change = useCallback(async (fields: Change, quiet = false) => {
    setBusy(true);
    try {
      const result = await api.marker(connectionId, { threadRef, ...fields });
      if (result.state !== "available") { notify.error(th("markerFailed")); return result.state === "reconnect_needed" ? onReconnect() : undefined; }
      setLoad((current) => current.status === "ready" ? { status: "ready", data: { ...current.data, marker: result.data } } : current);
      onMarker(result.data);
      if (!quiet && fields.contactId !== undefined) notify.success(t(fields.contactId ? "person.linkedToast" : "person.unlinkedToast"));
      return null;
    } catch { notify.error(th("markerFailed")); }
    finally { setBusy(false); }
  }, [api, connectionId, threadRef, onMarker, onReconnect, t, th]);

  // Opening a thread reads it in Harvest. The mailbox's own read state is never touched.
  useEffect(() => {
    if (load.status !== "ready" || load.data.marker.read || opened.current) return;
    opened.current = true; void change({ read: true }, true);
  }, [load, change]);

  if (load.status === "loading") return <div className="flex-1 space-y-4 p-4" role="status" aria-busy="true" aria-label={th("loading")} data-testid="thread-loading"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;
  const back = <Button type="button" variant="ghost" size="icon-responsive" className="md:hidden" aria-label={th("back")} onClick={onBack} data-testid="thread-back"><ArrowLeft aria-hidden="true" /></Button>;
  if (load.status === "gone") return <div className="flex flex-1 flex-col"><div className="border-b p-2">{back}</div><div className="p-4"><EmptyState icon={ShieldAlert} title={th("gone")} solid /></div></div>;
  if (load.status === "error") return <div className="flex flex-1 flex-col"><div className="border-b p-2">{back}</div><div className="p-4"><Alert variant="destructive" role="alert" data-testid="thread-error"><AlertDescription className="flex flex-wrap items-center gap-2">{th("failed")}
    <Button type="button" variant="outline" size="responsive" onClick={() => { setLoad({ status: "loading" }); void read(); }}>{t("retry")}</Button></AlertDescription></Alert></div></div>;

  const { data } = load, marker = data.marker, last = data.messages.at(-1);
  return <div className="flex min-h-0 flex-1 flex-col" data-testid="thread" data-thread={data.ref}>
    <header className="flex flex-wrap items-center gap-2 border-b p-2 md:px-3">
      {back}
      <h2 ref={title} tabIndex={-1} className="min-w-0 flex-1 basis-40 truncate text-base font-semibold outline-none" data-testid="thread-subject">{data.subject || t("list.noSubject")}</h2>
      <Button type="button" variant="outline" size="icon-responsive" aria-pressed={marker.starred} disabled={busy} aria-label={marker.starred ? th("unstar") : th("star")} onClick={() => void change({ starred: !marker.starred })} data-testid="star-toggle">
        <Star className={marker.starred ? "fill-current text-warning" : undefined} aria-hidden="true" /></Button>
      <Button type="button" variant="outline" size="icon-responsive" disabled={busy} aria-label={marker.read ? th("markUnread") : th("markRead")} onClick={() => void change({ read: !marker.read })} data-testid="read-toggle">
        {marker.read ? <MailOpen aria-hidden="true" /> : <MailCheck aria-hidden="true" />}</Button>
      <Button type="button" size="responsive" disabled={!canReply || !last} onClick={() => last && onReply(data, last)} data-testid="reply"><Reply aria-hidden="true" />{th("reply")}</Button>
    </header>
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2"><PersonLink tenantId={tenantId} contactId={marker.contactId} busy={busy}
      onLink={async (item) => { const done = await change({ contactId: item.id }); return done === null ? null : t("person.failed"); }}
      onUnlink={() => void change({ contactId: null })} /></div>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 md:p-4" data-testid="messages">
      {data.messages.map((message) => <MessageCard key={message.ref} message={message} />)}
    </div>
  </div>;
}

function MessageCard({ message }: { message: Message }) {
  const th = useTranslations("OfficeMail.thread"), format = useFormatter();
  const when = message.date && Number.isFinite(Date.parse(message.date)) ? format.dateTime(new Date(message.date), { dateStyle: "medium", timeStyle: "short" }) : null;
  return <article className="rounded-lg border bg-card p-3" data-testid="message">
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm">
      <dt className="text-muted-foreground">{th("from")}</dt><dd className="min-w-0 break-words font-medium" data-testid="message-from">{message.from}</dd>
      <dt className="text-muted-foreground">{th("to")}</dt><dd className="min-w-0 break-words">{message.to.join(", ")}</dd>
    </dl>
    {when && <time dateTime={message.date} className="mt-1 block text-xs text-muted-foreground">{when}</time>}
    {message.bodyUnavailable
      ? <p className="mt-3 text-sm text-muted-foreground" data-testid="body-unavailable">{th("noText")}</p>
      : <p className="mt-3 whitespace-pre-wrap break-words text-sm" data-testid="message-body">{message.body}</p>}
  </article>;
}
