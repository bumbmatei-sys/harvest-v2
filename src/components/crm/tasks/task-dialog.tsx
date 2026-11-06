"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, Kanban, Pencil, Plus, UserRound, X } from "lucide-react";
import { instantToZoned, taskPriorities, type TaskPriority } from "@/lib/crm-tasks";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { RecordPicker } from "../record-picker";
import { useCrmRequest } from "../request";

export type Relation = { id: string; label: string } | null;
export type EditableTask = { id: string; version: number; title: string; body: string; priority: TaskPriority; dueAt: Date | string | null; assigneeUserId: string | null;
  contact: Relation; company: Relation; deal: Relation };

/**
 * Create or edit a task. From a record page the record is pre-linked (and kept);
 * from the Tasks page a person and/or company can be picked, or none for a personal task.
 */
export function TaskDialog({ tenantId, members, currentUserId, task = null, contact = null, company = null, deal = null, variant = "default", compact = false }: {
  tenantId: string; members: { id: string; name: string }[]; currentUserId: string; task?: EditableTask | null;
  contact?: Relation; company?: Relation; deal?: Relation; variant?: "default" | "outline" | "ghost"; compact?: boolean;
}) {
  const t = useTranslations("Tasks");
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const initial = () => ({ contact: task?.contact ?? contact, company: task?.company ?? company, deal: task?.deal ?? deal });
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [links, setLinks] = useState(initial);
  const [stale, setStale] = useState(false);
  function change(value: boolean) { if (busy) return; setOpen(value); if (value) { setError(""); setStale(false); setLinks(initial()); } }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    const body = {
      title: String(form.get("title") ?? "").trim(), body: String(form.get("body") ?? ""), priority: String(form.get("priority") ?? "none"),
      dueAt: String(form.get("due") ?? ""), assigneeUserId: String(form.get("assignee") ?? ""),
      contactId: links.contact?.id ?? null, companyId: links.company?.id ?? null, opportunityId: links.deal?.id ?? null,
    };
    setBusy(true);
    const result = task
      ? await crmRequest(`/api/workspaces/${tenantId}/crm/tasks/${task.id}`, { method: "PATCH", body: { ...body, version: task.version } })
      : await crmRequest(`/api/workspaces/${tenantId}/crm/tasks`, { method: "POST", body });
    setBusy(false);
    if (!result.ok) { setError(result.error); setStale(result.details?.reason === "stale"); return; }
    setOpen(false); router.refresh();
  }
  const picker = (kind: "contact" | "company", value: Relation) => {
    const label = kind === "contact" ? t("person") : t("company");
    return <div className="flex min-h-9 items-center gap-2 rounded-md border px-2">
      {kind === "contact" ? <UserRound className="size-4 text-muted-foreground" aria-hidden="true" /> : <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />}
      <span className={value ? "min-w-0 flex-1 truncate text-sm" : "min-w-0 flex-1 truncate text-sm text-muted-foreground"}>{value?.label ?? (kind === "contact" ? t("noPerson") : t("noCompany"))}</span>
      <RecordPicker endpoint={`/api/workspaces/${tenantId}/${kind === "contact" ? "contacts" : "companies"}`} toItem={(row) => ({ id: String(row.id), label: String(row.name) })} exclude={value ? [value.id] : []}
        title={t("chooseRecord", { kind: label })} placeholder={kind === "contact" ? t("searchPeople") : t("searchCompanies")} emptyLabel={t("noRecordsFound")} align="end"
        trigger={<Button type="button" size="sm" variant="ghost" className="h-7 text-xs" aria-label={value ? t("changeRecord", { kind: label }) : t("chooseRecord", { kind: label })}>{value ? t("change") : t("choose")}</Button>}
        onSelect={(item) => { setLinks((current) => ({ ...current, [kind]: { id: item.id, label: item.label } })); }} />
      {value && <Button type="button" size="icon-sm" variant="ghost" aria-label={t("removeRecord", { kind: label })} onClick={() => setLinks((current) => ({ ...current, [kind]: null }))}><X aria-hidden="true" /></Button>}
    </div>;
  };
  const due = task?.dueAt ? instantToZoned(new Date(task.dueAt)) : "";
  const title = task ? t("editTask") : t("newTask");
  return <Dialog open={open} onOpenChange={change}>
    <DialogTrigger asChild>{task
      ? <Button type="button" size="icon-sm" variant="ghost" aria-label={t("editTaskNamed", { task: task.title })}><Pencil aria-hidden="true" /></Button>
      : <Button type="button" size="sm" variant={variant}><Plus aria-hidden="true" />{compact ? t("add") : t("addTask")}</Button>}</DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[520px]">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{t("taskDialogDescription")}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-2">{error}{stale && <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(false); router.refresh(); }}>{t("reload")}</Button>}</AlertDescription></Alert>}
        <Field className="gap-2"><FieldLabel htmlFor="task-title">{t("title")}</FieldLabel><Input id="task-title" name="title" required maxLength={200} defaultValue={task?.title ?? ""} autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="gap-2"><FieldLabel htmlFor="task-due">{t("due")}</FieldLabel><Input id="task-due" name="due" type="datetime-local" defaultValue={due} aria-describedby="task-due-help" />
            <FieldDescription id="task-due-help" className="text-xs">{t("dueHelp")}</FieldDescription></Field>
          <Field className="gap-2"><FieldLabel htmlFor="task-priority">{t("priority")}</FieldLabel>
            <NativeSelect id="task-priority" name="priority" defaultValue={task?.priority ?? "none"} className="w-full">
              {taskPriorities.map((value) => <NativeSelectOption key={value} value={value}>{t(`priorities.${value}`)}</NativeSelectOption>)}
            </NativeSelect></Field>
          <Field className="gap-2 sm:col-span-2"><FieldLabel htmlFor="task-assignee">{t("assignee")}</FieldLabel>
            <NativeSelect id="task-assignee" name="assignee" defaultValue={task ? task.assigneeUserId ?? "" : currentUserId} className="w-full">
              <NativeSelectOption value="">{t("unassigned")}</NativeSelectOption>
              {members.map((member) => <NativeSelectOption key={member.id} value={member.id}>{member.id === currentUserId ? t("meNamed", { name: member.name }) : member.name}</NativeSelectOption>)}
            </NativeSelect></Field>
        </div>
        <Field className="gap-2"><FieldLabel htmlFor="task-body">{t("details")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel>
          <Textarea id="task-body" name="body" maxLength={5000} defaultValue={task?.body ?? ""} className="min-h-20" /></Field>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">{t("linkedTo")}</legend>
          {links.deal && <div className="flex min-h-9 items-center gap-2 rounded-md border px-2 text-sm"><Kanban className="size-4 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{links.deal.label}</span>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={t("removeRecord", { kind: t("deal") })} onClick={() => setLinks((current) => ({ ...current, deal: null }))}><X aria-hidden="true" /></Button></div>}
          {picker("contact", links.contact)}{picker("company", links.company)}
          <p className="text-xs text-muted-foreground">{t("linkedToHelp")}</p>
        </fieldset>
        <DialogFooter><DialogClose asChild><Button type="button" variant="ghost" disabled={busy}>{t("cancel")}</Button></DialogClose><Button disabled={busy}>{busy ? t("saving") : task ? t("saveTask") : t("createTask")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
