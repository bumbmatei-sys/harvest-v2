"use client";
import { useTranslations } from "next-intl";
import { createContext, useContext, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDownUp, Check, ListFilter, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

type Params = Record<string, string>;
const ListContext = createContext<{ navigate: (changes: Record<string, string | null>) => void; pending: boolean; params: Params } | null>(null);
function useList() { const value = useContext(ListContext); if (!value) throw new Error("RECORD_LIST_REQUIRED"); return value; }

/** The URL is the view state: shareable, reload-safe and server-filtered. */
export function RecordList({ params, children }: { params: Params; children: React.ReactNode }) {
  const router = useRouter(), pathname = usePathname();
  const [pending, startTransition] = useTransition();
  // While a navigation is in flight, build on the view it is heading to, not the
  // one still rendered; otherwise a quick second change would resurrect old filters.
  const inFlight = useRef<string | null>(null);
  function navigate(changes: Record<string, string | null>) {
    const next = new URLSearchParams(pending && inFlight.current !== null ? inFlight.current : new URLSearchParams(params).toString());
    for (const [key, value] of Object.entries(changes)) { if (value === null || value === "") next.delete(key); else next.set(key, value); }
    if (!("page" in changes)) next.delete("page");
    const query = next.toString();
    inFlight.current = query;
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }
  return <ListContext.Provider value={{ navigate, pending, params }}>{children}</ListContext.Provider>;
}
export function RecordResults({ children }: { children: React.ReactNode }) {
  const { pending } = useList();
  return <div aria-busy={pending} className={cn("transition-opacity duration-200", pending && "opacity-60")}>{children}</div>;
}

export type FilterOption = { value: string; label: string };
export type FilterDefinition = { key: string; label: string; options: FilterOption[] };

export function RecordToolbar({ searchLabel, searchPlaceholder, filters, sorts, defaultSort, chips = [], extraFilter }: {
  searchLabel: string; searchPlaceholder: string; filters: FilterDefinition[]; sorts: FilterOption[]; defaultSort: string;
  /** Active filters whose labels need server data (for example a company name). */
  chips?: { key: string; label: string }[]; extraFilter?: React.ReactNode;
}) {
  const t = useTranslations("Crm");
  const { navigate, params } = useList();
  const [query, setQuery] = useState(params.q ?? ""), [seen, setSeen] = useState(params.q ?? "");
  if ((params.q ?? "") !== seen) { setSeen(params.q ?? ""); setQuery(params.q ?? ""); }
  const active = [...filters.flatMap((filter) => {
    const option = filter.options.find((item) => item.value === params[filter.key]);
    return option ? [{ key: filter.key, label: t("filterChip", { filter: filter.label, value: option.label }) }] : [];
  }), ...chips];
  const sort = params.sort ?? defaultSort;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <form role="search" className="min-w-0 flex-1 basis-60" onSubmit={(event) => { event.preventDefault(); navigate({ q: query.trim() }); }}>
        <InputGroup className="h-9 border-transparent bg-muted">
          <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput type="search" name="q" aria-label={searchLabel} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} maxLength={100} />
          {query && <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label={t("clearSearch")} onClick={() => { setQuery(""); navigate({ q: null }); }}><X aria-hidden="true" /></InputGroupButton></InputGroupAddon>}
        </InputGroup>
      </form>
      <div className="flex items-center gap-2">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-9"><ListFilter aria-hidden="true" />{t("filter")}{active.length > 0 && <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 rounded-full px-1.5 tabular-nums">{active.length}</Badge>}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("filterBy")}</DropdownMenuLabel>
            {filters.map((filter) => <DropdownMenuSub key={filter.key}>
              <DropdownMenuSubTrigger>{filter.label}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={params[filter.key] ?? ""} onValueChange={(value) => navigate({ [filter.key]: value || null })}>
                  <DropdownMenuRadioItem value="">{t("anyValue")}</DropdownMenuRadioItem>
                  {filter.options.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>)}
          </DropdownMenuContent>
        </DropdownMenu>
        {extraFilter}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-9"><ArrowDownUp aria-hidden="true" /><span className="sr-only sm:not-sr-only">{t("sortLabel", { sort: sorts.find((item) => item.value === sort)?.label ?? "" })}</span></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("sortBy")}</DropdownMenuLabel><DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={sort} onValueChange={(value) => navigate({ sort: value === defaultSort ? null : value })}>
              {sorts.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    {active.length > 0 && <ul aria-label={t("activeFilters")} className="flex flex-wrap items-center gap-1.5">
      {active.map((chip) => <li key={chip.key}><Badge variant="secondary" className="h-7 gap-1 rounded-md pr-1 pl-2.5 text-xs font-normal">
        <Check aria-hidden="true" className="size-3" />{chip.label}
        <Button variant="ghost" size="icon-xs" className="size-5 rounded-sm" aria-label={t("removeFilter", { filter: chip.label })} onClick={() => navigate({ [chip.key]: null })}><X aria-hidden="true" /></Button>
      </Badge></li>)}
      <li><Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => navigate({ ...Object.fromEntries(active.map((chip) => [chip.key, null])), q: null })}>{t("resetView")}</Button></li>
    </ul>}
  </div>;
}
export function useRecordNavigation() { return useList().navigate; }
