"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Inbox, ListFilter, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { nextSortDirection, type SortDirection } from "@/lib/data-table";
import { defineStatusTones, statusTones } from "@/lib/status-tone";

type Sample = { id: string; name: string; status: "open" | "done" | "waiting"; mine: boolean };
const samples: Sample[] = [
  { id: "a", name: "Sample item A", status: "open", mine: true }, { id: "b", name: "Sample item B", status: "done", mine: false },
  { id: "c", name: "Sample item C", status: "waiting", mine: true }, { id: "d", name: "Sample item D", status: "open", mine: false },
  { id: "e", name: "Sample item E", status: "done", mine: true },
];
const tone = defineStatusTones({ open: "info", done: "success", waiting: "pending" });
type View = "ready" | "loading" | "empty" | "error";

function TableExample() {
  const t = useTranslations("UiShowcase.pageParts");
  const [view, setView] = useState<View>("ready"), [tab, setTab] = useState("all"), [query, setQuery] = useState(""), [mine, setMine] = useState(false);
  const [direction, setDirection] = useState<SortDirection>("none"), [selected, setSelected] = useState<string[]>([]), [removed, setRemoved] = useState(0);
  const inTab = samples.filter(item => tab === "all" || item.status === tab);
  const visible = (view === "empty" ? [] : inTab).filter(item => (!mine || item.mine) && item.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => direction === "none" ? 0 : (direction === "ascending" ? 1 : -1) * a.name.localeCompare(b.name));
  const columns: DataTableColumn[] = [
    { id: "name", header: t("name"), card: "title", sort: { direction, onSort: () => setDirection(nextSortDirection(direction)) } },
    { id: "status", header: t("status") },
    { id: "actions", header: t("actions"), srOnlyHeader: true, align: "end", card: "actions" },
  ];
  const rows: DataTableRow[] = visible.map(item => ({ id: item.id, label: item.name, cells: {
    name: item.name,
    status: <StatusBadge dot tone={tone(item.status)} label={t(`statuses.${item.status}`)} />,
    actions: <Button size="sm" variant="outline" onClick={() => setRemoved(count => count + 1)} aria-label={t("openNamed", { name: item.name })}>{t("open")}</Button>,
  } }));
  const count = (status: string) => samples.filter(item => status === "all" || item.status === status).length;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3"><span className="text-sm font-medium">{t("viewState")}</span>
      <ToggleGroup type="single" variant="outline" value={view} onValueChange={value => { if (value) setView(value as View); }} aria-label={t("viewState")}>
        {(["ready", "loading", "empty", "error"] as const).map(value => <ToggleGroupItem key={value} value={value}>{t(`views.${value}`)}</ToggleGroupItem>)}
      </ToggleGroup></div>
    <DataTable label={t("tableLabel")} columns={columns} rows={rows} state={view === "loading" ? "loading" : view === "error" ? "error" : "ready"}
      tabs={{ label: t("statusTabs"), value: tab, onValueChange: value => { setTab(value); setSelected([]); }, items: [{ value: "all", label: t("all"), count: count("all") }, { value: "open", label: t("statuses.open"), count: count("open") }, { value: "waiting", label: t("statuses.waiting"), count: count("waiting") }, { value: "done", label: t("statuses.done"), count: count("done") }] }}
      toolbar={{
        search: <Input type="search" className="min-h-11 lg:min-h-9" aria-label={t("search")} placeholder={t("search")} value={query} onChange={event => setQuery(event.target.value)} />,
        filters: <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-responsive" variant="outline" aria-label={t("filters")}><ListFilter aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start"><DropdownMenuCheckboxItem className="min-h-11 lg:min-h-0" checked={mine} onCheckedChange={value => setMine(value === true)}>{t("onlyMine")}</DropdownMenuCheckboxItem></DropdownMenuContent></DropdownMenu>,
      }}
      selection={{ selected, onChange: setSelected }}
      bulk={{ label: t("bulkLabel"), actions: <Button size="responsive" variant="outline" onClick={() => { setRemoved(count => count + selected.length); setSelected([]); }}><Trash2 aria-hidden="true" />{t("archive")}</Button> }}
      empty={<EmptyState size="compact" icon={Inbox} title={t("emptyTitle")} action={<Button size="responsive" variant="outline" onClick={() => { setQuery(""); setMine(false); setTab("all"); setView("ready"); }}>{t("reset")}</Button>} />}
      error={<Alert variant="destructive" role="alert"><AlertDescription>{t("errorText")}<Button size="responsive" variant="outline" onClick={() => setView("ready")}>{t("retry")}</Button></AlertDescription></Alert>}
      pagination={<div className="flex items-center justify-between gap-2 text-sm text-muted-foreground"><span>{t("pageSummary", { count: visible.length })}</span>
        <div className="flex gap-2"><Button size="icon-responsive" variant="outline" disabled aria-label={t("previous")}><ChevronLeft aria-hidden="true" /></Button><Button size="icon-responsive" variant="outline" disabled aria-label={t("next")}><ChevronRight aria-hidden="true" /></Button></div></div>} />
    <p role="status" className="text-sm text-muted-foreground">{t("localActions", { count: removed })}</p>
  </div>;
}

