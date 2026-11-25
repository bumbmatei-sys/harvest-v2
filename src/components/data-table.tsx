/** Derived from Shadcn UI Kit item tables14 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 3). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ArrowUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import { CARD_LAYOUT_MAX_WIDTH, cardParts, resolveLayout, selectionState, toggleAll, toggleRow, type CardRole, type SortDirection, type TableLayout } from "@/lib/data-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/status-badge";

export type DataTableColumn = {
  id: string;
  /** Visible header text; also the label of the value in the card layout. */
  header: string;
  /** Hide the visible header (an actions column); the text stays for assistive technology. */
  srOnlyHeader?: boolean;
  align?: "start" | "end";
  /** Table layout only: hide this column in a container narrower than this (container query, not viewport). */
  showFrom?: "@md" | "@lg" | "@3xl";
  className?: string;
  /** Card layout: `title` heads the card, `actions` fills its footer, `meta` (default) is a labelled line, `hidden` is dropped. */
  card?: CardRole;
  /** Presence makes the header sortable. `direction` is current state; the caller owns sorting (a handler or a link). */
  sort?: { direction: SortDirection; onSort?: () => void; href?: string };
};
export type DataTableRow = {
  id: string;
  /** Short name of the row, used in the selection checkbox label. */
  label: string;
  /** Cell content by column id. Elements are fine from a server component; functions are not. */
  cells: Record<string, React.ReactNode>;
  className?: string;
};
export type DataTableTabs = { label: string; value: string; onValueChange: (value: string) => void; items: readonly { value: string; label: string; count?: number | string }[] };
export type DataTableSelection = { selected: readonly string[]; onChange: (selected: string[]) => void };

const showFromClass = { "@md": "hidden @md:table-cell", "@lg": "hidden @lg:table-cell", "@3xl": "hidden @3xl:table-cell" } as const;
const alignClass = { start: "text-left", end: "text-right" } as const;
/** Action buttons in table rows reach 44px below 1024px even when the caller used a compact size. */
const actionCellClass = "max-lg:[&_:is(button,[data-slot=button])]:min-h-11 max-lg:[&_:is(button,[data-slot=button])]:min-w-11";
const sortIcon = { ascending: ArrowUp, descending: ArrowDown, none: ArrowUpDown } as const;

function SortControl({ column }: { column: DataTableColumn & { sort: NonNullable<DataTableColumn["sort"]> } }) {
  const Icon = sortIcon[column.sort.direction];
  const classes = cn("-ms-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-8", column.align === "end" && "-me-2 ms-0");
  const content = <>{column.header}<Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /></>;
  return column.sort.href ? <Link href={column.sort.href} className={classes}>{content}</Link> : <button type="button" className={classes} onClick={column.sort.onSort}>{content}</button>;
}

function SelectBox({ checked, label, onChange }: { checked: boolean | "indeterminate"; label: string; onChange: () => void }) {
  // The label is the 44px (phones) hit area; the checkbox itself keeps its drawn size.
  return <label className="flex size-11 cursor-pointer items-center justify-center lg:size-8"><Checkbox checked={checked} aria-label={label} onCheckedChange={onChange} /></label>;
}

/**
 * Presentational list/table shell: toolbar slots, optional status tabs with counts, sortable headers, optional row
 * selection with a bulk-action bar, loading / empty / error slots and a pagination slot. Below 768px (or with
 * `layout="cards"`) rows become a stacked card list with the same data. It never fetches data and knows no domain:
 * sorting, filtering, paging and permissions stay with the caller.
 */
