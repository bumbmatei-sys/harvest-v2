"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ArrowDownUp, Search, X } from "lucide-react";
import { valuelessOperands, type Filter, type ObjectType } from "@/lib/crm-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { ColumnsMenu } from "./columns-menu";
import { FilterBuilder, type FieldMeta } from "./filter-builder";
import { useListState } from "./list-state";
import { ViewMenu, type ViewSummary } from "./view-menu";

export function ListToolbar({ tenantId, objectType, fields, sorts, columns, visibleColumns, related, views, currentView, modified, writable, searchLabel, searchPlaceholder }: {
  tenantId: string; objectType: ObjectType; fields: FieldMeta[]; sorts: { value: string; label: string }[];
  columns: { key: string; label: string }[]; visibleColumns: string[]; related: Record<string, string>;
  views: ViewSummary[]; currentView: ViewSummary; modified: boolean; writable: boolean; searchLabel: string; searchPlaceholder: string;
}) {
  const t = useTranslations("Crm");
  const { state, navigate } = useListState();
  const [query, setQuery] = useState(state.q), [seen, setSeen] = useState(state.q);
  if (state.q !== seen) { setSeen(state.q); setQuery(state.q); }
  const [filterOpen, setFilterOpen] = useState(false), [editing, setEditing] = useState<number | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  function chipText(filter: Filter, draftNames: Record<string, string> = {}) {
    const field = fields.find((item) => item.key === filter.field);
    const values = Array.isArray(filter.value) ? filter.value : filter.value === null ? [] : [filter.value];
    const shown = values.map((value) => field?.options?.find((option) => option.value === value)?.label
      ?? (field?.type === "relation" ? related[value] ?? draftNames[value] ?? names[value] ?? t("unavailableRecord") : field?.type === "boolean" ? t(value === "true" ? "yes" : "no") : value)).join(", ");
    const op = t(`operands.${filter.op}`);
    return valuelessOperands.includes(filter.op) ? t("filterChipNoValue", { field: field?.label ?? filter.field, op }) : t("filterChipText", { field: field?.label ?? filter.field, op, value: shown });
  }
  const sortKey = state.sort.replace(/^-/, ""), descending = state.sort.startsWith("-");
  return <div className="space-y-3">
    <ViewMenu tenantId={tenantId} objectType={objectType} views={views} current={currentView} modified={modified} writable={writable} />
    <div className="flex flex-wrap items-center gap-2">
      <form role="search" className="min-w-0 flex-1 basis-60" onSubmit={(event) => { event.preventDefault(); navigate({ q: query.trim() }); }}>
        <InputGroup className="h-11 border-transparent bg-muted lg:h-9">
          <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput type="search" name="q" aria-label={searchLabel} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} maxLength={100} />
          {query && <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label={t("clearSearch")} onClick={() => { setQuery(""); navigate({ q: "" }); }}><X aria-hidden="true" /></InputGroupButton></InputGroupAddon>}
        </InputGroup>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <FilterBuilder fields={fields} tenantId={tenantId} filters={state.filters} open={filterOpen} editing={editing} relatedNames={{ ...names, ...related }} chipText={chipText}
          onOpenChange={(open) => { setFilterOpen(open); if (!open) setEditing(null); }}
          onApply={(filters, addedNames) => { setNames((current) => ({ ...current, ...addedNames })); navigate({ filters }); }} />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild><Button variant="outline" size="responsive"><ArrowDownUp aria-hidden="true" /><span className="sr-only sm:not-sr-only">{t("sortLabel", { sort: `${sorts.find((item) => item.value === sortKey)?.label ?? sortKey} ${descending ? "↓" : "↑"}` })}</span></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("sortBy")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sortKey} onValueChange={(value) => navigate({ sort: descending ? `-${value}` : value })}>
              {sorts.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={descending ? "desc" : "asc"} onValueChange={(value) => navigate({ sort: value === "desc" ? `-${sortKey}` : sortKey })}>
              <DropdownMenuRadioItem value="asc">{t("ascending")}</DropdownMenuRadioItem><DropdownMenuRadioItem value="desc">{t("descending")}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <ColumnsMenu available={columns} visible={visibleColumns} density={state.density} onChange={(next) => navigate(next)} />
      </div>
    </div>
    {(state.filters.length > 0 || state.q) && <ul aria-label={t("activeFilters")} className="flex flex-wrap items-center gap-1.5">
      {state.filters.slice(0, 3).map((filter, index) => { const text = chipText(filter); return <li key={`${filter.field}-${index}`}><Badge variant="secondary" className="max-w-full gap-0 rounded-md p-0 text-xs font-normal">
        <Button variant="ghost" className="h-11 min-w-0 max-w-64 justify-start px-2 text-xs font-normal lg:h-8" aria-label={t("editFilter", { filter: text })} onClick={() => { setEditing(index); setFilterOpen(true); }}><span className="truncate">{text}</span></Button>
        <Button variant="ghost" size="icon-responsive" className="rounded-l-none lg:size-8" aria-label={t("removeFilter", { filter: text })} onClick={() => navigate({ filters: state.filters.filter((_, item) => item !== index) })}><X aria-hidden="true" /></Button>
      </Badge></li>; })}
      {state.filters.length > 3 && <li><Button variant="ghost" size="responsive" onClick={() => { setEditing(null); setFilterOpen(true); }}>{t("moreFilters", { count: state.filters.length - 3 })}</Button></li>}
      <li><Button variant="ghost" size="responsive" className="text-xs text-muted-foreground" onClick={() => navigate({ filters: [], q: "" })}>{t("clearFilters")}</Button></li>
    </ul>}
  </div>;
}
