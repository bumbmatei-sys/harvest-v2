"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, Building2, CheckCircle2, CircleDot, History, Kanban, Link2, Link2Off, ListChecks, Pencil, PencilLine, RotateCcw, ShieldCheck, Sparkles, StickyNote, UserRoundCheck } from "lucide-react";
import { CRM_TIME_ZONE } from "@/lib/crm-deals";
import type { TimelineEvent, TimelineItem, TimelineNote } from "@/server/activity";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCrmRequest } from "./request";

const fieldKeys = ["name", "notes", "email", "phone", "social", "domain", "description", "title", "primary"] as const;
type FieldKey = typeof fieldKeys[number];
const dealFields = ["name", "amount", "expectedCloseDate", "ownerUserId", "companyId", "contactId", "closedReason", "currency"] as const;
const taskFields = ["title", "body", "priority", "dueAt", "contactId", "companyId", "opportunityId"] as const;
const icons: Record<string, typeof History> = {
  "contact.create": Sparkles, "company.create": Sparkles, "opportunity.create": Sparkles, "contact.update": PencilLine, "company.update": PencilLine, "opportunity.update": PencilLine,
  "contact.company_link": Link2, "contact.company_link_update": Building2, "contact.company_unlink": Link2Off, "contact.consent_record": ShieldCheck,
  "opportunity.move": Kanban, "opportunity.archive": Archive, "opportunity.restore": RotateCcw,
  "task.create": ListChecks, "task.update": PencilLine, "task.complete": CheckCircle2, "task.reopen": CircleDot, "task.reassign": UserRoundCheck, "task.archive": Archive, "task.restore": RotateCcw,
  "note.archive": Archive, "note.restore": RotateCcw,
};
type Raw = Omit<TimelineItem, "createdAt" | "editedAt"> & { createdAt: string; editedAt?: string | null };
const revive = (item: Raw): TimelineItem => ({ ...item, createdAt: new Date(item.createdAt), ...(item.kind === "note" ? { editedAt: item.editedAt ? new Date(item.editedAt) : null } : {}) } as TimelineItem);

/**
 * The unified record timeline: audit-ledger events (record changes, deal moves, task
 * changes) and notes, newest first, grouped by day in the CRM time zone. It shows which
 * fields changed and who did it, never old or new personal values. Older items load
 * 50 at a time from the timeline API.
 */
