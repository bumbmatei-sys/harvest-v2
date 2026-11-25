/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/ai-analytics/components/time-range-tabs.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { reportPeriods, type ReportPeriod } from "@/lib/crm-reports";

/**
 * A row of fixed reporting periods; arrow keys move between them. Without props it is the CRM reports control (five periods); other
 * reports pass their own `periods`, `labelOf` and `ariaLabel` (the newsletter analytics screen uses 7, 30 and 90 days).
 */
export function ReportPeriodTabs<Period extends string = ReportPeriod>({ value, onValueChange, periods = reportPeriods as unknown as readonly Period[], labelOf, ariaLabel }: {
  value: Period; onValueChange: (value: Period) => void; periods?: readonly Period[]; labelOf?: (period: Period) => string; ariaLabel?: string;
}) {
  const t = useTranslations("CrmReports");
  const label = labelOf ?? ((period: Period) => t(`periods.${period as ReportPeriod}`));
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as Period)} className="max-w-full">
      <TabsList aria-label={ariaLabel ?? t("period")} className="max-w-full justify-start max-sm:my-0! max-sm:h-auto! max-sm:w-full max-sm:flex-wrap!">
        {periods.map((period) => (
          <TabsTrigger key={period} value={period} className="px-3 max-sm:my-0! max-sm:flex-1" data-testid={`period-${period}`}>
            {label(period)}
          </TabsTrigger>
        ))}
      </TabsList>
      {/* The tab's panel is the report below; this hidden stand-in gives aria-controls a target and names the period for screen readers. */}
      <TabsContent value={value} className="sr-only">{label(value)}</TabsContent>
    </Tabs>
  );
}
