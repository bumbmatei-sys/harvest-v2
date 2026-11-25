import type { Database } from "../db/client";
import { auditLogs } from "../db/schema";
import { message } from "../i18n/messages";
import { uuidInput } from "../lib/contact-input";
import { reportPeriods } from "../lib/crm-reports";
import { reportCsvFileName, reportTableCsv, reportTables, type ReportCsvLabels, type ReportTable } from "../lib/crm-reports-csv";
import { AccessError } from "./permissions";
import { getCrmReport } from "./crm-reports";
import { withTenant } from "./tenancy";

const labels = (): ReportCsvLabels => ({
  hidden: message("CrmReports.hidden"), periodStart: message("CrmReports.export.periodStart"), periodEnd: message("CrmReports.export.periodEnd"), timeZone: message("CrmReports.export.timeZone"),
  deals: { outcome: message("CrmReports.deals.outcome"), count: message("CrmReports.deals.count"), won: message("CrmReports.deals.won"), open: message("CrmReports.deals.open"), lost: message("CrmReports.deals.lost") },
  tasks: { status: message("CrmReports.tasks.status"), count: message("CrmReports.tasks.count"), overdue: message("CrmReports.tasks.overdue"), onTime: message("CrmReports.tasks.onTime") },
  sources: { source: message("CrmReports.sources.source"), added: message("CrmReports.sources.added"), withDeal: message("CrmReports.sources.withDeal"), manual: message("CrmReports.sources.manual"),
    csv_import: message("CrmReports.sources.csv_import"), connect: message("CrmReports.sources.connect"), form: message("CrmReports.sources.form"), ad_lead: message("CrmReports.sources.ad_lead"), unknown: message("CrmReports.sources.unknown") },
  stages: { pipeline: message("CrmReports.stages.pipeline"), from: message("CrmReports.stages.from"), to: message("CrmReports.stages.to"), moved: message("CrmReports.stages.moved"), medianDays: message("CrmReports.export.medianDays") },
});

/**
 * CSV of one report table for owners and admins. The same figures as the screen (small groups withheld, ministry time zone), aggregates only,
 * no personal data. The audit row (table and period, never content) is written before the data is built, so no download exists without one.
 */
export async function exportCrmReportTable(db: Database, userId: string, workspace: string, periodInput: string, tableInput: string, now = new Date()) {
  const tenant = uuidInput.parse(workspace), table = reportTables.find((candidate) => candidate === tableInput) as ReportTable | undefined;
  await withTenant(db, userId, tenant, "crm:reports_export", async (tx, tenantId) => {
    if (!table || !reportPeriods.some((period) => period === periodInput)) throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "crm.report.export", targetId: null, metadata: { table, period: periodInput } });
  });
  const report = await getCrmReport(db, userId, tenant, periodInput, now);
  return { fileName: reportCsvFileName(table!, report), body: reportTableCsv(table!, report, labels()) };
}