export function ActivityTimeline({ items: first, nextCursor: firstCursor, endpoint, tenantId, subject, currentUserId, customLabels = {}, canWriteNotes = false, canModerate = false }: {
  items: TimelineItem[]; nextCursor: string | null; endpoint: string; tenantId: string; subject: "person" | "company" | "deal"; currentUserId: string;
  customLabels?: Record<string, string>; canWriteNotes?: boolean; canModerate?: boolean;
}) {
  const t = useTranslations("Crm");
  const tl = useTranslations("Timeline");
  const labels = useTranslations("ConsentLabels");
  const format = useFormatter();
  const crmRequest = useCrmRequest();
  const [older, setOlder] = useState<TimelineItem[]>([]), [cursor, setCursor] = useState(firstCursor), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [seen, setSeen] = useState(first);
  if (first !== seen) { setSeen(first); setOlder([]); setCursor(firstCursor); }
  const items = [...first, ...older.filter((item) => !first.some((entry) => entry.id === item.id))];
  async function loadOlder() {
    if (!cursor) return;
    setLoading(true); setError("");
    const result = await crmRequest<{ items: Raw[]; nextCursor: string | null }>(`${endpoint}?before=${encodeURIComponent(cursor)}`, { method: "GET" });
    setLoading(false);
    if (!result.ok) { setError(result.error); return; }
    setOlder((list) => [...list, ...result.data.items.map(revive)]); setCursor(result.data.nextCursor);
  }
  if (!items.length) return <Empty className="p-3 py-6 md:p-3"><EmptyHeader><EmptyMedia variant="icon"><History aria-hidden="true" /></EmptyMedia><EmptyTitle className="text-sm">{t("noActivityYet")}</EmptyTitle><EmptyDescription>{t("changesWillAppearHere")}</EmptyDescription></EmptyHeader></Empty>;
  const fieldName = (field: string) => field.startsWith("cf:") ? customLabels[field.slice(3)] ?? t("aCustomField") : (fieldKeys as readonly string[]).includes(field) ? t(`fields.${field as FieldKey}`) : null;
  const fields = (list: string[]) => format.list([...new Set(list.map(fieldName).filter((name): name is string => !!name))], { type: "conjunction" });
  const named = (list: readonly string[], key: "dealFields" | "taskFields", values: string[]) => format.list(values.filter((field) => list.includes(field)).map((field) => tl(`${key}.${field as "name"}`)), { type: "conjunction" });
  const companyLink = (item: TimelineEvent) => item.company ? <Link className="font-medium text-foreground hover:underline" href={`/workspaces/${tenantId}/crm/companies/${item.company.id}`}>{item.company.name}</Link> : <span>{t("aCompany")}</span>;
  const personLink = (item: TimelineEvent) => item.contact ? <Link className="font-medium text-foreground hover:underline" href={`/workspaces/${tenantId}/crm/people/${item.contact.id}`}>{item.contact.name}</Link> : <span>{t("aPerson")}</span>;
  const target = (item: TimelineEvent) => subject === "person" ? companyLink(item) : personLink(item);
  const task = (item: TimelineEvent) => { const name = item.task?.title ?? tl("aTask"); return function TaskTitle() { return <span className="font-medium text-foreground">{name}</span>; }; };
  function sentence(item: TimelineEvent) {
    switch (item.action) {
      case "contact.create": return t("activity.createdPerson");
      case "company.create": return t("activity.createdCompany");
      case "contact.update": case "company.update": return item.fields.length ? t("activity.updatedFields", { fields: fields(item.fields) }) : t("activity.updatedDetails");
      case "contact.company_link": return t.rich(subject === "person" ? "activity.linkedCompany" : "activity.linkedPerson", { target: () => target(item) });
      case "contact.company_unlink": return t.rich(subject === "person" ? "activity.unlinkedCompany" : "activity.unlinkedPerson", { target: () => target(item) });
      case "contact.company_link_update": return t.rich(item.fields.includes("primary") ? (subject === "person" ? "activity.madePrimary" : "activity.madePrimaryForPerson") : (subject === "person" ? "activity.updatedRole" : "activity.updatedRoleForPerson"), { target: () => target(item) });
      case "contact.consent_record": return item.channel && item.status && ["email", "sms", "social"].includes(item.channel) && ["granted", "withdrawn", "unknown"].includes(item.status)
        ? t("activity.recordedConsent", { channel: labels(item.channel as "email"), status: labels(item.status as "granted") }) : t("activity.recordedConsentGeneric");
      case "opportunity.create": return tl("dealCreated", { stage: item.toStage ?? tl("aStage") });
      case "opportunity.move": return tl("dealMoved", { from: item.fromStage ?? tl("aStage"), to: item.toStage ?? tl("aStage") });
      case "opportunity.update": return item.fields.length ? tl("dealUpdated", { fields: named(dealFields, "dealFields", item.fields) }) : tl("dealUpdatedGeneric");
      case "opportunity.archive": return tl("dealArchived");
      case "opportunity.restore": return tl("dealRestored");
      case "task.create": return tl.rich("taskCreated", { task: task(item) });
      case "task.complete": return tl.rich("taskCompleted", { task: task(item) });
      case "task.reopen": return tl.rich("taskReopened", { task: task(item) });
      case "task.reassign": return item.toUserName ? tl.rich("taskAssigned", { task: task(item), name: item.toUserName }) : tl.rich("taskUnassigned", { task: task(item) });
      case "task.update": return item.fields.length ? tl.rich("taskUpdatedFields", { task: task(item), fields: named(taskFields, "taskFields", item.fields) }) : tl.rich("taskUpdated", { task: task(item) });
      case "task.archive": return tl.rich("taskDeleted", { task: task(item) });
      case "task.restore": return tl.rich("taskRestored", { task: task(item) });
      case "note.archive": return tl("noteDeleted");
      case "note.restore": return tl("noteRestored");
    }
  }
  const actorName = (actor: TimelineItem["actor"]) => (actor.id === currentUserId ? t("you") : actor.isMember ? (actor.name ?? t("aWorkspaceMember")) : t("aFormerMember"));
  const day = (date: Date) => format.dateTime(date, { dateStyle: "full", timeZone: CRM_TIME_ZONE });
  return <div className="space-y-4">
    <ol className="relative space-y-0" aria-label={tl("timeline")}>
      {items.map((item, index) => {
        const heading = index === 0 || day(items[index - 1].createdAt) !== day(item.createdAt);
        const Icon = item.kind === "note" ? StickyNote : icons[item.action] ?? History;
        return <li key={item.id} className="relative">
          {heading && <h2 className="mb-3 pt-1 text-xs font-medium text-muted-foreground first:pt-0">{day(item.createdAt)}</h2>}
          <div className="relative flex gap-3 pb-5">
            {index < items.length - 1 && <span aria-hidden="true" className="absolute top-8 bottom-0 left-[15px] w-px bg-border" />}
            <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground"><Icon aria-hidden="true" className="size-3.5" /></span>
            {item.kind === "note"
              ? <NoteEntry note={item} actor={actorName(item.actor)} editable={canWriteNotes && (item.actor.id === currentUserId || canModerate)} tenantId={tenantId} />
              : <div className="min-w-0 pt-1.5 text-sm">
                <p className="text-muted-foreground"><span className="font-medium text-foreground">{actorName(item.actor)}</span> {sentence(item)}</p>
                <time className="mt-0.5 block text-xs text-muted-foreground" dateTime={item.createdAt.toISOString()}>{format.dateTime(item.createdAt, { timeStyle: "short", timeZone: CRM_TIME_ZONE })}</time>
              </div>}
          </div>
        </li>;
      })}
    </ol>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {cursor && <Button variant="outline" size="sm" disabled={loading} onClick={() => void loadOlder()}>{loading ? tl("loading") : tl("showOlder")}</Button>}
  </div>;
}

