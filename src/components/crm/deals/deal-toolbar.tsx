"use client";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Columns3, List, Search, X } from "lucide-react";
import { dealQueryParams, dealSorts, type DealQuery } from "@/lib/crm-deals";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** URL-backed board/list state: mode, search, stage, owner, stale, amount range and sort. */
export function DealToolbar({ query, stages, members }: { query: DealQuery; stages: { id: string; name: string }[]; members: { id: string; name: string }[] }) {
  const t = useTranslations("Deals");
  const router = useRouter(), pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(query.q), [seen, setSeen] = useState(query.q);
  if (query.q !== seen) { setSeen(query.q); setText(query.q); }
  const [min, setMin] = useState(query.min), [max, setMax] = useState(query.max);
  function navigate(next: Partial<DealQuery>) {
    const params = dealQueryParams({ ...query, page: 1, ...next });
    const value = params.toString();
    startTransition(() => router.push(value ? `${pathname}?${value}` : pathname));
  }
  const filtered = !!(query.q || query.stage || query.owner || query.stale || query.min || query.max);
  const [sortKey, descending] = [query.sort.replace(/^-/, ""), query.sort.startsWith("-")];
  return <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
    <ButtonGroup aria-label={t("viewMode")}>
      <Button size="sm" variant={query.mode === "board" ? "secondary" : "outline"} className="h-9" aria-pressed={query.mode === "board"} onClick={() => navigate({ mode: "board" })}><Columns3 aria-hidden="true" />{t("boardMode")}</Button>
      <Button size="sm" variant={query.mode === "list" ? "secondary" : "outline"} className="h-9" aria-pressed={query.mode === "list"} onClick={() => navigate({ mode: "list" })}><List aria-hidden="true" />{t("listMode")}</Button>
    </ButtonGroup>
    <form role="search" className="min-w-0 flex-1 basis-52" onSubmit={(event) => { event.preventDefault(); navigate({ q: text.trim() }); }}>
      <InputGroup className="h-9 border-transparent bg-muted">
        <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
        <InputGroupInput type="search" aria-label={t("searchDeals")} placeholder={t("searchDealsPlaceholder")} value={text} maxLength={100} onChange={(event) => setText(event.target.value)} />
        {text && <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label={t("clearSearch")} onClick={() => { setText(""); navigate({ q: "" }); }}><X aria-hidden="true" /></InputGroupButton></InputGroupAddon>}
      </InputGroup>
    </form>
    <NativeSelect aria-label={t("filterStage")} value={query.stage} onChange={(event) => navigate({ stage: event.target.value })} className="h-9 w-40">
      <NativeSelectOption value="">{t("allStages")}</NativeSelectOption>
      {stages.map((stage) => <NativeSelectOption key={stage.id} value={stage.id}>{stage.name}</NativeSelectOption>)}
    </NativeSelect>
    <NativeSelect aria-label={t("filterOwner")} value={query.owner} onChange={(event) => navigate({ owner: event.target.value })} className="h-9 w-40">
      <NativeSelectOption value="">{t("anyOwner")}</NativeSelectOption>
      <NativeSelectOption value="none">{t("noOwner")}</NativeSelectOption>
      {members.map((member) => <NativeSelectOption key={member.id} value={member.id}>{member.name}</NativeSelectOption>)}
    </NativeSelect>
    <Button size="sm" variant={query.stale ? "secondary" : "outline"} className="h-9" aria-pressed={!!query.stale} onClick={() => navigate({ stale: query.stale ? "" : "1" })}>{t("staleOnly")}</Button>
    <Popover>
      <PopoverTrigger asChild><Button size="sm" variant={query.min || query.max ? "secondary" : "outline"} className="h-9">{query.min || query.max ? t("amountRangeActive", { min: query.min || "0", max: query.max || "∞" }) : t("amountRange")}</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); navigate({ min: min.trim(), max: max.trim() }); }}>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label htmlFor="deal-min" className="text-xs">{t("minimum")}</Label><Input id="deal-min" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" value={min} onChange={(event) => setMin(event.target.value)} className="h-8" /></div>
            <div className="space-y-1.5"><Label htmlFor="deal-max" className="text-xs">{t("maximum")}</Label><Input id="deal-max" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" value={max} onChange={(event) => setMax(event.target.value)} className="h-8" /></div>
          </div>
          <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => { setMin(""); setMax(""); navigate({ min: "", max: "" }); }}>{t("clear")}</Button><Button size="sm">{t("apply")}</Button></div>
        </form>
      </PopoverContent>
    </Popover>
    {query.mode === "list" && <NativeSelect aria-label={t("sortBy")} value={`${sortKey}:${descending ? "desc" : "asc"}`} onChange={(event) => { const [key, direction] = event.target.value.split(":"); navigate({ sort: direction === "desc" ? `-${key}` : key }); }} className="h-9 w-48">
      {dealSorts.flatMap((key) => (["asc", "desc"] as const).map((direction) => <NativeSelectOption key={`${key}:${direction}`} value={`${key}:${direction}`}>{t(`sorts.${key}.${direction}`)}</NativeSelectOption>))}
    </NativeSelect>}
    {filtered && <Button size="sm" variant="ghost" className="h-9 text-muted-foreground" onClick={() => { setText(""); setMin(""); setMax(""); navigate({ q: "", stage: "", owner: "", stale: "", min: "", max: "" }); }}>{t("clearFilters")}</Button>}
  </div>;
}
