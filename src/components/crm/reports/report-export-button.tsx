"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ReportPeriod } from "@/lib/crm-reports";
import type { ReportTable } from "@/lib/crm-reports-csv";

/** Downloads one report table as CSV (aggregates only, the period on screen). Shown to owners and admins; the route enforces it. */
export function ReportExportButton({ tenantId, table, period, label }: { tenantId: string; table: ReportTable; period: ReportPeriod; label: string }) {
  const t = useTranslations("CrmReports.export");
  return <Button asChild variant="outline" size="responsive" data-testid={`report-export-${table}`}>
    <a href={`/api/workspaces/${tenantId}/crm/reports/export?table=${table}&period=${period}`} download aria-label={t("label", { table: label })}><Download aria-hidden="true" />{t("button")}</a>
  </Button>;
}
