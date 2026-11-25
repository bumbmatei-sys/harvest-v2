import { CSV_BOM, csvLine } from "./csv";
import { reportSources } from "./crm-reports";
import { zonedIsoDate } from "./time-zone";
import type { CrmReport } from "../server/crm-reports";

export const reportTables = ["deals", "tasks", "sources", "stages"] as const;
export type ReportTable = typeof reportTables[number];
/** Words the builder needs; the server fills them from the message catalogue so the file reads like the screen. */
export type ReportCsvLabels = {
  hidden: string; periodStart: string; periodEnd: string; timeZone: string;
  deals: { outcome: string; count: string; won: string; open: string; lost: string };
  tasks: { status: string; count: string; overdue: string; onTime: string };
  sources: { source: string; added: string; withDeal: string } & Record<typeof reportSources[number], string>;
  stages: { pipeline: string; from: string; to: string; moved: string; medianDays: string };
};
/**
 * One report table as CSV. Aggregates only: every figure is the one the screen shows, so a figure the server withheld (fewer than 5) is the
 * same words here, never a number, and zero stays zero. Every row carries the period (ministry-local dates) and the time zone. Cells are
 * formula-safe (see csvLine), so a pipeline or stage name starting with "=" is not evaluated by a spreadsheet.
 */
export function reportTableCsv(table: ReportTable, report: CrmReport, labels: ReportCsvLabels): string {
  const zone = report.timeZone, start = zonedIsoDate(new Date(report.window.start), zone), end = zonedIsoDate(new Date(new Date(report.window.end).getTime() - 1), zone);
  const figure = (value: number | null) => value === null ? labels.hidden : value;
  const head = [labels.periodStart, labels.periodEnd, labels.timeZone], lead = [start, end, zone];
  const lines: string[] = [];
  if (table === "deals") {
    lines.push(csvLine([...head, labels.deals.outcome, labels.deals.count]));
    for (const key of ["won", "open", "lost"] as const) lines.push(csvLine([...lead, labels.deals[key], figure(report.deals[key])]));
  } else if (table === "tasks") {
    lines.push(csvLine([...head, labels.tasks.status, labels.tasks.count]));
    lines.push(csvLine([...lead, labels.tasks.overdue, figure(report.tasks.overdue)]), csvLine([...lead, labels.tasks.onTime, figure(report.tasks.onTime)]));
  } else if (table === "sources") {
    lines.push(csvLine([...head, labels.sources.source, labels.sources.added, labels.sources.withDeal]));
    for (const row of report.contacts?.sources ?? []) lines.push(csvLine([...lead, labels.sources[row.source], figure(row.added), figure(row.withDeal)]));
  } else {
    lines.push(csvLine([...head, labels.stages.pipeline, labels.stages.from, labels.stages.to, labels.stages.moved, labels.stages.medianDays]));
    for (const pair of report.stages?.pairs ?? []) lines.push(csvLine([...lead, pair.pipeline, pair.from, pair.to, figure(pair.moved), pair.moved === null ? labels.hidden : pair.medianDays ?? ""]));
  }
  return CSV_BOM + lines.join("");
}
/** crm-report-<table>-<period>-<ministry-local date>.csv */
export const reportCsvFileName = (table: ReportTable, report: CrmReport) => `crm-report-${table}-${report.period}-${zonedIsoDate(new Date(report.generatedAt), report.timeZone)}.csv`;
