"use client";
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Compass, ExternalLink } from "lucide-react";
import { discoverTypes, type DiscoverType } from "@/lib/discover-taxonomy";
import { languageName, reviewTone, type DiscoverCategory, type OwnListing } from "@/lib/discover-ui";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ListInDiscover } from "./list-in-discover";

type Tab = "all" | DiscoverType;

/**
 * Public > Discover for the ministry: every community, course and product with where it stands in Discover, and a panel with the shared List in Discover card to change it.
 * Courses and products have no settings screen yet, so the panel is where they are listed. A community's switch lives in its own settings and the panel links there.
 */
export function MyListings({ tenantId, initial, canEdit }: { tenantId: string; initial: OwnListing[]; canEdit: boolean }) {
  const t = useTranslations("DiscoverScreens"), [items, setItems] = useState(initial), [tab, setTab] = useState<Tab>("all"), [open, setOpen] = useState<OwnListing | null>(null);
  const counts = { all: items.length, ...Object.fromEntries(discoverTypes.map((type) => [type, items.filter((item) => item.type === type).length])) } as Record<Tab, number>;
  const visible = tab === "all" ? items : items.filter((item) => item.type === tab);
  const columns: DataTableColumn[] = [
    { id: "name", header: t("owner.name"), card: "title" },
    { id: "type", header: t("owner.type"), showFrom: "@md" },
    { id: "status", header: t("owner.status") },
    { id: "category", header: t("owner.category"), showFrom: "@lg" },
    { id: "language", header: t("owner.language"), showFrom: "@lg" },
    { id: "actions", header: t("owner.actions"), srOnlyHeader: true, align: "end", card: "actions" },
  ];
  const rows: DataTableRow[] = visible.map((item) => ({ id: `${item.type}:${item.id}`, label: item.name, cells: {
    name: <span className="break-words font-medium">{item.name}</span>,
    type: t(`typeNames.${item.type}`),
    status: <StatusBadge tone={reviewTone(item.review.state)} label={t(`card.status.${item.review.state}`)} dot />,
    category: item.category ? t(`categories.${item.category as DiscoverCategory}`) : <span className="text-muted-foreground">{t("owner.none")}</span>,
    language: item.language ? languageName(item.language) : <span className="text-muted-foreground">{t("owner.none")}</span>,
    actions: <Button type="button" variant="outline" size="responsive" aria-label={t("owner.manageNamed", { name: item.name })} onClick={() => setOpen(item)}>{t("owner.manage")}</Button>,
  } }));
  const current = open ? items.find((item) => item.type === open.type && item.id === open.id) ?? open : null;
  return <>
    <DataTable label={t("owner.tableLabel")} columns={columns} rows={rows}
      tabs={{ label: t("owner.tabsLabel"), value: tab, onValueChange: (value) => setTab(value as Tab), items: (["all", ...discoverTypes] as const).map((value) => ({ value, label: t(`owner.tabs.${value}`), count: counts[value] })) }}
      empty={<EmptyState icon={Compass} size="compact" title={items.length === 0 ? t("owner.emptyTitle") : t("owner.emptyTab")} description={items.length === 0 ? t("owner.emptyBody") : undefined} />} />
    <Sheet open={current !== null} onOpenChange={(next) => { if (!next) setOpen(null); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {current && <>
          <SheetHeader><SheetTitle className="break-words">{current.name}</SheetTitle><SheetDescription>{t(`typeNames.${current.type}`)}</SheetDescription></SheetHeader>
          <div className="px-4 pb-4"><ListInDiscover key={`${current.type}:${current.id}`} tenantId={tenantId} type={current.type} id={current.id} canEdit={canEdit} initial={current}
            managedAt={current.type === "community" ? `/workspaces/${tenantId}/communities/${current.id}/edit` : undefined}
            onChanged={(next) => setItems((all) => all.map((item) => item.type === next.type && item.id === next.id ? next : item))} /></div>
        </>}
      </SheetContent>
    </Sheet>
  </>;
}

/** The "browse Discover" link as a visitor sees it. */
export function BrowseDiscoverLink() {
  const t = useTranslations("DiscoverScreens");
  return <Button asChild variant="outline" size="responsive"><Link href="/discover" prefetch={false}><ExternalLink aria-hidden="true" />{t("owner.browse")}</Link></Button>;
}
