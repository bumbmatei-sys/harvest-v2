"use client";
import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AtSign, Check, MessageSquare, RotateCcw, Send, Trash2, UserRound, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useDocsCall, type Person } from "@/components/docs/docs-api";
import { PanelShell } from "@/components/docs/panels/panel-shell";
import { NotificationsBell } from "@/components/docs/panels/notifications-bell";
import type { Thread } from "@/server/docs-comments";

type Tab = "open" | "assigned" | "resolved";

/** Comments of the open page: threads on the page or on selected text, with Open, Assigned to me and Resolved tabs, replies, @mentions, assigning and resolving. */
export function CommentsPanel({ tenantId, docId, pageId, userId, canComment, canManage, getSelection, onJump, onClose }: {
  tenantId: string; docId: string; pageId: string; userId: string; canComment: boolean; canManage: boolean; getSelection: () => string; onJump: (quote: string) => void; onClose: () => void;
}) {
  const t = useTranslations("Docs"), format = useFormatter(), call = useDocsCall(tenantId, docId);
  const [threads, setThreads] = useState<Thread[]>([]), [people, setPeople] = useState<Person[]>([]), [tab, setTab] = useState<Tab>("open"), [error, setError] = useState(""), [text, setText] = useState(""), [mentions, setMentions] = useState<string[]>([]);
  const [assignee, setAssignee] = useState(""), [quote, setQuote] = useState(""), [replyTo, setReplyTo] = useState<string | null>(null), [busy, setBusy] = useState(false), [pickerOpen, setPickerOpen] = useState(false);
  const load = useCallback(async () => { const r = await call<{ threads: Thread[]; people: Person[] }>("GET", `/comments?pageId=${pageId}`); if (r.ok) { setThreads(r.data.threads); setPeople(r.data.people); } else setError(r.error); }, [call, pageId]);
  useEffect(() => { let live = true; call<{ threads: Thread[]; people: Person[] }>("GET", `/comments?pageId=${pageId}`).then((r) => { if (live) { if (r.ok) { setThreads(r.data.threads); setPeople(r.data.people); } else setError(r.error); } }); return () => { live = false; }; }, [call, pageId]);
  const name = (id: string) => people.find((p) => p.userId === id)?.name ?? "";
  const shown = threads.filter((th) => tab === "resolved" ? th.status === "resolved" : th.status === "open" && (tab === "open" || th.assigneeId === userId));
  async function send(parentId?: string) {
    if (!text.trim() || busy) return;
    setBusy(true); setError("");
    const r = await call("POST", "/comments", { pageId, body: text.trim(), mentions, ...(parentId ? { parentId } : { quote: quote || undefined, assigneeId: assignee || null }) });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setText(""); setMentions([]); setAssignee(""); setQuote(""); setReplyTo(null); void load();
  }
  async function patch(id: string, body: unknown) { const r = await call("PATCH", `/comments/${id}`, body); if (!r.ok) setError(r.error); void load(); }
  async function remove(id: string) { const r = await call("DELETE", `/comments/${id}`); if (!r.ok) setError(r.error); void load(); }
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const mention = (p: Person) => { setText((v) => `${v}${v && !v.endsWith(" ") ? " " : ""}@${p.name} `); setMentions((m) => [...new Set([...m, p.userId])]); setPickerOpen(false); };
  const empty = tab === "open" ? t("commentsEmptyOpen") : tab === "assigned" ? t("commentsEmptyAssigned") : t("commentsEmptyResolved");
  const composer = (parentId?: string) => <div className="space-y-2">
    {!parentId && quote && <p className="flex items-start gap-2 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"><span className="min-w-0 flex-1 break-words">{t("commentingOn", { text: quote })}</span><button type="button" className="shrink-0" aria-label={t("clearSelection")} onClick={() => setQuote("")}><X className="size-3" aria-hidden="true" /></button></p>}
    <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={parentId ? t("replyPlaceholder") : t("commentPlaceholder")} aria-label={parentId ? t("replyPlaceholder") : t("commentPlaceholder")} maxLength={2000} rows={parentId ? 2 : 3} className="min-h-16"
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(parentId); } }} />
    <div className="flex items-center gap-1">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}><PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-9" aria-label={t("mentionSomeone")}><AtSign aria-hidden="true" /></Button></PopoverTrigger>
        <PopoverContent align="start" className="max-h-60 w-56 overflow-y-auto p-1">{people.map((p) => <button key={p.userId} type="button" className="flex min-h-11 w-full items-center rounded-md px-2 text-start text-sm hover:bg-accent" onClick={() => mention(p)}>{p.name}</button>)}</PopoverContent></Popover>
      {!parentId && <NativeSelect aria-label={t("assignTo")} className="h-9 min-w-0 flex-1 text-xs" value={assignee} onChange={(e) => setAssignee(e.target.value)}><NativeSelectOption value="">{t("assignTo")}</NativeSelectOption>{people.map((p) => <NativeSelectOption key={p.userId} value={p.userId}>{p.name}</NativeSelectOption>)}</NativeSelect>}
      <Button type="button" size="icon" className="ms-auto size-9 shrink-0" aria-label={t("sendComment")} disabled={!text.trim() || busy} onClick={() => void send(parentId)}><Send aria-hidden="true" /></Button>
    </div></div>;
  return <PanelShell name="comments" title={t("comments")} onClose={onClose} actions={<NotificationsBell tenantId={tenantId} />}
    footer={canComment ? <div onFocusCapture={() => { if (!quote) setQuote(getSelection().slice(0, 300)); }}>{composer()}</div> : <p className="text-sm text-muted-foreground">{t("commentsReadOnly")}</p>}>
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="px-4 pt-3"><TabsList variant="line" className="w-full justify-start"><TabsTrigger value="open" aria-controls={undefined}>{t("tabOpen")}</TabsTrigger><TabsTrigger value="assigned" aria-controls={undefined}>{t("tabAssigned")}</TabsTrigger><TabsTrigger value="resolved" aria-controls={undefined}>{t("tabResolved")}</TabsTrigger></TabsList></Tabs>
    {error && <div className="px-4 pt-3"><Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert></div>}
    {shown.length === 0 ? <div className="flex flex-col items-center gap-2 px-6 py-16 text-center"><MessageSquare className="size-10 text-muted-foreground" aria-hidden="true" /><p className="font-medium">{empty}</p>{tab === "open" && <p className="text-sm text-muted-foreground">{t("commentsEmptyHint")}</p>}</div>
      : <ul className="space-y-3 p-4" data-comment-threads>{shown.map((th) => <li key={th.id} className="rounded-lg border p-3" data-thread={th.id}>
        {th.quote && <button type="button" className="mb-2 block w-full rounded border-s-2 border-primary bg-muted px-2 py-1 text-start text-xs text-muted-foreground" onClick={() => onJump(th.quote!)}>{th.quote}</button>}
        {[th, ...th.replies].map((c) => <div key={c.id} className="mb-2 last:mb-0"><p className="text-xs text-muted-foreground">{t("commentMeta", { name: c.authorName, when: when(c.createdAt) })}</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{c.body}</p>
          {(c.authorId === userId || canManage) && <button type="button" className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground hover:text-destructive lg:min-h-0" aria-label={t("deleteComment")} onClick={() => void remove(c.id)}><Trash2 className="size-3" aria-hidden="true" />{t("delete")}</button>}</div>)}
        {th.assigneeId && <p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground"><UserRound className="size-3" aria-hidden="true" />{t("assignedTo", { name: th.assigneeName ?? name(th.assigneeId) })}</p>}
        {th.status === "resolved" && <p className="mb-2 text-xs text-muted-foreground">{t("resolvedBy", { name: th.resolvedByName ?? "" })}</p>}
        {canComment && <div className="flex flex-wrap items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className="min-h-11 lg:min-h-8" onClick={() => setReplyTo(replyTo === th.id ? null : th.id)}>{t("reply")}</Button>
          {th.status === "open" ? <Button type="button" variant="ghost" size="sm" className="min-h-11 lg:min-h-8" onClick={() => void patch(th.id, { status: "resolved" })}><Check aria-hidden="true" />{t("resolve")}</Button>
            : <Button type="button" variant="ghost" size="sm" className="min-h-11 lg:min-h-8" onClick={() => void patch(th.id, { status: "open" })}><RotateCcw aria-hidden="true" />{t("reopen")}</Button>}
          <NativeSelect aria-label={t("assignTo")} className="h-8 w-36 text-xs" value={th.assigneeId ?? ""} onChange={(e) => void patch(th.id, { assigneeId: e.target.value || null })}><NativeSelectOption value="">{t("unassigned")}</NativeSelectOption>{people.map((p) => <NativeSelectOption key={p.userId} value={p.userId}>{p.name}</NativeSelectOption>)}</NativeSelect>
        </div>}
        {replyTo === th.id && <div className="mt-2">{composer(th.id)}</div>}
      </li>)}</ul>}
  </PanelShell>;
}
