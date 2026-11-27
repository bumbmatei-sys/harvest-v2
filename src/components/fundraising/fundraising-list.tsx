/** Derived from Shadcn UI Kit item tables12 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Giving screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Eye,
  HandCoins,
  ListFilter,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { FundraisingFormDialog } from "@/components/fundraising/giving-dialogs";
import { formatCents, fundraisingStatuses, progressPercent, type FundraisingRow, type FundraisingStatus } from "@/lib/fundraising";

type Status = FundraisingStatus;

const statusDot: Record<Status, string> = {
  draft: "bg-muted-foreground",
  published: "bg-success",
  closed: "bg-warning",
  archived: "bg-muted-foreground",
};

function StatusBadge({
  status,
  label,
  className,
}: {
  status: Status;
  label: string;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={className}>
      <span className={cn("size-1.5 rounded-full", statusDot[status])} />
      {label}
    </Badge>
  );
}

/**
 * The ministry's fundraising campaigns: status counts, search, a status filter and the table (Harvest's DataTable, which turns rows into cards on phones).
 * Goal for everyone; raised (gifts confirmed by the ministry) and progress for owners and admins only. Creating opens the shared form dialog; a new
 * campaign opens its page.
 */
export function FundraisingList({ tenantId, rows: initialRows, canManage, campaigns }: { tenantId: string; rows: FundraisingRow[]; canManage: boolean; campaigns: { id: string; name: string }[] }) {
  const t = useTranslations("Fundraising"), locale = useLocale(), router = useRouter();
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<Status[]>([]);
  const root = `/workspaces/${tenantId}/giving/fundraising`, endpoint = `/api/workspaces/${tenantId}/fundraising`;
  const label = (status: Status) => t(`statuses.${status}`);

  const toggleStatus = (status: Status) =>
    setStatusFilter((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status],
    );

  const rows = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return initialRows.filter((row) =>
      (!statusFilter.length || statusFilter.includes(row.status)) &&
      (!needle || [row.title, row.campaignName ?? ""].some((field) =>
        field.toLowerCase().includes(needle),
      )),
    );
  }, [initialRows, query, statusFilter]);
  const showRaised = initialRows.some((row) => row.totals);
  const hasFilters = query !== "" || statusFilter.length > 0;

  const columns: DataTableColumn[] = [
    { id: "customer", header: t("columns.title"), card: "title" },
    { id: "goal", header: t("columns.goal"), align: "end", showFrom: "@md" },
    ...(showRaised ? [{ id: "collected", header: t("columns.raised"), showFrom: "@lg" } as const] : []),
    { id: "status", header: t("columns.status") },
    { id: "actions", header: t("columns.actions"), srOnlyHeader: true, align: "end", card: "actions" },
  ];

  const tableRows: DataTableRow[] = rows.map((row) => {
    const totals = row.totals;
    return {
      id: row.id,
      label: row.title,
      cells: {
        customer: (
          <div className="flex min-w-0 flex-col">
            <Link href={`${root}/${row.id}`} className="truncate font-medium underline-offset-4 hover:underline">{row.title}</Link>
            {row.campaignName && <span className="text-muted-foreground truncate text-xs">
              {row.campaignName}
            </span>}
          </div>
        ),
        goal: (
          <div className="text-right tabular-nums">
            {formatCents(row.goalCents, row.currency, locale)}
          </div>
        ),
        collected: totals ? (
          <div className="flex w-36 flex-col gap-1.5">
            <span className="text-muted-foreground text-xs tabular-nums">
              {t("stats.raisedOfGoal", { raised: formatCents(totals.raisedCents, row.currency, locale), percent: progressPercent(totals.raisedCents, row.goalCents) })}
            </span>
            <Progress
              value={Math.min(progressPercent(totals.raisedCents, row.goalCents), 100)}
              className="h-1.5"
              aria-label={t("stats.ofGoal", { percent: progressPercent(totals.raisedCents, row.goalCents) })}
            />
          </div>
        ) : <span className="text-muted-foreground">{t("notSet")}</span>,
        status: <StatusBadge status={row.status} label={label(row.status)} />,
        actions: (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("actionsFor", { title: row.title })}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem asChild className="max-lg:min-h-11">
                  <Link href={`${root}/${row.id}`}>
                    <Eye />
                    {t("view")}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    };
  });

  const summary = (["published", "draft", "closed"] as const).map((status) => ({
    label: t(`summary.${status}`),
    value: initialRows.filter((row) => row.status === status).length,
  }));

  const create = canManage ? <FundraisingFormDialog endpoint={endpoint} campaigns={campaigns} onSaved={(row) => router.push(`${root}/${row.id}`)}
    trigger={<Button className="max-lg:min-h-11">
      <Plus />
      {t("new")}
    </Button>} /> : null;

  return (
    <Card className="w-full">
      <CardHeader className="max-sm:flex max-sm:flex-col">
        <CardTitle><h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1></CardTitle>
        <CardDescription>
          {t("recordOnly")}
        </CardDescription>
        {create && <CardAction className="flex items-center gap-2">
          {create}
        </CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-0">
        <dl className="grid grid-cols-3 gap-4 px-4">
          {summary.map((item) => (
            <div key={item.label} className="flex min-w-0 flex-col gap-1">
              <dt className="text-muted-foreground truncate text-xs">
                {item.label}
              </dt>
              <dd className="truncate font-medium tabular-nums sm:text-lg">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-2 px-4">
          <InputGroup className="w-full max-lg:min-h-11 sm:w-64">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search")}
              aria-label={t("search")}
            />
          </InputGroup>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="max-lg:min-h-11">
                <ListFilter />
                {t("columns.status")}
                {statusFilter.length > 0 && (
                  <span className="text-muted-foreground tabular-nums">
                    {statusFilter.length}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>{t("filterByStatus")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {fundraisingStatuses.map((status) => (
                <DropdownMenuCheckboxItem
                  key={status}
                  className="max-lg:min-h-11"
                  checked={statusFilter.includes(status)}
                  onCheckedChange={() => toggleStatus(status)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {label(status)}
                  <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                    {
                      initialRows.filter(
                        (row) => row.status === status,
                      ).length
                    }
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
              {statusFilter.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="max-lg:min-h-11" onSelect={() => setStatusFilter([])}>
                    {t("clearFilter")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <DataTable label={t("listLabel")} columns={columns} rows={tableRows} bordered={false}
          className="[&_td:first-child]:ps-4 [&_td:last-child]:pe-4 [&_th:first-child]:ps-4 [&_th:last-child]:pe-4 [&_thead_tr]:bg-muted/50 [&_thead_tr]:hover:bg-muted/50 [&_th]:text-muted-foreground [&_thead_tr]:border-t"
          empty={
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {hasFilters ? <Search /> : <HandCoins />}
                </EmptyMedia>
                <EmptyTitle>{hasFilters ? t("noMatches") : t("empty")}</EmptyTitle>
                <EmptyDescription>
                  {hasFilters
                    ? t("noMatchesDescription")
                    : canManage ? t("emptyDescription") : null}
                </EmptyDescription>
              </EmptyHeader>
              {hasFilters && (
                <EmptyContent>
                  <Button
                    variant="outline"
                    size="sm"
                    className="max-lg:min-h-11"
                    onClick={() => {
                      setQuery("");
                      setStatusFilter([]);
                    }}
                  >
                    {t("resetFilters")}
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          } />
      </CardContent>
    </Card>
  );
}
