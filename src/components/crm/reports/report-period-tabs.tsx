/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/ai-analytics/components/time-range-tabs.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { reportPeriods, type ReportPeriod } from "@/lib/crm-reports";

/** The five fixed reporting periods; arrow keys move between them. */
export function ReportPeriodTabs({ value, onValueChange }: { value: ReportPeriod; onValueChange: (value: ReportPeriod) => void }) {
  const t = useTranslations("CrmReports");
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as ReportPeriod)} className="max-w-full">
      <TabsList aria-label={t("period")} className="max-w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto max-sm:w-full">
        {reportPeriods.map((period) => (
          <TabsTrigger key={period} value={period} className="min-h-11 px-3 max-sm:flex-1 lg:min-h-8" data-testid={`period-${period}`}>
            {t(`periods.${period}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      {/* The tab's panel is the report below; this hidden stand-in gives aria-controls a target and names the period for screen readers. */}
      <TabsContent value={value} className="sr-only">{t(`periods.${value}`)}</TabsContent>
    </Tabs>
  );
}
