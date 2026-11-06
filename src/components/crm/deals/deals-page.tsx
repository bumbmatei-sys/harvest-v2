import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { ChevronDown, Kanban } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listDeals } from "@/server/crm-deals";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { dealQuery, dealQueryParams, isStale, parseDealQuery } from "@/lib/crm-deals";
import { AccessState } from "@/components/access-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordPagination } from "../record-pagination";
import { DealBoard } from "./deal-board";
import { DealForm } from "./deal-form";
import { DealToolbar } from "./deal-toolbar";
import { StaleBadge, StageBadge } from "./stage-badge";

/** Pipelines: one pipeline's deals as a Kanban board or a list, from the same server query. */
export async function DealsPage({ tenantId, pipelineId, searchParams }: { tenantId: string; pipelineId: string | null; searchParams: Record<string, string | string[] | undefined> }) {
  const t = await getTranslations("Deals");
  const format = await getFormatter();
  const session = await pageSession();
  if (!uuidInput.safeParse(tenantId).success || (pipelineId && !uuidInput.safeParse(pipelineId).success)) return <AccessState />;
  const parsed = parseDealQuery(searchParams);
  const query = parsed.success ? parsed.data : dealQuery.parse({});
  const db = getDb();
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  const result = await listDeals(db, session.user.id, tenantId, pipelineId, query).catch((error: unknown) => {
    if (error instanceof AccessError && error.status === 404) return listDeals(db, session.user.id, tenantId, pipelineId, dealQuery.parse({ mode: query.mode })).then((data) => ({ ...data, notice: true }));
    if (error instanceof AccessError) return null;
    throw error;
  });
  if (!result) return <AccessState missing href={`/workspaces/${tenantId}/crm/pipelines`} />;
  const writable = can(workspace.role, "opportunities:write"), base = pipelineId ? `/workspaces/${tenantId}/crm/pipelines/${pipelineId}` : `/workspaces/${tenantId}/crm/pipelines`;
  const money = (value: number | string) => format.number(Number(value), { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const date = (value: string) => format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const { pipeline } = result;
  const filtered = !!(query.q || query.stage || query.owner || query.stale || query.min || query.max);
  const stageOf = (id: string) => pipeline?.stages.find((stage) => stage.id === id);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0"><div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground"><Kanban className="size-3.5" aria-hidden="true" />{t("crm")}</div>
        <h1 className="flex flex-wrap items-center gap-2.5 text-[28px] font-semibold tracking-tight">{t("pipelines")}
          {pipeline && <Badge variant="secondary" className="rounded-md tabular-nums">{format.number(result.total, "integer")}</Badge>}</h1>
        {pipeline ? <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {result.pipelines.length > 1 ? <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="-ml-2 h-7 gap-1 px-2 text-sm font-medium text-foreground">{pipeline.name}<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start"><DropdownMenuLabel className="text-xs text-muted-foreground">{t("switchPipeline")}</DropdownMenuLabel>
              {result.pipelines.map((item) => <DropdownMenuItem key={item.id} asChild><Link href={`/workspaces/${tenantId}/crm/pipelines/${item.id}`}>{item.name}{item.isDefault && <Badge variant="secondary" className="ml-auto h-5 text-[11px] font-normal">{t("default")}</Badge>}</Link></DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu> : <span className="font-medium text-foreground">{pipeline.name}</span>}
          <span>{t("openValue", { value: money(result.openTotal) })}</span>
          <span>{t("weightedValue", { value: money(result.weightedTotal) })}</span>
          {result.staleCount > 0 && <span className="text-warning">{t("staleCount", { count: result.staleCount })}</span>}
        </div> : <p className="mt-1 text-sm text-muted-foreground">{t("pipelinesDescription")}</p>}
      </div>
      {writable && pipeline && <DealForm tenantId={tenantId} pipelineId={pipeline.id} stages={pipeline.stages.map((stage) => ({ id: stage.id, name: stage.name }))} members={result.members} />}
    </div>
    {(!parsed.success || "notice" in result) && <Alert variant="destructive"><AlertDescription>{t("invalidViewNotice")}</AlertDescription></Alert>}
    {!writable && <Alert><AlertDescription>{t("viewOnlyDeals")}</AlertDescription></Alert>}
    {!pipeline ? <Empty className="min-h-[280px] border border-solid bg-card p-7 sm:p-10">
      <EmptyHeader><EmptyMedia variant="icon"><Kanban aria-hidden="true" /></EmptyMedia><EmptyTitle><h2>{t("noPipelineYet")}</h2></EmptyTitle><EmptyDescription>{t("noPipelineYetHelp")}</EmptyDescription></EmptyHeader>
    </Empty> : <>
      <DealToolbar query={query} stages={pipeline.stages.map((stage) => ({ id: stage.id, name: stage.name }))} members={result.members} />
      {result.deals.length === 0 ? <Empty className="min-h-[280px] border border-solid bg-card p-7 sm:p-10">
        <EmptyHeader><EmptyMedia variant="icon"><Kanban aria-hidden="true" /></EmptyMedia>
          <EmptyTitle><h2>{filtered || !result.empty ? t("noMatchingDeals") : t("noDealsYet")}</h2></EmptyTitle>
          <EmptyDescription>{filtered || !result.empty ? t("noMatchingDealsHelp") : writable ? t("noDealsYetHelp") : t("noDealsYetViewer")}</EmptyDescription></EmptyHeader>
        <EmptyContent>{filtered || !result.empty ? <Button variant="outline" asChild><Link href={query.mode === "list" ? `${base}?mode=list` : base}>{t("resetFilters")}</Link></Button>
          : writable && <DealForm tenantId={tenantId} pipelineId={pipeline.id} stages={pipeline.stages.map((stage) => ({ id: stage.id, name: stage.name }))} members={result.members} variant="outline" />}</EmptyContent>
      </Empty> : query.mode === "board" ? <DealBoard tenantId={tenantId} writable={writable} today={result.today} totals={result.stageTotals}
        stages={pipeline.stages.map((stage) => ({ id: stage.id, name: stage.name, kind: stage.kind, probability: stage.probability, color: stage.color }))}
        deals={result.deals.map((deal) => ({ id: deal.id, name: deal.name, stageId: deal.stageId, amount: deal.amount, expectedCloseDate: deal.expectedCloseDate, companyName: deal.companyName, contactName: deal.contactName, version: deal.version }))} />
        : <div className="space-y-3"><Card className="@container gap-0 overflow-hidden py-0"><Table aria-label={t("dealsList")} className="table-fixed">
          <TableHeader><TableRow>
            <TableHead className="pl-4">{t("deal")}</TableHead><TableHead className="w-36">{t("stage")}</TableHead>
            <TableHead className="hidden w-28 text-right @xl:table-cell">{t("amount")}</TableHead><TableHead className="hidden w-48 @3xl:table-cell">{t("linkedTo")}</TableHead>
            <TableHead className="hidden w-40 @5xl:table-cell">{t("owner")}</TableHead><TableHead className="hidden w-40 pr-4 @2xl:table-cell">{t("expectedClose")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{result.deals.map((deal) => { const stage = stageOf(deal.stageId); const late = stage ? isStale(stage.kind, deal.expectedCloseDate, result.today) : false;
            return <TableRow key={deal.id} className="h-12">
              <TableCell className="overflow-hidden pl-4"><Link href={`/workspaces/${tenantId}/crm/deals/${deal.id}`} className="block truncate rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{deal.name}</Link>
                <span className="block truncate text-xs text-muted-foreground @3xl:hidden">{deal.companyName ?? deal.contactName ?? t("noRelation")}</span></TableCell>
              <TableCell className="overflow-hidden">{stage && <StageBadge name={stage.name} color={stage.color} />}</TableCell>
              <TableCell className="hidden truncate text-right text-xs tabular-nums @xl:table-cell">{deal.amount === null ? <span className="text-muted-foreground">{t("noAmount")}</span> : money(deal.amount)}</TableCell>
              <TableCell className="hidden truncate text-xs @3xl:table-cell">{deal.companyName ?? deal.contactName ?? <span className="text-muted-foreground">{t("noRelation")}</span>}</TableCell>
              <TableCell className="hidden truncate text-xs text-muted-foreground @5xl:table-cell">{deal.ownerName ?? t("noOwner")}</TableCell>
              <TableCell className="hidden pr-4 text-xs @2xl:table-cell"><span className="flex min-w-0 items-center gap-1.5"><span className="truncate text-muted-foreground">{deal.expectedCloseDate ? date(deal.expectedCloseDate) : t("noDate")}</span>{late && <StaleBadge label={t("stale")} />}</span></TableCell>
            </TableRow>; })}</TableBody>
        </Table></Card>
        <RecordPagination base={base} params={dealQueryParams({ ...query, page: 1 }).toString()} page={result.page} total={result.total} label={t("dealPages")} /></div>}
    </>}
  </div>;
}
