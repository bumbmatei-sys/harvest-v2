"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { NAME_MIN_WIDTH, type Density, type ObjectType } from "@/lib/crm-fields";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { initials } from "./format";
import { useCrmRequest } from "./request";

export type EditSpec = { kind: "text" | "email" | "tel" | "number" | "date" | "boolean" | "select"; value: string; options?: { value: string; label: string }[]; target: "builtin" | "custom"; field: string; maxLength?: number };
export type GridCell = { text: string; muted?: boolean; href?: string; external?: boolean; badge?: "granted" | "withdrawn" | "none"; more?: number; title?: string; label?: string; edit?: EditSpec };
export type GridRow = { id: string; version: number; name: string; href: string; secondary: string; cells: Record<string, GridCell> };
export type GridColumn = { key: string; label: string; width: number; numeric?: boolean };

const CELL_PADDING = 16;
/**
 * Per-grid container-query rules: column i shows only once the card can fit the Name
 * minimum plus every earlier column. Any column set therefore fits without the card
 * ever scrolling sideways, at any sidebar state (the CRM-02 overflow guarantee).
 */
function columnRules(gridId: string, columns: GridColumn[]) {
  let needed = NAME_MIN_WIDTH + CELL_PADDING * 2;
  return columns.map((column, index) => {
    needed += column.width;
    const selector = `[data-grid="${gridId}"] [data-col="${index + 1}"]`;
    return `${selector}{display:none}@container (min-width:${needed}px){${selector}{display:table-cell}}`;
  }).join("");
}

