/** Derived from Shadcn UI Kit item kanban-board3 (premium), registry retrieved 2026-11-26, approved 2026-11-26 (campaign boards). Local changes: docs/ui-sources.md. */
"use client";
import { useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowRight, Flag, LayoutGrid, List, Pencil, Plus, Trash2 } from "lucide-react";
import { taskStatuses, type BoardKey, type TaskStatus } from "@/lib/campaign-boards";
import type { BoardMilestone, BoardTask, CampaignBoardsView } from "@/server/campaign-boards";
import { BoardDue, BoardPerson, KanbanBoard, type KanbanColumn } from "@/components/board/kanban-board";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useRequest } from "@/hooks/use-request";

type Editing = { status: TaskStatus; task: BoardTask | null } | null;
// Column dots use theme tokens only.
const dots: Record<TaskStatus, string> = { todo: "size-2 shrink-0 rounded-full bg-muted-foreground", in_progress: "size-2 shrink-0 rounded-full bg-primary", done: "size-2 shrink-0 rounded-full bg-success" };

/**
 * A campaign's department boards (founder approval, 26 Nov): one board at a time on the shared KanbanBoard, with three fixed columns, plus the
 * campaign's milestones. People who can write campaigns add, edit, move and remove tasks and milestones; everyone else reads. Every change is checked
 * against the version it was loaded at; a refused change reloads the board from the server. Nothing is sent or published from here.
 */
