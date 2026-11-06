import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { ShieldCheck, type LucideIcon } from "lucide-react";
import type { ObjectType, ViewState } from "@/lib/crm-fields";
import type { ViewNotice } from "@/server/crm-list-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { FieldMeta } from "./filter-builder";
import { ListResults, ListState } from "./list-state";
import { ListToolbar } from "./list-toolbar";
import { RecordGrid, type GridColumn, type GridRow } from "./record-grid";
import { RecordPagination } from "./record-pagination";
import type { ViewSummary } from "./view-menu";

/** The shared People / Companies list: header, view bar, configurable grid, empty states, pages. */
export async function ListPage({ tenantId, objectType, icon: Icon, title, description, total, page, create, actions, viewOnly, notice, state, viewId, query, parts, related, views, current, modified, writable, rows, copy }: {
  tenantId: string; objectType: ObjectType; icon: LucideIcon; title: string; description: string; total: number; page: number; create: React.ReactNode;
  /** Extra header actions (CRM-06 import and export), already permission-filtered by the page. */
  actions?: React.ReactNode;
  viewOnly: string | null; notice: ViewNotice; state: ViewState; viewId: string | null; query: string;
  parts: { fields: FieldMeta[]; sorts: { value: string; label: string }[]; available: { key: string; label: string }[]; visible: string[]; gridColumns: GridColumn[] };
  related: Record<string, string>; views: ViewSummary[]; current: ViewSummary; modified: boolean; writable: boolean; rows: GridRow[];
  copy: { searchLabel: string; searchPlaceholder: string; noMatch: string; pageEmpty: string; emptyTitle: string; emptyDescription: string; pages: string; privacy: string };
}) {
  const t = await getTranslations("Crm");
  const format = await getFormatter();
  const base = `/workspaces/${tenantId}/crm/${objectType === "person" ? "people" : "companies"}`;
  const filtered = state.q !== "" || state.filters.length > 0;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-3.5" aria-hidden="true" />{t("crm")}</div>
        <h1 className="flex items-center gap-2.5 text-[28px] font-semibold tracking-tight">{title}<Badge variant="secondary" className="rounded-md tabular-nums">{format.number(total, "integer")}</Badge></h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p></div>
      <div className="flex flex-wrap items-center gap-2">{actions}{writable && create}</div>
    </div>
    {notice && <Alert variant="destructive"><AlertDescription>{t(notice === "viewUnavailable" ? "viewUnavailableNotice" : "invalidViewNotice")}</AlertDescription></Alert>}
    {viewOnly && <Alert><AlertDescription>{viewOnly}</AlertDescription></Alert>}
    <ListState state={state} viewId={viewId}>
      <ListToolbar tenantId={tenantId} objectType={objectType} fields={parts.fields} sorts={parts.sorts} columns={parts.available} visibleColumns={parts.visible} related={related}
        views={views} currentView={current} modified={modified} writable={writable} searchLabel={copy.searchLabel} searchPlaceholder={copy.searchPlaceholder} />
      <div className="mt-3 space-y-3"><ListResults>
        {rows.length ? <RecordGrid tenantId={tenantId} objectType={objectType} columns={parts.gridColumns} rows={rows} density={state.density} label={title} nameLabel={t("name")} writable={writable} />
          : <Empty className="min-h-[280px] border border-solid bg-card p-7 sm:p-10">
            <EmptyHeader><EmptyMedia variant="icon"><Icon aria-hidden="true" /></EmptyMedia>
              <EmptyTitle><h2>{filtered ? copy.noMatch : page > 1 ? copy.pageEmpty : copy.emptyTitle}</h2></EmptyTitle>
              <EmptyDescription>{filtered ? t("tryAnotherSearchOrRemoveFilters") : page > 1 ? t("returnToTheFirstPage") : copy.emptyDescription}</EmptyDescription></EmptyHeader>
            <EmptyContent>{filtered || page > 1 ? <Button variant="outline" asChild><Link href={base}>{t("resetView")}</Link></Button> : writable && create}</EmptyContent>
          </Empty>}
      </ListResults>
      <RecordPagination base={base} params={query} page={page} total={total} label={copy.pages} /></div>
    </ListState>
    <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{copy.privacy}</p>
  </div>;
}
