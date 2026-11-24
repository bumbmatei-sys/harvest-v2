"use client";

import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { StagePair } from "@/server/crm-reports";

/** Deals moving between neighbouring stages in the period. A table only: every figure is in it. A withheld count (fewer than 5) hides its median too. */
export function ReportStagesCard({ pairs, trackedFrom, timeZone, action }: { pairs: readonly StagePair[]; trackedFrom: string | null; timeZone: string; action?: ReactNode }) {
  const t = useTranslations("CrmReports"), format = useFormatter();
  const pipelines = [...new Set(pairs.map((pair) => pair.pipelineId))];
  return <Card data-testid="report-card-stages">
    <CardHeader>
      <CardTitle>{t("stages.title")}</CardTitle>
      <CardDescription data-testid="report-stages-tracked">{trackedFrom ? t("stages.trackedFrom", { date: format.dateTime(new Date(trackedFrom), { dateStyle: "medium", timeZone }) }) : t("stages.noneYet")}</CardDescription>
      {action && <CardAction>{action}</CardAction>}
    </CardHeader>
    <CardContent>
      {pairs.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="report-stages-empty">{t("stages.noPipelines")}</p> : <Table data-testid="report-table-stages">
        <caption className="sr-only">{t("chart.stages")}</caption>
        <TableHeader><TableRow>
          <TableHead scope="col">{t("stages.step")}</TableHead>
          <TableHead scope="col" className="text-right">{t("stages.moved")}</TableHead>
          <TableHead scope="col" className="text-right">{t("stages.medianDays")}</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {pipelines.map((pipelineId) => {
            const rows = pairs.filter((pair) => pair.pipelineId === pipelineId);
            return [
              pipelines.length > 1 && <TableRow key={`${pipelineId}-head`}><TableHead scope="colgroup" colSpan={3} className="bg-muted/40 text-xs font-medium text-muted-foreground">{rows[0]!.pipeline}</TableHead></TableRow>,
              ...rows.map((pair) => <TableRow key={`${pair.pipelineId}-${pair.from}-${pair.to}`}>
                <TableHead scope="row" className="font-medium whitespace-normal">{t("stages.pair", { from: pair.from, to: pair.to })}</TableHead>
                <TableCell className={pair.moved === null ? "text-right text-muted-foreground" : "text-right tabular-nums"} data-testid={pair.moved === null ? "report-hidden" : "report-value"}>{pair.moved === null ? t("hidden") : format.number(pair.moved)}</TableCell>
                <TableCell className={pair.moved === null || pair.medianDays === null ? "text-right text-muted-foreground" : "text-right tabular-nums"}>
                  {pair.moved === null ? t("hidden") : pair.medianDays === null ? t("stages.none") : format.number(pair.medianDays, { maximumFractionDigits: 1 })}</TableCell>
              </TableRow>),
            ];
          })}
        </TableBody>
      </Table>}
    </CardContent>
  </Card>;
}