function NoteEntry({ note, actor, editable, tenantId }: { note: TimelineNote; actor: string; editable: boolean; tenantId: string }) {
  const tl = useTranslations("Timeline");
  const format = useFormatter();
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(note.body), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function send(body: Record<string, unknown>) {
    setBusy(true); setError("");
    const result = await crmRequest(`/api/workspaces/${tenantId}/crm/notes/${note.id}`, { method: "PATCH", body: { ...body, version: note.version } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setEditing(false); router.refresh();
  }
  const id = `note-edit-${note.id}`;
  return <div className="min-w-0 flex-1 pt-1.5 text-sm">
    <p className="text-muted-foreground"><span className="font-medium text-foreground">{actor}</span> {tl("addedANote")}</p>
    <p className="mt-0.5 text-xs text-muted-foreground"><time dateTime={note.createdAt.toISOString()}>{format.dateTime(note.createdAt, { timeStyle: "short", timeZone: CRM_TIME_ZONE })}</time>{note.editedAt && <span> {tl("edited")}</span>}</p>
    {editing ? <form className="mt-2 space-y-2" onSubmit={(event) => { event.preventDefault(); void send({ body: draft }); }}>
      <Label htmlFor={id} className="sr-only">{tl("editNote")}</Label>
      <Textarea id={id} value={draft} maxLength={10_000} disabled={busy} autoFocus onChange={(event) => setDraft(event.target.value)} className="min-h-24"
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditing(false); setDraft(note.body); } if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send({ body: draft }); } }} />
      <div className="flex gap-2"><Button size="sm" disabled={busy || !draft.trim()}>{busy ? tl("saving") : tl("saveNote")}</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setDraft(note.body); }}>{tl("cancel")}</Button></div>
    </form> : <div className="mt-2 rounded-lg border bg-muted/40 px-3 py-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground">{note.body}</div>}
    {error && <Alert variant="destructive" className="mt-2"><AlertDescription>{error}</AlertDescription></Alert>}
    {editable && !editing && <div className="mt-1 flex gap-1">
      <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => { setDraft(note.body); setEditing(true); }}><Pencil aria-hidden="true" />{tl("edit")}</Button>
      <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" disabled={busy} onClick={() => void send({ archived: true })}><Archive aria-hidden="true" />{tl("deleteNote")}</Button>
    </div>}
  </div>;
}

/** Plain-text note composer: whitespace is kept; Ctrl/Cmd+Enter saves. */
export function NoteComposer({ tenantId, target, targetId }: { tenantId: string; target: "person" | "company" | "deal"; targetId: string }) {
  const tl = useTranslations("Timeline");
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const [body, setBody] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit() {
    if (!body.trim()) return;
    setBusy(true); setError("");
    const result = await crmRequest(`/api/workspaces/${tenantId}/crm/notes`, { method: "POST", body: { target, targetId, body } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setBody(""); router.refresh();
  }
  return <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <Label htmlFor={`note-${targetId}`} className="sr-only">{tl("newNote")}</Label>
    <Textarea id={`note-${targetId}`} value={body} maxLength={10_000} disabled={busy} placeholder={tl("notePlaceholder")} onChange={(event) => setBody(event.target.value)} className="min-h-20" aria-describedby={`note-${targetId}-hint`}
      onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); } }} />
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p id={`note-${targetId}-hint`} className="text-xs text-muted-foreground">{tl("noteHint")}</p>
      <Button size="sm" disabled={busy || !body.trim()}>{busy ? tl("saving") : tl("addNote")}</Button>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </form>;
}
