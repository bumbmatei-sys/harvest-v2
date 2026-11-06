import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IMPORT_PREVIEW_PAGE, type ImportEntity } from "@/lib/crm-import";
import { cn } from "@/lib/utils";
import { RecordPagination } from "../record-pagination";

type Row = { rowNumber: number; raw: string[]; status: string; action: string | null; error: string | null; warning: string | null; created: boolean; recordId: string | null; recordName: string | null; companyName: string | null };
const outcomes = ["all", "create", "update", "skip", "problem"] as const;
const tone = (row: Row) => (row.status === "error" ? "bg-warning-tint text-warning" : row.status === "done" ? "bg-success-tint text-success" : "text-muted-foreground");

/** Rows of an import by outcome: the dry-run result before importing, the real outcome after. */
export async function ImportRows({ tenantId, importId, entity, fileName, mapping, rows, outcome, page, total, counts, done }: {
  tenantId: string; importId: string; entity: ImportEntity; fileName: string; mapping: (string | null)[];
  rows: Row[]; outcome: typeof outcomes[number]; page: number; total: number; counts: Record<string, number>; done: boolean;
}) {
  const t = await getTranslations("Imports");
  const format = await getFormatter();
  const base = `/workspaces/${tenantId}/crm/imports/${importId}`;
  const records = `/workspaces/${tenantId}/crm/${entity === "person" ? "people" : "companies"}`;
  const cell = (row: Row, target: string) => { const index = mapping.indexOf(target); return index < 0 ? "" : row.raw[index] ?? ""; };
  const keys = entity === "person" ? ["email", "phone", "social"] : ["domain"];
  return <div className="space-y-3">
    <nav aria-label={t("rowsLabel", { file: fileName })} className="flex flex-wrap gap-1.5">
      {outcomes.map((value) => {
        const count = value === "all" ? counts.all : counts[value] ?? 0;
        return <Link key={value} href={value === "all" ? base : `${base}?outcome=${value}`} aria-current={value === outcome ? "page" : undefined}
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors hover:bg-accent", value === outcome && "border-foreground/30 bg-selected font-medium")}>
          {t(`outcomes.${value}`)}<span className="tabular-nums text-muted-foreground">{format.number(count)}</span></Link>;
      })}
    </nav>
    {rows.length === 0 ? <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">{t("noRowsHere")}</p> :
      <div className="overflow-x-auto rounded-lg border"><Table aria-label={t("rowsLabel", { file: fileName })}>
        <TableHeader><TableRow><TableHead className="w-14">{t("rowNumber")}</TableHead><TableHead>{t("record")}</TableHead><TableHead className="w-28">{t("outcome")}</TableHead><TableHead className="hidden md:table-cell">{t("details")}</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map((row) => {
          const label = done ? t(`rowStatus.${row.status as "done"}`) : t(`actions.${(row.action ?? "skip") as "skip"}`);
          const detail = row.raw.length === 0 ? t("erasedRow")
            : row.error ? t(`rowErrors.${row.error as "missing_name"}`)
              : row.recordId && row.action !== "create" ? null
                : row.warning ? t(`rowWarnings.${row.warning as "company_not_found"}`) : null;
          const ids = keys.map((key) => cell(row, key)).filter(Boolean).join(" · ");
          return <TableRow key={row.rowNumber}>
            <TableCell className="align-top tabular-nums text-muted-foreground">{row.rowNumber}</TableCell>
            <TableCell className="w-full max-w-0 whitespace-normal align-top md:max-w-[18rem] md:w-auto">
              <span className="block truncate font-medium">{cell(row, "name") || t("noName")}</span>
              {ids && <span className="block truncate text-xs text-muted-foreground">{ids}</span>}
              <span className="block text-xs break-words text-muted-foreground md:hidden">{detail}</span>
            </TableCell>
            <TableCell className="align-top"><Badge variant="secondary" className={cn("h-5 rounded-md px-1.5 text-[11px] font-normal", tone(row))}>{label}</Badge></TableCell>
            <TableCell className="hidden max-w-[28rem] whitespace-normal align-top text-xs text-muted-foreground md:table-cell">
              {row.recordId && row.recordName && row.action !== "create" && !row.created
                ? <Link href={`${records}/${row.recordId}`} className="text-foreground underline-offset-4 hover:underline">{t("matchedWith", { name: row.recordName })}</Link>
                : row.recordId && row.recordName && row.created ? <Link href={`${records}/${row.recordId}`} className="text-foreground underline-offset-4 hover:underline">{row.recordName}</Link> : null}
              {detail && <span className="block">{detail}</span>}
              {entity === "person" && row.companyName && !row.error && <span className="block">{t("linksTo", { company: row.companyName })}</span>}
            </TableCell>
          </TableRow>;
        })}</TableBody>
      </Table></div>}
    <RecordPagination base={base} params={outcome === "all" ? {} : { outcome }} page={page} total={total} pageSize={IMPORT_PREVIEW_PAGE} label={t("rowsLabel", { file: fileName })} />
  </div>;
}