export function CampaignBoards({ tenantId, campaignId, initial, today }: { tenantId: string; campaignId: string; initial: CampaignBoardsView; today: string }) {
  const t = useTranslations("CampaignBoards"), tw = useTranslations("CampaignWizard"), format = useFormatter(), request = useRequest();
  const [view, setView] = useState(initial), [board, setBoard] = useState<BoardKey>(initial.boards[0]?.key ?? "general"), [layout, setLayout] = useState<"board" | "list">("board");
  const [error, setError] = useState(""), [announcement, setAnnouncement] = useState(""), [editing, setEditing] = useState<Editing>(null), [busy, setBusy] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve()), versions = useRef<Record<string, number>>({});
  const api = `/api/workspaces/${tenantId}/campaigns/${campaignId}/boards`;
  const boardName = (key: BoardKey | null) => key === null || key === "general" ? t("general") : tw(`departments.${key}` as "departments.volunteers");
  const date = (value: string) => format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const tasks = view.boards.find((entry) => entry.key === board)?.tasks ?? [];
  const writable = view.writable;

  async function send(url: string, method: "POST" | "PATCH" | "DELETE", body: unknown) {
    const result = await request<CampaignBoardsView>(url, { method, body });
    const adopt = (next: CampaignBoardsView) => { for (const task of next.boards.flatMap((entry) => entry.tasks)) versions.current[task.id] = task.version; setView(next); };
    if (result.ok) { adopt(result.data); setError(""); return true; }
    setError(result.error); setAnnouncement(result.error);
    const fresh = await request<CampaignBoardsView>(api, { method: "GET" });
    if (fresh.ok) adopt(fresh.data);
    return false;
  }
  function move(task: BoardTask, status: string, index: number | undefined) {
    // Optimistic: the card joins its new column at the drop position; the server's answer replaces the board.
    setView((current) => ({ ...current, boards: current.boards.map((entry) => entry.key !== board ? entry : { ...entry, tasks: place(entry.tasks, task.id, status as TaskStatus, index) }) }));
    setAnnouncement(t("movedTo", { task: task.title, column: t(`columns.${status as TaskStatus}`) }));
    // Moves are queued, so a quick second move carries the version the first one returned.
    queue.current = queue.current.then(() => send(`${api}/tasks/${task.id}`, "PATCH",
      { version: Math.max(versions.current[task.id] ?? 0, task.version), status, ...(index === undefined ? {} : { position: index }) }));
  }
  async function submitTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget), text = (name: string) => String(form.get(name) ?? "");
    const fields = { title: text("title").trim(), notes: text("notes"), assigneeId: text("assignee") || null, dueDate: text("due") || null, milestoneId: text("milestone") || null };
    setBusy(true);
    const ok = editing.task
      ? await send(`${api}/tasks/${editing.task.id}`, "PATCH", { version: editing.task.version, ...fields, status: text("status") })
      : await send(`${api}/tasks`, "POST", { board, status: editing.status, ...fields });
    setBusy(false);
    if (ok) setEditing(null);
  }
  async function removeTask(task: BoardTask) {
    setBusy(true);
    if (await send(`${api}/tasks/${task.id}`, "DELETE", { version: task.version })) setEditing(null);
    setBusy(false);
  }

  const openNew = (status: TaskStatus) => { setError(""); setEditing({ status, task: null }); };
  const openTask = (task: BoardTask) => { setError(""); setEditing({ status: task.status, task }); };
  const columns: KanbanColumn[] = taskStatuses.map((status) => {
    const count = tasks.filter((task) => task.status === status).length, name = t(`columns.${status}`);
    return { id: status, title: name, count, label: t("columnLabel", { column: name, count }), empty: t("emptyColumn"), marker: <span aria-hidden="true" className={dots[status]} />,
      menuLabel: t("columnOptions", { column: name }), actions: writable ? [{ label: t("addTask"), icon: Plus, onSelect: () => openNew(status) }] : [] };
  });
  const cards = tasks.map((task) => ({ ...task, column: task.status, label: t("cardLabel", { task: task.title, column: t(`columns.${task.status}`) }) }));
  const milestoneName = (id: string | null) => view.milestones.find((milestone) => milestone.id === id)?.title ?? null;
  const overdue = (task: BoardTask) => task.status !== "done" && task.dueDate !== null && task.dueDate < today;
  const person = (task: BoardTask) => task.assigneeId ? <BoardPerson name={task.assigneeName ?? t("aMember")} /> : <span>{t("unassigned")}</span>;
  const due = (task: BoardTask) => task.dueDate ? <BoardDue label={date(task.dueDate)} overdue={overdue(task)} overdueLabel={t("overdueTask")} /> : null;
  function taskCard(task: BoardTask) {
    const milestone = milestoneName(task.milestoneId);
    return <>
      <p className="line-clamp-2 text-sm font-medium break-words">{task.title}</p>
      {task.notes && <p className="line-clamp-1 text-xs text-muted-foreground">{task.notes}</p>}
      {milestone && <Badge variant="outline" className="max-w-full truncate"><Flag aria-hidden="true" />{milestone}</Badge>}
      <div className="flex items-center justify-between gap-3 pt-1 text-xs text-muted-foreground">{person(task)}{due(task)}</div>
    </>;
  }
  function taskTable(rows: BoardTask[]) {
    return <div className="overflow-x-auto rounded-xl border"><Table>
      <TableHeader><TableRow><TableHead className="pl-4">{t("title")}</TableHead><TableHead>{t("status")}</TableHead><TableHead>{t("assignee")}</TableHead><TableHead>{t("due")}</TableHead><TableHead>{t("milestone")}</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.length === 0 && <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">{t("noTasks")}</TableCell></TableRow>}
        {[...rows].sort((a, b) => taskStatuses.indexOf(a.status) - taskStatuses.indexOf(b.status) || a.position - b.position).map((task) => <TableRow key={task.id}>
          <TableCell className="pl-4"><button type="button" className="min-h-11 text-left font-medium hover:underline lg:min-h-0" onClick={() => openTask(task)}>{task.title}</button></TableCell>
          <TableCell><span className="flex items-center gap-1.5 text-muted-foreground"><span aria-hidden="true" className={dots[task.status]} />{t(`columns.${task.status}`)}</span></TableCell>
          <TableCell>{person(task)}</TableCell><TableCell>{due(task)}</TableCell><TableCell className="max-w-48 truncate">{milestoneName(task.milestoneId) ?? ""}</TableCell>
        </TableRow>)}
      </TableBody></Table></div>;
  }

  return <div className="space-y-4">
    <p aria-live="polite" className="sr-only">{announcement}</p>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-wrap items-end gap-3">
      <Field className="min-w-0 flex-1 gap-2 sm:max-w-sm"><FieldLabel htmlFor="campaign-board">{t("board")}</FieldLabel>
        <NativeSelect id="campaign-board" value={board} onChange={(event) => setBoard(event.target.value as BoardKey)} className="min-h-11 w-full lg:min-h-9">
          {view.boards.map((entry) => <NativeSelectOption key={entry.key} value={entry.key}>{t("boardOption", { name: boardName(entry.key), count: entry.tasks.length })}</NativeSelectOption>)}
        </NativeSelect></Field>
      <ToggleGroup type="single" variant="outline" value={layout} onValueChange={(value) => { if (value) setLayout(value as "board" | "list"); }} aria-label={t("layout")}>
        <ToggleGroupItem value="board" aria-label={t("boardView")} className="size-11 lg:size-9"><LayoutGrid aria-hidden="true" /></ToggleGroupItem>
        <ToggleGroupItem value="list" aria-label={t("listView")} className="size-11 lg:size-9"><List aria-hidden="true" /></ToggleGroupItem>
      </ToggleGroup>
      {writable && <Button type="button" className="min-h-11 lg:min-h-9" onClick={() => openNew("todo")}><Plus aria-hidden="true" />{t("addTask")}</Button>}
    </div>
    {layout === "board" ? <KanbanBoard columns={columns} items={cards} writable={writable} reorder cardAttribute="data-campaign-task"
      copy={{ board: t("boardRegion", { name: boardName(board) }), hint: writable ? t("keyboardHint") : t("keyboardHintReadOnly"), pickedUp: (item) => t("pickedUp", { task: item.title }),
        over: (column) => t("overColumn", { column: column.title }), dropped: (column) => t("droppedIn", { column: column.title }), cancelled: t("dragCancelled") }}
      onMove={(task, status, index) => move(task, status, index)} onOpen={openTask}
      overlay={(task) => task.title}
      cardMenu={(task) => ({ label: t("taskActions", { task: task.title }), actions: [
        { label: writable ? t("editTask") : t("viewTask"), icon: Pencil, onSelect: () => openTask(task) },
        ...(writable ? taskStatuses.filter((status) => status !== task.status).map((status, index) => ({ label: t("moveTo", { column: t(`columns.${status}`) }), icon: ArrowRight, onSelect: () => move(task, status, undefined), separatorBefore: index === 0 })) : []),
        ...(writable ? [{ label: t("deleteTask"), icon: Trash2, destructive: true, separatorBefore: true, onSelect: () => void removeTask(task) }] : []),
      ] })}
      renderCard={taskCard} /> : taskTable(tasks)}
    <Milestones tenantId={tenantId} campaignId={campaignId} view={view} boardName={boardName} date={date} send={send} />

    <Dialog open={editing !== null} onOpenChange={(open) => { if (!open && !busy) setEditing(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[520px]">
        <DialogHeader><DialogTitle>{editing?.task ? (writable ? t("editTask") : editing.task.title) : t("newTask")}</DialogTitle>
          <DialogDescription>{t("taskDialogDescription", { board: boardName(board) })}</DialogDescription></DialogHeader>
        {editing && <form onSubmit={submitTask} className="space-y-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <fieldset disabled={!writable || busy} className="space-y-4">
            <Field className="gap-2"><FieldLabel htmlFor="campaign-task-title">{t("title")}</FieldLabel><Input id="campaign-task-title" name="title" required maxLength={200} defaultValue={editing.task?.title ?? ""} autoFocus /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {editing.task && <Field className="gap-2"><FieldLabel htmlFor="campaign-task-status">{t("status")}</FieldLabel>
                <NativeSelect id="campaign-task-status" name="status" defaultValue={editing.task.status} className="w-full">
                  {taskStatuses.map((status) => <NativeSelectOption key={status} value={status}>{t(`columns.${status}`)}</NativeSelectOption>)}</NativeSelect></Field>}
              <Field className="gap-2"><FieldLabel htmlFor="campaign-task-due">{t("due")}</FieldLabel><Input id="campaign-task-due" name="due" type="date" defaultValue={editing.task?.dueDate ?? ""} /></Field>
              <Field className="gap-2"><FieldLabel htmlFor="campaign-task-assignee">{t("assignee")}</FieldLabel>
                <NativeSelect id="campaign-task-assignee" name="assignee" defaultValue={editing.task?.assigneeId ?? ""} className="w-full">
                  <NativeSelectOption value="">{t("unassigned")}</NativeSelectOption>
                  {editing.task?.assigneeId && !view.assignees.some((person) => person.id === editing.task?.assigneeId) && <NativeSelectOption value={editing.task.assigneeId}>{editing.task.assigneeName ?? t("aMember")}</NativeSelectOption>}
                  {view.assignees.map((person) => <NativeSelectOption key={person.id} value={person.id}>{person.name || t("aMember")}</NativeSelectOption>)}
                </NativeSelect></Field>
              <Field className="gap-2"><FieldLabel htmlFor="campaign-task-milestone">{t("milestone")}</FieldLabel>
                <NativeSelect id="campaign-task-milestone" name="milestone" defaultValue={editing.task?.milestoneId ?? ""} className="w-full">
                  <NativeSelectOption value="">{t("noMilestone")}</NativeSelectOption>
                  {view.milestones.map((milestone) => <NativeSelectOption key={milestone.id} value={milestone.id}>{milestone.title}</NativeSelectOption>)}
                </NativeSelect></Field>
            </div>
            <Field className="gap-2"><FieldLabel htmlFor="campaign-task-notes">{t("notes")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel>
              <Textarea id="campaign-task-notes" name="notes" maxLength={5000} defaultValue={editing.task?.notes ?? ""} className="min-h-20" /></Field>
          </fieldset>
          <DialogFooter className="gap-2">
            {writable && editing.task && <Button type="button" variant="ghost" className="min-h-11 text-destructive sm:mr-auto lg:min-h-9" disabled={busy} onClick={() => editing.task && void removeTask(editing.task)}>
              <Trash2 aria-hidden="true" />{t("deleteTask")}</Button>}
            <DialogClose asChild><Button type="button" variant="ghost" className="min-h-11 lg:min-h-9" disabled={busy}>{writable ? t("cancel") : t("close")}</Button></DialogClose>
            {writable && <Button className="min-h-11 lg:min-h-9" disabled={busy}>{busy ? t("saving") : editing.task ? t("saveTask") : t("createTask")}</Button>}
          </DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  </div>;
}

/** Moves a task to `index` in a column (the end when omitted), renumbering that column the way the server does. */
function place(tasks: BoardTask[], id: string, status: TaskStatus, index?: number) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return tasks;
  const column = tasks.filter((item) => item.status === status && item.id !== id);
  column.splice(Math.min(index ?? column.length, column.length), 0, { ...task, status });
  const placed = new Map(column.map((item, position) => [item.id, { ...item, position }]));
  return tasks.filter((item) => item.status !== status && item.id !== id).concat([...placed.values()]);
}

function Milestones({ tenantId, campaignId, view, boardName, date, send }: {
  tenantId: string; campaignId: string; view: CampaignBoardsView; boardName: (key: BoardKey | null) => string; date: (value: string) => string;
  send: (url: string, method: "POST" | "PATCH" | "DELETE", body: unknown) => Promise<boolean>;
}) {
  const t = useTranslations("CampaignBoards"), [busy, setBusy] = useState<string | null>(null);
  const api = `/api/workspaces/${tenantId}/campaigns/${campaignId}/boards/milestones`;
  async function run(key: string, url: string, method: "POST" | "PATCH" | "DELETE", body: unknown) { setBusy(key); const ok = await send(url, method, body); setBusy(null); return ok; }
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget, form = new FormData(target);
    const ok = await run("new", api, "POST", { title: String(form.get("title") ?? "").trim(), dueDate: String(form.get("due") ?? "") || null, board: String(form.get("board") ?? "") || null });
    if (ok) target.reset();
  }
  const label = (milestone: BoardMilestone) => [milestone.board ? boardName(milestone.board) : t("general"), milestone.dueDate ? date(milestone.dueDate) : null,
    milestone.tasks ? t("milestoneTasks", { done: milestone.tasksDone, total: milestone.tasks }) : null].filter(Boolean).join(" · ");
  return <Card>
    <CardHeader><CardTitle><h2 className="text-base font-semibold">{t("milestones")}</h2></CardTitle>
      <CardDescription>{t("milestonesSummary", { reached: view.milestones.filter((milestone) => milestone.reached).length, total: view.milestones.length })}</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      {view.milestones.length ? <ul className="space-y-2">{view.milestones.map((milestone) => {
        const id = `milestone-${milestone.id}`;
        return <li key={milestone.id} className="flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2">
          <Checkbox id={id} checked={milestone.reached} disabled={!view.writable || busy === milestone.id}
            aria-label={milestone.reached ? t("markNotReached", { milestone: milestone.title }) : t("markReached", { milestone: milestone.title })}
            onCheckedChange={(next) => void run(milestone.id, `${api}/${milestone.id}`, "PATCH", { version: milestone.version, reached: next === true })} />
          <Label htmlFor={id} className="min-w-0 flex-1 flex-col items-start gap-0.5 font-normal">
            <span className={milestone.reached ? "break-words text-muted-foreground line-through" : "break-words"}>{milestone.title}</span>
            <span className="text-xs text-muted-foreground">{label(milestone)}</span>
          </Label>
          {view.writable && <Button type="button" size="icon-sm" variant="ghost" className="size-11 shrink-0 lg:size-8" disabled={busy === milestone.id} aria-label={t("deleteMilestone", { milestone: milestone.title })}
            onClick={() => void run(milestone.id, `${api}/${milestone.id}`, "DELETE", { version: milestone.version })}><Trash2 aria-hidden="true" /></Button>}
        </li>;
      })}</ul> : <p className="text-sm text-muted-foreground">{t("noMilestones")}</p>}
      {view.writable && <form onSubmit={add} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <Field className="gap-2"><FieldLabel htmlFor="milestone-title">{t("milestoneTitle")}</FieldLabel><Input id="milestone-title" name="title" required maxLength={200} className="min-h-11 lg:min-h-9" /></Field>
        <Field className="gap-2"><FieldLabel htmlFor="milestone-due">{t("due")}</FieldLabel><Input id="milestone-due" name="due" type="date" className="min-h-11 lg:min-h-9" /></Field>
        <Field className="gap-2"><FieldLabel htmlFor="milestone-board">{t("board")}</FieldLabel>
          <NativeSelect id="milestone-board" name="board" defaultValue="" className="min-h-11 w-full lg:min-h-9">
            <NativeSelectOption value="">{t("general")}</NativeSelectOption>
            {view.boards.filter((entry) => entry.key !== "general").map((entry) => <NativeSelectOption key={entry.key} value={entry.key}>{boardName(entry.key)}</NativeSelectOption>)}
          </NativeSelect></Field>
        <Button className="min-h-11 lg:min-h-9" disabled={busy === "new"}><Plus aria-hidden="true" />{t("addMilestone")}</Button>
      </form>}
    </CardContent>
  </Card>;
}