export function RecordGrid({ tenantId, objectType, columns, rows, density, label, nameLabel, writable }: {
  tenantId: string; objectType: ObjectType; columns: GridColumn[]; rows: GridRow[]; density: Density; label: string; nameLabel: string; writable: boolean;
}) {
  const t = useTranslations("Crm");
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const gridId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const cardRef = useRef<HTMLDivElement>(null), tableRef = useRef<HTMLTableElement>(null);
  const [active, setActive] = useState({ row: 0, col: 0 }), [editing, setEditing] = useState<{ row: number; col: number; draft: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [versions, setVersions] = useState<Record<string, number>>({});
  const [hiddenCount, setHiddenCount] = useState(0);
  const committing = useRef(false);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new ResizeObserver(([entry]) => {
      let needed = NAME_MIN_WIDTH + CELL_PADDING * 2, hidden = 0;
      for (const column of columns) { needed += column.width; if (needed > entry.contentRect.width) hidden += 1; }
      setHiddenCount(hidden);
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, [columns]);

  const cellAt = (row: number, col: number) => tableRef.current?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`) ?? null;
  /** Column indexes currently shown (container queries may hide trailing ones). */
  const shownColumns = () => [0, ...columns.map((_, index) => index + 1).filter((index) => cellAt(0, index)?.offsetParent)];
  function focusCell(row: number, col: number) { setActive({ row, col }); requestAnimationFrame(() => cellAt(row, col)?.focus()); }
  function move(dRow: number, dCol: number) {
    const shown = shownColumns(), position = shown.indexOf(active.col);
    let row = active.row, index = position + dCol;
    // Like Twenty: moving right from the last column wraps to the next row's first cell.
    if (index >= shown.length) { if (row < rows.length - 1) { row += 1; index = 0; } else index = shown.length - 1; }
    if (index < 0) { if (row > 0) { row -= 1; index = shown.length - 1; } else index = 0; }
    row = Math.min(Math.max(row + dRow, 0), rows.length - 1);
    focusCell(row, shown[index]);
  }
  const editSpec = (row: number, col: number) => (col === 0 ? undefined : rows[row]?.cells[columns[col - 1].key]?.edit);
  function startEdit(row: number, col: number) {
    const spec = editSpec(row, col);
    if (!spec || !writable) return;
    setError(""); setEditing({ row, col, draft: spec.value });
  }
  async function commit(then?: () => void) {
    if (!editing || committing.current) return;
    const spec = editSpec(editing.row, editing.col)!, record = rows[editing.row];
    const draft = editing.draft.trim();
    if (draft === spec.value) { setEditing(null); focusCell(editing.row, editing.col); then?.(); return; }
    const base = `/api/workspaces/${tenantId}/${objectType === "person" ? "contacts" : "companies"}/${record.id}`;
    const version = versions[record.id] ?? record.version;
    let typed: string | number | boolean | null = draft;
    if (spec.target === "custom") typed = draft === "" ? null : spec.kind === "number" ? Number(draft) : spec.kind === "boolean" ? draft === "true" : draft;
    committing.current = true; setBusy(true);
    const result = spec.target === "custom"
      ? await crmRequest<{ version: number }>(`${base}/fields`, { method: "PATCH", body: { version, values: { [spec.field]: typed } } })
      : await crmRequest<{ version: number }>(base, { method: "PATCH", body: { version, [spec.field]: draft } });
    committing.current = false; setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setVersions((list) => ({ ...list, [record.id]: result.data.version }));
    const position = { row: editing.row, col: editing.col };
    setEditing(null); setError(""); router.refresh();
    focusCell(position.row, position.col); then?.();
  }
  function onGridKeyDown(event: React.KeyboardEvent) {
    if (editing) return;
    const keys: Record<string, () => void> = {
      ArrowUp: () => move(-1, 0), ArrowDown: () => move(1, 0), ArrowLeft: () => move(0, -1), ArrowRight: () => move(0, 1),
      Home: () => focusCell(active.row, 0), End: () => { const shown = shownColumns(); focusCell(active.row, shown[shown.length - 1]); },
      Enter: () => { if (active.col === 0) router.push(rows[active.row].href); else startEdit(active.row, active.col); },
      F2: () => startEdit(active.row, active.col),
    };
    const action = keys[event.key];
    if (action && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) { event.preventDefault(); action(); }
  }
  function onEditorKeyDown(event: React.KeyboardEvent) {
    if (!editing) return;
    if (event.key === "Escape") { event.preventDefault(); const at = editing; setEditing(null); setError(""); focusCell(at.row, at.col); }
    if (event.key === "Enter") { event.preventDefault(); void commit(); }
    if (event.key === "Tab") { event.preventDefault(); void commit(() => move(0, event.shiftKey ? -1 : 1)); }
  }
  const rowHeight = density === "compact" ? "h-9" : "h-12";
  return <Card ref={cardRef} className="@container gap-0 overflow-hidden py-0">
    <style>{columnRules(gridId, columns)}</style>
    {hiddenCount > 0 && <p aria-live="polite" className="border-b px-4 py-1.5 text-xs text-muted-foreground">{t("columnsHiddenAtThisWidth", { count: hiddenCount })}</p>}
    {error && <p role="alert" className="border-b bg-destructive/5 px-4 py-1.5 text-xs text-destructive">{error}</p>}
    <Table ref={tableRef} role="grid" aria-label={label} aria-rowcount={rows.length + 1} data-grid={gridId} className="table-fixed" onKeyDown={onGridKeyDown}>
      <TableHeader><TableRow role="row">
        <TableHead role="columnheader" className="pl-4">{nameLabel}</TableHead>
        {columns.map((column, index) => <TableHead role="columnheader" key={column.key} data-col={index + 1} style={{ width: column.width }} className={cn("truncate", column.numeric && "text-right", index === columns.length - 1 && "pr-4")} title={column.label}>{column.label}</TableHead>)}
      </TableRow></TableHeader>
      <TableBody>{rows.map((row, rowIndex) => <TableRow role="row" key={row.id} className={rowHeight}>
        <TableCell role="gridcell" data-cell={`${rowIndex}:0`} tabIndex={active.row === rowIndex && active.col === 0 ? 0 : -1} onFocus={() => setActive({ row: rowIndex, col: 0 })}
          className={cn("overflow-hidden pl-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", density === "compact" ? "py-0.5" : "py-1.5")}>
          <Link href={row.href} tabIndex={-1} className="flex min-w-0 items-center gap-3 rounded-sm font-medium hover:underline">
            <Avatar className={cn(objectType === "company" && "rounded-md", density === "compact" ? "size-6" : "size-8")} aria-hidden="true"><AvatarFallback className={cn("text-xs text-muted-foreground", objectType === "company" && "rounded-md")}>{initials(row.name)}</AvatarFallback></Avatar>
            <span className="min-w-0"><span className="block truncate">{row.name}</span>{row.secondary && <span className="block truncate text-xs font-normal text-muted-foreground @xl:hidden">{row.secondary}</span>}</span>
          </Link>
        </TableCell>
        {columns.map((column, index) => {
          const cell = row.cells[column.key] ?? { text: "", muted: true }, col = index + 1;
          const isEditing = editing?.row === rowIndex && editing.col === col, spec = cell.edit;
          return <TableCell role="gridcell" key={column.key} data-col={col} data-cell={`${rowIndex}:${col}`} aria-readonly={!(writable && spec)} tabIndex={active.row === rowIndex && active.col === col ? 0 : -1}
            onFocus={() => setActive({ row: rowIndex, col })} onDoubleClick={() => startEdit(rowIndex, col)} title={isEditing ? undefined : cell.title ?? cell.text}
            className={cn("overflow-hidden text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", column.numeric && "text-right tabular-nums", index === columns.length - 1 && "pr-4", density === "compact" && "py-0.5")}>
            {isEditing && spec ? (spec.kind === "boolean" || spec.kind === "select"
              ? <NativeSelect autoFocus aria-label={t("editColumnForRecord", { column: column.label, name: row.name })} value={editing.draft} disabled={busy} onKeyDown={onEditorKeyDown} onChange={(event) => setEditing({ ...editing, draft: event.target.value })} onBlur={() => void commit()} className="h-7 w-full text-xs">
                <NativeSelectOption value="">{t("empty")}</NativeSelectOption>
                {(spec.kind === "boolean" ? [{ value: "true", label: t("yes") }, { value: "false", label: t("no") }] : spec.options ?? []).map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}
              </NativeSelect>
              : <Input autoFocus aria-label={t("editColumnForRecord", { column: column.label, name: row.name })} type={spec.kind} value={editing.draft} maxLength={spec.maxLength ?? 500} disabled={busy} onKeyDown={onEditorKeyDown} onChange={(event) => setEditing({ ...editing, draft: event.target.value })} onBlur={() => void commit()} className="h-7 text-xs" />)
              : cell.badge ? <Badge variant="secondary" className={cell.badge === "granted" ? "bg-success-tint text-success" : cell.badge === "withdrawn" ? "bg-warning-tint text-warning" : "text-muted-foreground"}>{cell.text}</Badge>
              : <span className="flex min-w-0 items-center gap-1.5">{cell.href
                ? <a href={cell.href} tabIndex={-1} aria-label={cell.label} target={cell.external ? "_blank" : undefined} rel={cell.external ? "noreferrer" : undefined} className={cn("block min-w-0 truncate hover:underline", cell.muted && "text-muted-foreground")}>{cell.text}</a>
                : <span className={cn("block min-w-0 truncate", cell.muted && "text-muted-foreground")}>{cell.text}</span>}
                {cell.more ? <Badge variant="outline" className="h-5 shrink-0 rounded-md px-1.5 text-[11px] font-normal">{t("moreCount", { count: cell.more })}</Badge> : null}</span>}
          </TableCell>;
        })}
      </TableRow>)}</TableBody>
    </Table>
  </Card>;
}