export function DataTable({ label, note, columns, rows, totals, state = "ready", layout = "auto", fixed = false, bordered = true, toolbar, tabs, selection, bulk, empty, error, loadingLabel, pagination, className }: {
  /** Accessible name of the table or list. */
  label: string;
  /** Visible note under the table (for example how many rows are shown). */
  note?: string;
  columns: readonly DataTableColumn[];
  rows: readonly DataTableRow[];
  /** An optional totals row under the rows (table layout) or a summary block under the cards; cells by column id, the first column carries the label. */
  totals?: { label: string; cells: Record<string, React.ReactNode> };
  state?: "ready" | "loading" | "error";
  layout?: TableLayout;
  /** Table layout: fixed column widths, so long cell text truncates instead of widening the table (give columns widths in `className`). */
  fixed?: boolean;
  /** Draw the rounded border and card surface; turn off when the table already sits inside a card. */
  bordered?: boolean;
  /** Search and filter controls on the left; `actions` (export, create) on the right. */
  toolbar?: { search?: React.ReactNode; filters?: React.ReactNode; actions?: React.ReactNode };
  tabs?: DataTableTabs;
  selection?: DataTableSelection;
  /** Shown above the table while at least one row is selected. */
  bulk?: { label: string; actions: React.ReactNode };
  empty?: React.ReactNode;
  error?: React.ReactNode;
  loadingLabel?: string;
  pagination?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations("ComponentsDataTable");
  const narrow = useMediaQuery(`(max-width: ${CARD_LAYOUT_MAX_WIDTH}px)`);
  const mode = resolveLayout(layout, narrow);
  const ids = rows.map((row) => row.id), picked = selection?.selected ?? [];
  const state_ = selectionState(ids, picked), selectedCount = ids.filter((id) => picked.includes(id)).length;
  const sortable = columns.filter((column): column is DataTableColumn & { sort: NonNullable<DataTableColumn["sort"]> } => column.sort !== undefined);

  const body = state === "loading"
    ? <div role="status" aria-label={loadingLabel ?? t("loading")} data-slot="data-table-loading" className="divide-y">{[0, 1, 2, 3].map((index) => <div key={index} className="flex items-center gap-4 p-4"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 w-1/4" /><Skeleton className="ms-auto h-4 w-16" /></div>)}</div>
    : state === "error" ? <div data-slot="data-table-error" className="p-4">{error}</div>
    : rows.length === 0 ? <div data-slot="data-table-empty" className="p-2">{empty}</div>
    : mode === "table" ? <Table aria-label={label} aria-rowcount={rows.length} className={fixed ? "table-fixed" : undefined}>
      <TableHeader><TableRow>
        {selection && <TableHead className="w-16"><SelectBox checked={state_ === "all" ? true : state_ === "some" ? "indeterminate" : false} label={t("selectAll")} onChange={() => selection.onChange(toggleAll(ids, picked))} /></TableHead>}
        {columns.map((column) => <TableHead key={column.id} aria-sort={column.sort?.direction} className={cn(column.align && alignClass[column.align], column.showFrom && showFromClass[column.showFrom], column.className)}>
          {column.sort ? <SortControl column={{ ...column, sort: column.sort }} /> : column.srOnlyHeader ? <span className="sr-only">{column.header}</span> : column.header}</TableHead>)}
      </TableRow></TableHeader>
      <TableBody>{rows.map((row) => <TableRow key={row.id} data-state={picked.includes(row.id) ? "selected" : undefined} className={row.className}>
        {selection && <TableCell className="w-16"><SelectBox checked={picked.includes(row.id)} label={t("selectRow", { name: row.label })} onChange={() => selection.onChange(toggleRow(picked, row.id))} /></TableCell>}
        {columns.map((column) => <TableCell key={column.id} className={cn(column.align && alignClass[column.align], column.showFrom && showFromClass[column.showFrom], column.card === "actions" && actionCellClass, column.className)}>{row.cells[column.id]}</TableCell>)}
      </TableRow>)}</TableBody>
      {totals && <TableFooter><TableRow data-slot="data-table-totals">
        {selection && <TableCell className="w-16" />}
        {columns.map((column, index) => <TableCell key={column.id} className={cn("font-medium", column.align && alignClass[column.align], column.showFrom && showFromClass[column.showFrom], column.className)}>{index === 0 ? totals.label : totals.cells[column.id]}</TableCell>)}
      </TableRow></TableFooter>}
      {note && <TableCaption>{note}</TableCaption>}
    </Table>
    : <>
      {selection && <div className="flex items-center gap-1 border-b ps-1 pe-3 text-sm"><SelectBox checked={state_ === "all" ? true : state_ === "some" ? "indeterminate" : false} label={t("selectAll")} onChange={() => selection.onChange(toggleAll(ids, picked))} /><span className="text-muted-foreground">{t("selectAll")}</span></div>}
      <ul aria-label={label} data-slot="data-table-cards" className="divide-y">{rows.map((row) => {
        const { title, meta, actions } = cardParts(columns);
        return <li key={row.id} data-slot="data-table-card" data-state={picked.includes(row.id) ? "selected" : undefined} className={cn("space-y-2 p-4 data-[state=selected]:bg-selected", row.className)}>
          <div className="flex items-start gap-2">
            {selection && <div className="-ms-2 -mt-2"><SelectBox checked={picked.includes(row.id)} label={t("selectRow", { name: row.label })} onChange={() => selection.onChange(toggleRow(picked, row.id))} /></div>}
            <div className="min-w-0 flex-1 font-medium break-words">{title && row.cells[title.id]}</div>
          </div>
          {meta.length > 0 && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">{meta.map((column) => <div key={column.id} className="contents"><dt className="text-muted-foreground">{column.header}</dt><dd className="min-w-0 break-words">{row.cells[column.id]}</dd></div>)}</dl>}
          {actions && <div data-slot="data-table-card-actions" className="flex flex-wrap items-center gap-2 pt-1 [&_:is(button,[data-slot=button])]:min-h-11 [&_:is(button,[data-slot=button])]:min-w-11">{row.cells[actions.id]}</div>}
        </li>;
      })}</ul>
      {totals && <div data-slot="data-table-totals" className="space-y-2 border-t bg-muted/40 p-4">
        <p className="font-medium">{totals.label}</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">{columns.filter((column) => column.card !== "title" && column.card !== "actions" && column.card !== "hidden" && totals.cells[column.id] !== undefined).map((column) => <div key={column.id} className="contents"><dt className="text-muted-foreground">{column.header}</dt><dd className="min-w-0 break-words">{totals.cells[column.id]}</dd></div>)}</dl>
      </div>}
      {note && <p className="p-3 text-sm text-muted-foreground">{note}</p>}
    </>;

  const toolbarHasContent = toolbar && (toolbar.search || toolbar.filters || toolbar.actions);
  const cardSort = mode === "cards" && sortable.length > 0 && state === "ready" && rows.length > 0;
  const results = <div data-slot="data-table-results" data-layout={mode} className={cn("group/results @container min-w-0 overflow-hidden", bordered && "rounded-lg border bg-card")}>{body}</div>;
  return <div data-slot="data-table" className={cn("min-w-0 space-y-3", className)}>
    {(toolbarHasContent || cardSort) && <div data-slot="data-table-toolbar" className="flex flex-wrap items-center gap-2">
      {toolbar?.search && <div className="min-w-0 flex-1 sm:max-w-xs">{toolbar.search}</div>}
      {toolbar?.filters}
      {cardSort && <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" size="responsive"><ArrowUpDown aria-hidden="true" />{t("sort")}</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">{sortable.map((column) => {
          const Icon = sortIcon[column.sort.direction];
          return column.sort.href
            ? <DropdownMenuItem key={column.id} asChild className="min-h-11 lg:min-h-0"><Link href={column.sort.href}>{column.header}<Icon className="ms-auto" aria-hidden="true" /><span className="sr-only">{t(column.sort.direction)}</span></Link></DropdownMenuItem>
            : <DropdownMenuItem key={column.id} className="min-h-11 lg:min-h-0" onSelect={column.sort.onSort}>{column.header}<Icon className="ms-auto" aria-hidden="true" /><span className="sr-only">{t(column.sort.direction)}</span></DropdownMenuItem>;
        })}</DropdownMenuContent></DropdownMenu>}
      {toolbar?.actions && <div className="ms-auto flex flex-wrap items-center gap-2">{toolbar.actions}</div>}
    </div>}
    {tabs
      ? <Tabs value={tabs.value} onValueChange={tabs.onValueChange} className="gap-3">
        <div className="overflow-x-auto [scrollbar-width:none]"><TabsList variant="line" aria-label={tabs.label} className="gap-1">{tabs.items.map((item) => <TabsTrigger key={item.value} value={item.value} className="flex-none gap-1.5">{item.label}{item.count !== undefined && <StatusBadge tone={item.value === tabs.value ? "info" : "neutral"} label={String(item.count)} className="tabular-nums" />}</TabsTrigger>)}</TabsList></div>
        {bulk && selectedCount > 0 && <BulkBar bulk={bulk} count={selectedCount} onClear={() => selection?.onChange(picked.filter((id) => !ids.includes(id)))} />}
        <TabsContent value={tabs.value} className="space-y-3">{results}{pagination}</TabsContent>
      </Tabs>
      : <>
        {bulk && selectedCount > 0 && <BulkBar bulk={bulk} count={selectedCount} onClear={() => selection?.onChange(picked.filter((id) => !ids.includes(id)))} />}
        {results}{pagination}
      </>}
  </div>;
}

function BulkBar({ bulk, count, onClear }: { bulk: { label: string; actions: React.ReactNode }; count: number; onClear: () => void }) {
  const t = useTranslations("ComponentsDataTable");
  return <div role="region" aria-label={bulk.label} data-slot="data-table-bulk" className="flex flex-wrap items-center gap-2 rounded-lg border bg-selected px-3 py-2">
    <span role="status" className="text-sm font-medium">{t("selectedCount", { count })}</span>
    <div className="flex flex-wrap items-center gap-2">{bulk.actions}</div>
    <Button type="button" variant="ghost" size="responsive" className="ms-auto" onClick={onClear}><X aria-hidden="true" />{t("clearSelection")}</Button>
  </div>;
}
