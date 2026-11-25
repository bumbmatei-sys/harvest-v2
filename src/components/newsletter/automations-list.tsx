"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MoreHorizontal, Plus, Search, Workflow } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { useCrmRequest } from "@/components/crm/request";
import type { StatusTone } from "@/lib/status-tone";
import type { AutomationTrigger } from "@/lib/newsletter-automations";

export type AutomationRow = { id: string; name: string; state: string; trigger: AutomationTrigger; stepCount: number; running: number; completed: number; stopped: number };
type Options = { lists: { id: string; name: string }[]; forms: { id: string; name: string }[] };
const tones: Record<string, StatusTone> = { draft: "neutral", active: "success", paused: "pending" };

/** The Automations list: a searchable table with enable and pause, and a small dialog to start a new one. */
export function AutomationsList({ tenantId, automations, options, names }: { tenantId: string; automations: AutomationRow[]; options: Options; names: { lists: Record<string, string>; forms: Record<string, string> } }) {
  const t = useTranslations("NewsletterAutomations"), c = useTranslations("NewsletterAutomations.create"), router = useRouter(), request = useCrmRequest();
  const [rows, setRows] = useState(automations), [query, setQuery] = useState(""), [error, setError] = useState(""), [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [name, setName] = useState(c("nameDefault")), [kind, setKind] = useState<"form" | "list">(options.forms.length ? "form" : "list"), [formId, setFormId] = useState(options.forms[0]?.id ?? ""), [listId, setListId] = useState(options.lists[0]?.id ?? "");
  const base = `/workspaces/${tenantId}/newsletter/automations`;
  const shown = useMemo(() => { const needle = query.trim().toLowerCase(); return rows.filter((a) => !needle || a.name.toLowerCase().includes(needle)); }, [rows, query]);
  const triggerLabel = (a: AutomationRow) => a.trigger.type === "form" ? t("triggerForm", { name: names.forms[a.trigger.formId] ?? t("triggerGone") }) : t("triggerList", { name: names.lists[a.trigger.listId] ?? t("triggerGone") });
  const ready = name.trim().length > 0 && (kind === "form" ? Boolean(formId) : Boolean(listId));

  async function create() {
    setBusy(true); setError("");
    const result = await request<{ id: string }>(`/api/workspaces/${tenantId}/newsletter/automations`, { method: "POST", body: { name: name.trim(), trigger: kind === "form" ? { type: "form", formId } : { type: "list", listId } } });
    setBusy(false);
    if (!result.ok) { setError(t("createFailed")); return; }
    router.push(`${base}/${result.data.id}`);
  }
  async function setState(a: AutomationRow, state: "active" | "paused") {
    setError("");
    const current = await request<{ version: number }>(`/api/workspaces/${tenantId}/newsletter/automations/${a.id}`, { method: "GET" });
    if (!current.ok) { setError(t("actionFailed")); return; }
    const result = await request<{ state: string }>(`/api/workspaces/${tenantId}/newsletter/automations/${a.id}`, { method: "PATCH", body: { version: current.data.version, state } });
    if (!result.ok) { setError(t("actionFailed")); return; }
    setRows((list) => list.map((row) => row.id === a.id ? { ...row, state: result.data.state } : row));
  }

  const columns: DataTableColumn[] = [
    { id: "name", header: t("columns.name"), card: "title" }, { id: "trigger", header: t("columns.trigger"), showFrom: "@md" }, { id: "status", header: t("columns.status") },
    { id: "people", header: t("columns.people"), showFrom: "@lg" }, { id: "actions", header: t("columns.actions"), srOnlyHeader: true, align: "end", card: "actions", className: "w-16" },
  ];
  const tableRows: DataTableRow[] = shown.map((a) => ({ id: a.id, label: a.name, cells: {
    name: <Link href={`${base}/${a.id}`} className="flex min-h-11 min-w-0 items-center truncate font-medium hover:underline">{a.name}</Link>,
    trigger: triggerLabel(a), status: <StatusBadge tone={tones[a.state] ?? "neutral"} label={t(`status.${a.state}` as "status.draft")} />,
    people: t("people", { running: a.running, completed: a.completed, stopped: a.stopped }),
    actions: <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("menu", { name: a.name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><DropdownMenuItem className="min-h-11" onSelect={() => router.push(`${base}/${a.id}`)}>{t("open")}</DropdownMenuItem>
        {a.state === "active" ? <DropdownMenuItem className="min-h-11" onSelect={() => void setState(a, "paused")}>{t("pause")}</DropdownMenuItem>
          : a.stepCount > 0 ? <DropdownMenuItem className="min-h-11" onSelect={() => void setState(a, "active")}>{t("activate")}</DropdownMenuItem> : null}</DropdownMenuContent></DropdownMenu>,
  } }));

  return <div className="min-w-0 space-y-6" data-automations-list>
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("heading")}</h1>
      <Button type="button" className="min-h-11" onClick={() => setOpen(true)}><Plus aria-hidden="true" />{t("newAutomation")}</Button>
    </header>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <section className="space-y-3">
      <div className="relative min-w-52 max-w-sm"><Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input className="min-h-11 ps-9" type="search" aria-label={t("search")} placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      {rows.length === 0 ? <EmptyState icon={Workflow} title={t("emptyTitle")} description={t("emptyBody")} />
        : shown.length === 0 ? <EmptyState icon={Search} size="compact" title={t("noMatch")} />
        : <DataTable label={t("heading")} columns={columns} rows={tableRows} />}
    </section>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-md" aria-describedby={undefined}><DialogHeader><DialogTitle>{c("title")}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2"><Label htmlFor="auto-name">{c("name")}</Label><Input id="auto-name" className="min-h-11" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="auto-kind">{c("startsWhen")}</Label>
          <NativeSelect id="auto-kind" className="w-full" value={kind} onChange={(e) => setKind(e.target.value as "form" | "list")}>
            <NativeSelectOption value="form">{c("form")}</NativeSelectOption><NativeSelectOption value="list">{c("list")}</NativeSelectOption></NativeSelect></div>
        {kind === "form" ? <div className="space-y-2"><Label htmlFor="auto-form">{c("pickForm")}</Label>
          {options.forms.length ? <NativeSelect id="auto-form" className="w-full" value={formId} onChange={(e) => setFormId(e.target.value)}>{options.forms.map((f) => <NativeSelectOption key={f.id} value={f.id}>{f.name}</NativeSelectOption>)}</NativeSelect>
            : <p className="text-sm text-muted-foreground">{c("noForms")}</p>}</div>
          : <div className="space-y-2"><Label htmlFor="auto-list">{c("pickList")}</Label>
          {options.lists.length ? <NativeSelect id="auto-list" className="w-full" value={listId} onChange={(e) => setListId(e.target.value)}>{options.lists.map((l) => <NativeSelectOption key={l.id} value={l.id}>{l.name}</NativeSelectOption>)}</NativeSelect>
            : <p className="text-sm text-muted-foreground">{c("noLists")}</p>}</div>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(false)}>{c("cancel")}</Button>
          <Button type="button" className="min-h-11" disabled={!ready || busy} onClick={() => void create()}>{c("submit")}</Button></div>
      </div></DialogContent></Dialog>
  </div>;
}
