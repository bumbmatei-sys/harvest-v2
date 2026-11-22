/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/file-manager/page.tsx and app/dashboard/(auth)/apps/file-manager/components/file-manager.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileText, FolderOpen, Home, RotateCw, Search, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/empty-state";
import { SourceLogo } from "@/components/office/provider-logo";
import { FolderCards, type FolderCard } from "@/components/files/folder-cards";
import { FilesTable } from "@/components/files/files-table";
import { SourceFilter } from "@/components/files/source-filter";
import { SourcesDialog } from "@/components/files/sources-dialog";
import { StorageOverview } from "@/components/files/storage-overview";
import { UploadDialog } from "@/components/files/upload-dialog";
import { useListings, type ListingRequest } from "@/components/files/use-listings";
import { errorMessage } from "@/i18n/messages";
import { filesApi, type DriveItem } from "@/lib/office/files";
import { OfficeApiError, type OfficeOverview } from "@/lib/office/mail";
import { driveEntry, driveSource, groupStats, harvestEntry, harvestFolderEntry, harvestGroups, harvestSource, matchesSearch, orderFolders, orderListing, orderRecent, safeUrl, shownSources, showMarks, toggleSource, type FileEntry, type HarvestFile, type Selection, type Source } from "@/lib/files-screen";
import { notify } from "@/lib/toast";

const HARVEST_LIMIT = 100, RECENT = 8, FILES_GRANT = 4;
type Crumb = { ref: string; name: string };
type Nav = { source: Source; path: Crumb[] };
const none: Selection = new Set();

function useDebounced(value: string, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setSettled(value), ms); return () => clearTimeout(timer); }, [value, ms]);
  return settled;
}

/**
 * The one Files screen. Harvest's own uploads are always a source; the person's own connected drives (Google Drive, OneDrive) join them through the Office routes,
 * listed live with no bytes stored. A source filter picks one, any combination or all (only connected sources are offered); while more than one is shown each icon
 * carries a small source mark and a name that includes its source. Home shows the folder cards, recent files and the Harvest storage overview; opening a folder, searching or
 * "all files" switches to the list view with breadcrumbs. Everything that leaves the ministry (provider downloads, sharing, uploads, deletes) is hard-off and absent.
 */
