"use client";
import { useTranslations } from "next-intl";
import { ListFilter } from "lucide-react";
import { activeFilterCount, discoverLanguages, languageName, type DiscoverFilters } from "@/lib/discover-ui";
import { discoverCategories } from "@/lib/discover-taxonomy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Icon-only filter button with a popover (the same pattern as the CRM filters): category, language and free only. Changes apply at once through `onChange`, so the URL always
 * matches what the screen shows; `onReset` clears the three filters and keeps the search, type and sort.
 */
export function FilterPopover({ filters, onChange, onReset }: { filters: DiscoverFilters; onChange: (next: DiscoverFilters) => void; onReset: () => void }) {
  const t = useTranslations("DiscoverScreens"), count = activeFilterCount(filters);
  const label = count > 0 ? `${t("filters")}, ${t("filtersActive", { count })}` : t("filters");
  return <Popover>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" size="icon-responsive" aria-label={label} title={t("filters")} className="relative"><ListFilter aria-hidden="true" />
        {count > 0 && <Badge aria-hidden="true" className="absolute -end-1.5 -top-1.5 h-5 min-w-5 justify-center rounded-full px-1 text-[11px]">{count}</Badge>}</Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] space-y-4">
      <p className="text-sm font-semibold">{t("filtersTitle")}</p>
      <Field><FieldLabel htmlFor="discover-filter-category">{t("category")}</FieldLabel>
        <NativeSelect id="discover-filter-category" className="w-full" value={filters.category ?? ""} onChange={(e) => onChange({ ...filters, category: (e.target.value || undefined) as DiscoverFilters["category"] })}>
          <NativeSelectOption value="">{t("anyCategory")}</NativeSelectOption>
          {discoverCategories.map((key) => <NativeSelectOption key={key} value={key}>{t(`categories.${key}`)}</NativeSelectOption>)}
        </NativeSelect></Field>
      <Field><FieldLabel htmlFor="discover-filter-language">{t("language")}</FieldLabel>
        <NativeSelect id="discover-filter-language" className="w-full" value={filters.language ?? ""} onChange={(e) => onChange({ ...filters, language: e.target.value || undefined })}>
          <NativeSelectOption value="">{t("anyLanguage")}</NativeSelectOption>
          {discoverLanguages.map((code) => <NativeSelectOption key={code} value={code}>{languageName(code)}</NativeSelectOption>)}
        </NativeSelect></Field>
      <Label htmlFor="discover-filter-free" className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal">
        <Checkbox id="discover-filter-free" checked={filters.free === true} onCheckedChange={(checked) => onChange({ ...filters, free: checked === true ? true : undefined })} />{t("freeOnly")}</Label>
      <Button type="button" variant="ghost" size="responsive" disabled={count === 0} onClick={onReset}>{t("resetFilters")}</Button>
    </PopoverContent>
  </Popover>;
}
