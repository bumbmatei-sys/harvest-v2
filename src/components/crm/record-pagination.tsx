import { useFormatter, useTranslations } from "next-intl";
import { CRM_PAGE_SIZE } from "@/lib/crm-input";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";

/** Page links keep every active search, filter and sort parameter. */
export function RecordPagination({ base, params, page, total, label }: { base: string; params: Record<string, string> | string; page: number; total: number; label: string }) {
  const t = useTranslations("Crm");
  const format = useFormatter();
  const pages = Math.max(1, Math.ceil(total / CRM_PAGE_SIZE));
  if (pages <= 1 && page <= 1) return null;
  const href = (next: number) => { const query = new URLSearchParams(params); if (next > 1) query.set("page", String(next)); else query.delete("page"); const value = query.toString(); return value ? `${base}?${value}` : base; };
  const numbers = [...new Set([1, page - 1, page, page + 1, pages])].filter((value) => value >= 1 && value <= pages).sort((a, b) => a - b);
  const first = (page - 1) * CRM_PAGE_SIZE + 1, last = Math.min(page * CRM_PAGE_SIZE, total);
  return <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
    <p className="text-xs text-muted-foreground tabular-nums">{total ? t("showingRange", { first: format.number(first, "integer"), last: format.number(last, "integer"), total: format.number(total, "integer") }) : t("noRecordsOnThisPage")}</p>
    <Pagination aria-label={label} className="mx-0 w-auto"><PaginationContent>
      <PaginationItem><PaginationPrevious href={page > 1 ? href(page - 1) : href(page)} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined} className={page <= 1 ? "pointer-events-none opacity-50" : ""} /></PaginationItem>
      {numbers.map((number, index) => <PaginationItem key={number} className="flex items-center">{index > 0 && number - numbers[index - 1] > 1 && <PaginationEllipsis />}<PaginationLink href={href(number)} isActive={page === number} aria-label={t("pageValue", { number: format.number(number, "integer") })}>{format.number(number, "integer")}</PaginationLink></PaginationItem>)}
      <PaginationItem><PaginationNext href={page < pages ? href(page + 1) : href(page)} aria-disabled={page >= pages} tabIndex={page >= pages ? -1 : undefined} className={page >= pages ? "pointer-events-none opacity-50" : ""} /></PaginationItem>
    </PaginationContent></Pagination>
  </div>;
}