export function FilesScreen({ tenantId, files, canUpload, officeEnabled }: { tenantId: string; files: readonly (Omit<HarvestFile, "createdAt"> & { createdAt: string | Date })[]; canUpload: boolean; officeEnabled: boolean }) {
  const t = useTranslations("FilesScreen");
  const notice = useTranslations("Office");
  const h = useTranslations("ComponentsFilesFileList");
  const router = useRouter();
  const api = useMemo(() => filesApi(tenantId), [tenantId]);

  const [overview, setOverview] = useState<OfficeOverview | null>(null);
  const refreshOverview = useCallback(async () => {
    if (!officeEnabled) return;
    try { setOverview(await api.overview()); } catch (error) { if (error instanceof OfficeApiError) setOverview(null); }
  }, [api, officeEnabled]);
  useEffect(() => { void Promise.resolve().then(refreshOverview); }, [refreshOverview]);

  const connections = useMemo(() => overview?.connections.filter((connection) => connection.kind === "files") ?? [], [overview]);
  const unhealthy = connections.filter((connection) => !(connection.health === "healthy" && connection.platform !== null && (connection.grants & FILES_GRANT) === FILES_GRANT));
  const drives = useMemo(() => connections.filter((connection) => connection.health === "healthy" && connection.platform !== null && (connection.grants & FILES_GRANT) === FILES_GRANT)
    .map((connection) => driveSource({ id: connection.id, platform: connection.platform! })), [connections]);
  const sources = useMemo(() => [harvestSource, ...drives], [drives]);

  const [selection, setSelection] = useState<Selection>(none);
  const [query, setQuery] = useState(""), search = useDebounced(query.trim(), 300);
  const [nav, setNav] = useState<Nav | null>(null), [browseAll, setBrowseAll] = useState(false);
  const shown = shownSources(sources, selection), marked = showMarks(shown);
  const harvestShown = shown.some((source) => source.kind === "harvest");
  const shownDrives = shown.filter((source) => source.kind !== "harvest");
  const explorer = nav !== null || search !== "" || browseAll;

  const harvestFiles = useMemo<HarvestFile[]>(() => files.map((file) => ({ ...file, canConfirm: file.canConfirm && canUpload })), [files, canUpload]);
  const harvestEntries = useMemo(() => harvestFiles.map((file) => harvestEntry(file)), [harvestFiles]);

  const scoped = nav && nav.source.kind !== "harvest" ? nav : null;
  const requests = useMemo<ListingRequest[]>(() => {
    if (scoped) return [{ key: scoped.source.id, connectionId: scoped.source.id, ...(scoped.path.length ? { folderRef: scoped.path[scoped.path.length - 1].ref } : {}), ...(search ? { search } : {}) }];
    if (nav) return [];
    return shownDrives.map((source) => ({ key: source.id, connectionId: source.id, ...(search ? { search } : {}) }));
  }, [scoped, nav, shownDrives, search]);
  const { listings, loadMore, retry } = useListings(api, requests);

  const providerEntries = useCallback((source: Source): FileEntry[] => (listings[source.id]?.items ?? []).map((item: DriveItem) => driveEntry(source, item)), [listings]);
  const activeDrives = scoped ? [scoped.source] : nav ? [] : shownDrives;

  const harvestFolders = useMemo(() => {
    const stats = groupStats(harvestFiles);
    return harvestGroups.filter((group) => stats[group].count > 0).map((group) => harvestFolderEntry(group, t(`groups.${group}`), stats[group].count, stats[group].size));
  }, [harvestFiles, t]);

  // Entries of the current view.
  const homeFolders: FolderCard[] = [...(harvestShown ? harvestFolders : []), ...orderFolders(shownDrives.flatMap(providerEntries), sources)];
  const recent = orderRecent([...(harvestShown ? harvestEntries : []), ...shownDrives.flatMap(providerEntries)], sources).slice(0, RECENT);
  const explorerEntries = useMemo<FileEntry[]>(() => {
    if (nav?.source.kind === "harvest") {
      const group = nav.path[0]?.ref;
      return orderListing(harvestEntries.filter((entry) => (!group || entry.group === group) && (!search || matchesSearch(entry.name, search))), sources);
    }
    if (scoped) return orderListing(providerEntries(scoped.source), sources);
    const harvestPart = !harvestShown ? [] : search ? harvestEntries.filter((entry) => matchesSearch(entry.name, search)) : [...harvestFolders, ...harvestEntries];
    return orderListing([...harvestPart, ...shownDrives.flatMap(providerEntries)], sources);
  }, [nav, scoped, harvestEntries, harvestFolders, harvestShown, search, shownDrives, providerEntries, sources]);

  const listingBusy = activeDrives.some((source) => (listings[source.id]?.status ?? "loading") === "loading");
  const [busyId, setBusyId] = useState<string | null>(null), [actionError, setActionError] = useState("");

  async function harvestAction(entry: FileEntry, action: "download" | "confirm") {
    const file = entry.harvest;
    if (!file) return;
    setBusyId(file.id); setActionError("");
    try {
      const response = await fetch(`/api/workspaces/${tenantId}/files/${file.id}/${action}`, { method: action === "confirm" ? "POST" : "GET" });
      const data = await response.json();
      if (!response.ok) throw new Error(errorMessage(data.error));
      if (action === "download") window.location.assign(data.url); else router.refresh();
    } catch (error) { setActionError(error instanceof Error ? error.message : h("couldNotOpenFilePleaseTryAgain")); }
    finally { setBusyId(null); }
  }
  async function preview(entry: FileEntry) {
    try {
      const result = await api.preview(entry.source.id, entry.ref);
      const url = result.state === "available" ? safeUrl(result.data.url) : null;
      if (url) window.open(url, "_blank", "noopener,noreferrer"); else notify.info(t("previewUnavailable"));
    } catch { notify.error(t("previewFailed")); }
  }

  function openFolder(entry: FileEntry) {
    const crumb = { ref: entry.ref, name: entry.name };
    setQuery("");
    setBrowseAll(false);
    setNav((current) => current && current.source.id === entry.source.id && entry.source.kind !== "harvest" ? { source: current.source, path: [...current.path, crumb] } : { source: entry.source, path: [crumb] });
  }
  const home = () => { setNav(null); setBrowseAll(false); setQuery(""); };
  const toggle = (id: string) => { setSelection((current) => toggleSource(current, id, sources.map((source) => source.id))); home(); };

  const harvestNote = harvestShown && harvestFiles.length > 0 ? (harvestFiles.length >= HARVEST_LIMIT ? t("latest", { count: HARVEST_LIMIT }) : t("readyOnly")) : undefined;
  const sourceAlerts = activeDrives.map((source) => {
    const listing = listings[source.id];
    if (!listing || listing.status === "loading" || listing.status === "ready") return null;
    const text = listing.status === "error" ? t("sourceError", { source: source.name }) : t(`sourceState.${listing.status}`, { source: source.name });
    return <Alert key={source.id} variant={listing.status === "error" ? "destructive" : "default"} role={listing.status === "error" ? "alert" : "status"} data-testid="source-alert"><TriangleAlert aria-hidden="true" />
      <AlertDescription className="flex flex-wrap items-center gap-2">{text}<Button type="button" variant="outline" size="responsive" onClick={retry}><RotateCw aria-hidden="true" />{t("retry")}</Button></AlertDescription></Alert>;
  });
  const partial = activeDrives.some((source) => listings[source.id]?.partial);
  const moreButtons = activeDrives.map((source) => {
    const listing = listings[source.id];
    if (!listing?.nextCursor) return null;
    return <div key={source.id} className="flex flex-wrap items-center gap-2 p-3">
      <Button type="button" variant="outline" size="responsive" disabled={listing.loadingMore} onClick={() => void loadMore(source.id)} data-testid="load-more">{listing.loadingMore ? <Spinner /> : null}{marked ? t("loadMoreFrom", { source: source.name }) : t("loadMore")}</Button>
      {listing.moreFailed && <span role="alert" className="text-sm text-destructive">{t("loadMoreFailed")}</span>}
    </div>;
  });

  const noneYet = <EmptyState icon={FileText} size="compact" title={h("noFilesYet")} description={canUpload ? t("uploadYourFirstFile") : h("filesUploadedByWorkspaceMembersWillAppearHere")} />;
  const tableProps = { marked, busyId, onOpenFolder: openFolder, onHarvestAction: (entry: FileEntry, action: "download" | "confirm") => void harvestAction(entry, action), onPreview: (entry: FileEntry) => void preview(entry) };

  // Breadcrumbs: Files, then (with marks) the source, then the folder path or the current search.
  const crumbs = (() => {
    const items: { key: string; label: React.ReactNode; onSelect?: () => void }[] = [];
    if (nav) {
      if (marked) items.push({ key: "source", label: <span className="inline-flex items-center gap-1.5"><SourceLogo source={nav.source.kind} className="size-4" />{nav.source.name}</span>, onSelect: nav.path.length || search ? () => { setQuery(""); setNav({ source: nav.source, path: [] }); } : undefined });
      nav.path.forEach((crumb, index) => items.push({ key: `${index}:${crumb.ref}`, label: crumb.name, onSelect: index < nav.path.length - 1 || search ? () => { setQuery(""); setNav({ source: nav.source, path: nav.path.slice(0, index + 1) }); } : undefined }));
    } else if (browseAll && !search) items.push({ key: "all", label: t("allFiles") });
    if (search) items.push({ key: "search", label: t("searchResults") });
    return items;
  })();

  return <div className="space-y-4 lg:space-y-6" data-testid="files-screen" data-marked={marked ? "true" : "false"}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1>
      <div className="flex flex-wrap items-center gap-2">
        {officeEnabled && overview && <SourcesDialog api={api} connections={connections} notice={notice("personalConnectionNotice")} noticeVersion={overview.notice.version} onChanged={() => void refreshOverview()} />}
        <UploadDialog tenantId={tenantId} canUpload={canUpload} />
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-0 flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={300} aria-label={t("search")} placeholder={t("searchPlaceholder")} className="h-11 ps-9 lg:h-9" data-testid="files-search" />
      </div>
      {drives.length > 0 && <SourceFilter sources={sources} selection={selection} onToggle={toggle} onAll={() => { setSelection(none); home(); }} />}
    </div>

    {unhealthy.length > 0 && <Alert role="status" data-testid="source-attention"><TriangleAlert aria-hidden="true" /><AlertDescription>{t("sourceAttention")}</AlertDescription></Alert>}
    {actionError && <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert>}
    {sourceAlerts}
    {partial && <Alert role="status" data-testid="partial-notice"><AlertDescription>{t("partial")}</AlertDescription></Alert>}

    {explorer
      ? <Card className="gap-0 py-0" data-testid="files-explorer">
        <CardHeader className="border-b py-4"><Breadcrumb><BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink asChild><button type="button" onClick={home} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 lg:min-h-8" data-testid="crumb-root"><Home className="size-4" aria-hidden="true" />{t("title")}</button></BreadcrumbLink></BreadcrumbItem>
          {crumbs.map((crumb) => <Fragment key={crumb.key}><BreadcrumbSeparator />
            <BreadcrumbItem>{crumb.onSelect ? <BreadcrumbLink asChild><button type="button" onClick={crumb.onSelect} className="inline-flex min-h-11 items-center rounded-md px-1 lg:min-h-8">{crumb.label}</button></BreadcrumbLink> : <BreadcrumbPage>{crumb.label}</BreadcrumbPage>}</BreadcrumbItem></Fragment>)}
        </BreadcrumbList></Breadcrumb></CardHeader>
        <CardContent className="p-0">
          <FilesTable {...tableProps} entries={explorerEntries} label={t("listLabel")} note={harvestNote} state={listingBusy && explorerEntries.length === 0 ? "loading" : "ready"}
            empty={<EmptyState icon={FolderOpen} size="compact" title={search ? t("noMatches") : t("emptyFolder")} />} pagination={<>{moreButtons}</>} />
        </CardContent>
      </Card>
      : <>
        {listingBusy && homeFolders.length === 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-busy="true" aria-label={t("loading")}>{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-20 rounded-xl" />)}</div>}
        {homeFolders.length > 0 && <section aria-label={t("folders")}><FolderCards folders={homeFolders} marked={marked} onOpen={openFolder} /></section>}
        <Card className="gap-0 py-0" data-testid="recent-files">
          <CardHeader className="border-b py-4"><CardTitle><h2>{t("recent")}</h2></CardTitle><CardAction><Button type="button" variant="outline" size="responsive" onClick={() => setBrowseAll(true)} data-testid="view-all">{t("viewAll")}</Button></CardAction></CardHeader>
          <CardContent className="p-0">
            <FilesTable {...tableProps} entries={recent} label={t("recent")} note={harvestNote} state={listingBusy && recent.length === 0 ? "loading" : "ready"} empty={noneYet} />
          </CardContent>
        </Card>
        {harvestShown && <StorageOverview files={harvestFiles} limit={HARVEST_LIMIT} />}
      </>}
  </div>;
}
