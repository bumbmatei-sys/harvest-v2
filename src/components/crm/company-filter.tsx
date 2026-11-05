"use client";
import { useTranslations } from "next-intl";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecordPicker } from "./record-picker";
import { useRecordNavigation } from "./record-list";

/** Filter people by one linked company, searched on the server. */
export function CompanyFilter({ tenantId }: { tenantId: string }) {
  const t = useTranslations("Crm");
  const navigate = useRecordNavigation();
  return <RecordPicker endpoint={`/api/workspaces/${tenantId}/companies`} align="end"
    toItem={(row) => ({ id: String(row.id), label: String(row.name), hint: row.domain ? String(row.domain) : null })}
    trigger={<Button variant="outline" size="sm" className="h-9"><Building2 aria-hidden="true" /><span className="sr-only sm:not-sr-only">{t("company")}</span></Button>}
    title={t("filterByCompany")} placeholder={t("searchCompanies")} emptyLabel={t("noCompaniesFound")}
    onSelect={(item) => { navigate({ company: item.id }); }} />;
}
