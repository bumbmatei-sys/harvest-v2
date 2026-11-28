"use client";
import { useTranslations } from "next-intl";
import { ListFilter } from "lucide-react";
import { discoverLanguages, languageName, type DiscoverFilters } from "@/lib/discover-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Icon-only filter button with a popover (the same pattern as the CRM filters) for the filter that has no chip row: the language. Type, category and price are chip rows on the
 * page. Changes apply at once through `onChange`, so the URL always matches what the screen shows.
 */
export function FilterPopover({ filters, onChange }: { filters: DiscoverFilters; onChange: (next: DiscoverFilters) => void }) {
  const t = useTranslations("DiscoverScreens"), count = filters.language ? 1 : 0;
  const label = count > 0 ? `${t("filters")}, ${t("filtersActive", { count })}` : t("filters");
  return <Popover>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" size="icon-responsive" aria-label={label} title={t("filters")} className="relative"><ListFilter aria-hidden="true" />
        {count > 0 && <Badge aria-hidden="true" className="absolute -end-1.5 -top-1.5 h-5 min-w-5 justify-center rounded-full px-1 text-[11px]">{count}</Badge>}</Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] space-y-4">
      <p className="text-sm font-semibold">{t("filtersTitle")}</p>
      <Field><FieldLabel htmlFor="discover-filter-language">{t("language")}</FieldLabel>
        <NativeSelect id="discover-filter-language" className="w-full" value={filters.language ?? ""} onChange={(e) => onChange({ ...filters, language: e.target.value || undefined })}>
          <NativeSelectOption value="">{t("anyLanguage")}</NativeSelectOption>
          {discoverLanguages.map((code) => <NativeSelectOption key={code} value={code}>{languageName(code)}</NativeSelectOption>)}
        </NativeSelect></Field>
      <Button type="button" variant="ghost" size="responsive" disabled={count === 0} onClick={() => onChange({ ...filters, language: undefined })}>{t("resetFilters")}</Button>
    </PopoverContent>
  </Popover>;
}