function ConfirmExamples() {
  const t = useTranslations("UiShowcase.pageParts.confirm");
  const [outcome, setOutcome] = useState("");
  const wait = () => new Promise<void>(resolve => setTimeout(resolve, 700));
  return <div className="space-y-3"><div className="flex flex-wrap gap-2">
    <ConfirmDialog tone="destructive" title={t("destructiveTitle")} description={t("destructiveBody")} confirmLabel={t("destructiveConfirm")} busyLabel={t("working")} cancelLabel={t("cancel")}
      onConfirm={async () => { await wait(); setOutcome(t("done")); }} trigger={<Button size="responsive" variant="outline">{t("destructiveOpen")}</Button>} />
    <ConfirmDialog tone="neutral" title={t("neutralTitle")} description={t("neutralBody")} confirmLabel={t("neutralConfirm")} cancelLabel={t("cancel")}
      onConfirm={() => setOutcome(t("neutralDone"))} trigger={<Button size="responsive" variant="outline">{t("neutralOpen")}</Button>} />
    <ConfirmDialog tone="destructive" title={t("failTitle")} confirmLabel={t("failConfirm")} cancelLabel={t("cancel")}
      onConfirm={async () => { await wait(); return t("failMessage"); }} trigger={<Button size="responsive" variant="outline">{t("failOpen")}</Button>} />
  </div><p role="status" className="text-sm text-muted-foreground">{outcome || t("idle")}</p></div>;
}

export function PagePartsExamples() {
  const t = useTranslations("UiShowcase.pageParts");
  return <div className="space-y-8">
    <div className="space-y-3"><h3 className="text-sm font-medium">{t("tableTitle")}</h3><TableExample /></div>
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-3"><h3 className="text-sm font-medium">{t("emptyStandardTitle")}</h3><EmptyState icon={Inbox} title={t("emptyTitle")} description={t("emptyDescription")} action={<Button size="responsive">{t("create")}</Button>} secondary={<Button size="responsive" variant="outline">{t("import")}</Button>} /></div>
      <div className="space-y-3"><h3 className="text-sm font-medium">{t("emptyCompactTitle")}</h3><EmptyState size="compact" title={t("emptyTitle")} action={<Button size="responsive" variant="outline">{t("create")}</Button>} /></div>
    </div>
    <div className="space-y-3"><h3 className="text-sm font-medium">{t("badgesTitle")}</h3>
      <div data-example-badges className="flex flex-wrap items-center gap-2">{statusTones.map(value => <StatusBadge key={value} tone={value} dot label={t(`tones.${value}`)} />)}</div>
      <div className="flex flex-wrap items-center gap-2">{statusTones.map(value => <StatusBadge key={value} tone={value} label={t(`tones.${value}`)} />)}</div></div>
    <div className="space-y-3"><h3 className="text-sm font-medium">{t("confirmTitle")}</h3><ConfirmExamples /></div>
  </div>;
}
