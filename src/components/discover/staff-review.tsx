/** Derived from Shadcn UI Kit item drawer1 (free), registry retrieved 2026-11-25, approved 2026-11-25 (Discover screens). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Flag, ShieldCheck, TriangleAlert } from "lucide-react";
import type { QueueItem } from "@/server/discover/platform";
import { request, type RequestResult } from "@/hooks/use-request";
import { authClient } from "@/lib/auth-client";
import type { DiscoverType } from "@/lib/discover-taxonomy";
import { languageName, reviewTone, type DiscoverCategory } from "@/lib/discover-ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

type Role = "reviewer" | "admin";
type QueueState = "pending" | "approved" | "rejected" | "suspended";
type Tab = QueueState | "reports";
export type StaffReport = { id: string; tenantId: string; type: DiscoverType; resourceId: string; reason: string; note: string | null; createdAt: string };
type Lists = Record<QueueState, QueueItem[]> & { reports: StaffReport[] };
type Load = "loading" | "ready" | "error" | "reauth";
type Selected = { kind: "listing"; item: QueueItem } | { kind: "report"; report: StaffReport } | null;
const pageSize = 25;
const audiences = new Set<string>(["church", "ministry_nonprofit", "evangelist_missionary", "creator"]);
const queueStates: QueueState[] = ["pending", "approved", "rejected", "suspended"];

/** Fetches the four lists. A 401 from any staff route (the sign-in is older than 15 minutes) is reported as `reauth`; the neutral 404 of a revoked role is a plain failure. */
async function loadLists(): Promise<{ load: Load; lists?: Lists }> {
  const results = await Promise.all([...queueStates.map((state) => request<{ items: QueueItem[] }>(`/api/platform/discover/queue?state=${state}`, { method: "GET" })),
    request<{ reports: StaffReport[] }>("/api/platform/discover/reports", { method: "GET" })]) as [RequestResult<{ items: QueueItem[] }>, RequestResult<{ items: QueueItem[] }>, RequestResult<{ items: QueueItem[] }>, RequestResult<{ items: QueueItem[] }>, RequestResult<{ reports: StaffReport[] }>];
  if (results.some((result) => !result.ok && result.status === 401)) return { load: "reauth" };
  const [pending, approved, rejected, suspended, reports] = results;
  if (!pending.ok || !approved.ok || !rejected.ok || !suspended.ok || !reports.ok) return { load: "error" };
  return { load: "ready", lists: { pending: pending.data.items, approved: approved.data.items, rejected: rejected.data.items, suspended: suspended.data.items, reports: reports.data.reports } };
}

/**
 * The Harvest staff Discover review: tabs Pending, Approved, Rejected and Reports on the shared DataTable, and a side panel for one listing or report. Reviewers approve, reject and
 * resolve reports; admins also suspend, reinstate and set a ministry's standing (the server enforces the same; admin-only actions are not rendered for a reviewer).
 */
export function StaffReview({ role }: { role: Role }) {
  const t = useTranslations("DiscoverScreens"), format = useFormatter();
  const [tab, setTab] = useState<Tab>("pending"), [lists, setLists] = useState<Lists | null>(null), [load, setLoad] = useState<Load>("loading"), [selected, setSelected] = useState<Selected>(null), [banner, setBanner] = useState("");
  const refresh = useCallback(async () => { setLoad("loading"); const next = await loadLists(); if (next.lists) setLists(next.lists); setLoad(next.load); }, []);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer); }, [refresh]);
  const known = useMemo(() => new Map((lists ? [...lists.pending, ...lists.approved, ...lists.rejected, ...lists.suspended] : []).map((item) => [`${item.type}:${item.id}`, item])), [lists]);
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium", timeZone: "UTC" });
  const count = (n: number | undefined) => (n === undefined ? undefined : n >= pageSize ? `${pageSize}+` : n);

  async function signInAgain() { await authClient.signOut().catch(() => undefined); window.location.replace("/sign-in?next=%2Fplatform%2Fdiscover"); }
  async function done(message: string) { setSelected(null); setBanner(message); await refresh(); }

  const queueColumns: DataTableColumn[] = [
    { id: "listing", header: t("staff.listing"), card: "title" }, { id: "type", header: t("staff.type"), showFrom: "@md" }, { id: "host", header: t("staff.host"), showFrom: "@lg" },
    { id: "category", header: t("staff.category"), showFrom: "@3xl" }, { id: "submitted", header: t("staff.submitted"), showFrom: "@lg" }, { id: "reports", header: t("staff.reports"), showFrom: "@md" },
    { id: "status", header: t("staff.status") }, { id: "actions", header: t("staff.review"), srOnlyHeader: true, align: "end", card: "actions" },
  ];
  const reportColumns: DataTableColumn[] = [
    { id: "listing", header: t("staff.listing"), card: "title" }, { id: "type", header: t("staff.type"), showFrom: "@md" }, { id: "reason", header: t("staff.report.reason") },
    { id: "reported", header: t("staff.reportedOn"), showFrom: "@lg" }, { id: "actions", header: t("staff.review"), srOnlyHeader: true, align: "end", card: "actions" },
  ];
  const queueRows = (items: QueueItem[]): DataTableRow[] => items.map((item) => ({ id: `${item.type}:${item.id}`, label: item.name ?? item.id, cells: {
    listing: <span className="break-words font-medium">{item.name ?? t("staff.none")}</span>, type: t(`typeNames.${item.type}`), host: item.hostName ?? t("staff.none"),
    category: item.category ? t(`categories.${item.category as DiscoverCategory}`) : t("staff.none"), submitted: date(item.requestedAt), reports: item.openReports,
    status: <span className="flex flex-wrap gap-1"><StatusBadge tone={reviewTone(item.state)} label={t(`card.status.${item.state as "pending"}`)} dot />{item.materialChange && <Badge variant="outline">{t("staff.materialChange")}</Badge>}</span>,
    actions: <Button type="button" variant="outline" size="responsive" aria-label={t("staff.reviewNamed", { name: item.name ?? item.id })} onClick={() => setSelected({ kind: "listing", item })}>{t("staff.review")}</Button>,
  } }));
  const reportRows = (items: StaffReport[]): DataTableRow[] => items.map((report) => {
    const listing = known.get(`${report.type}:${report.resourceId}`), name = listing?.name ?? `${t(`typeNames.${report.type}`)} ${report.resourceId.slice(0, 8)}`;
    return { id: report.id, label: name, cells: {
      listing: <span className="break-words font-medium">{name}</span>, type: t(`typeNames.${report.type}`), reason: t(`staff.report.reasons.${report.reason as "spam"}`), reported: date(report.createdAt),
      actions: <Button type="button" variant="outline" size="responsive" aria-label={t("staff.reviewNamed", { name })} onClick={() => setSelected({ kind: "report", report })}>{t("staff.review")}</Button>,
    } };
  });

  if (load === "reauth") return <Alert role="alert"><TriangleAlert aria-hidden="true" /><AlertTitle>{t("staff.reauthTitle")}</AlertTitle>
    <AlertDescription className="space-y-3"><p>{t("staff.reauthBody")}</p><Button type="button" size="responsive" onClick={() => void signInAgain()}>{t("staff.reauthAction")}</Button></AlertDescription></Alert>;

  const state = load === "loading" && !lists ? "loading" : load === "error" && !lists ? "error" : "ready";
  const tableState = load === "loading" ? "loading" : state;
  const rows = tab === "reports" ? reportRows(lists?.reports ?? []) : queueRows(lists?.[tab] ?? []);
  return <div className="min-w-0 space-y-4">
    {banner && <p role="status" className="rounded-md border bg-card px-3 py-2 text-sm">{banner}</p>}
    <DataTable label={tab === "reports" ? t("staff.reportsLabel") : t("staff.tableLabel")} columns={tab === "reports" ? reportColumns : queueColumns} rows={rows} state={tableState}
      tabs={{ label: t("staff.tabsLabel"), value: tab, onValueChange: (value) => { setTab(value as Tab); setBanner(""); }, items: (["pending", "approved", "rejected", "suspended", "reports"] as const).map((value) => ({ value, label: t(`staff.tabs.${value}`), count: count(lists?.[value].length) })) }}
      toolbar={{ actions: <Button type="button" variant="outline" size="responsive" disabled={load === "loading"} onClick={() => void refresh()}>{t("staff.refresh")}</Button> }}
      error={<Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{t("staff.loadFailed")}<Button type="button" variant="outline" size="responsive" onClick={() => void refresh()}>{t("staff.retry")}</Button></AlertDescription></Alert>}
      empty={<EmptyState icon={tab === "reports" ? Flag : ShieldCheck} size="compact" title={t(`staff.empty.${tab}`)} />} />
    {rows.length >= pageSize && <p className="text-sm text-muted-foreground">{t("staff.limitNote", { count: pageSize })}</p>}
    <Sheet open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {selected?.kind === "listing" && <ListingPanel key={`${selected.item.id}:${selected.item.version}`} item={selected.item} role={role} onDone={done} date={date} />}
        {selected?.kind === "report" && <ReportPanel key={selected.report.id} report={selected.report} listing={known.get(`${selected.report.type}:${selected.report.resourceId}`)} onDone={done} date={date}
          onOpenListing={(item) => setSelected({ kind: "listing", item })} />}
      </SheetContent>
    </Sheet>
  </div>;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{children}</dd></>;
}

function ListingPanel({ item, role, onDone, date }: { item: QueueItem; role: Role; onDone: (message: string) => Promise<void>; date: (value: string) => string }) {
  const t = useTranslations("DiscoverScreens"), ministryTypes = useTranslations("ComponentsAudienceField");
  const [reason, setReason] = useState(""), [reasonError, setReasonError] = useState(false), [standingReason, setStandingReason] = useState(""), [standingError, setStandingError] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const admin = role === "admin", decided = { approve: "approved", reject: "rejected", suspend: "suspended", reinstate: "reinstated" } as const;
  async function decide(decision: keyof typeof decided): Promise<string | void> {
    const body = { type: item.type, version: item.version, decision, ...(decision === "reject" || decision === "suspend" ? { reason: reason.trim() } : {}) };
    const result = await request<{ state: string }>(`/api/platform/discover/reviews/${item.id}/decision`, { method: "POST", body });
    if (result.ok) { await onDone(t(`staff.decided.${decided[decision]}`)); return; }
    return result.status === 409 ? t("staff.stale") : result.status === 422 ? t("staff.notReviewable") : t("staff.failed");
  }
  async function approve() { setBusy(true); setError(""); const failure = await decide("approve"); setBusy(false); if (failure) setError(failure); }
  async function standing(suspended: boolean): Promise<string | void> {
    const result = await request(`/api/platform/discover/ministries/${item.tenantId}/standing`, { method: "POST", body: { suspended, ...(suspended ? { reason: standingReason.trim() } : {}) } });
    if (result.ok) { await onDone(t(suspended ? "staff.standingDone.suspended" : "staff.standingDone.restored")); return; }
    return t("staff.failed");
  }
  const needsReason = (set: (value: boolean) => void, value: string) => { const missing = value.trim().length === 0; set(missing); return !missing; };
  const canReject = item.state === "pending", canApprove = item.state === "pending", canSuspend = admin && (item.state === "pending" || item.state === "approved"), canReinstate = admin && item.state === "suspended";
  const [confirm, setConfirm] = useState<"reject" | "suspend" | "standing" | null>(null);
  return <>
    <SheetHeader><SheetTitle className="break-words">{item.name ?? t("staff.panelTitle")}</SheetTitle>
      <SheetDescription className="flex flex-wrap items-center gap-2">{t(`typeNames.${item.type}`)}<StatusBadge tone={reviewTone(item.state)} label={t(`card.status.${item.state as "pending"}`)} dot />{item.materialChange && <Badge variant="outline">{t("staff.materialChange")}</Badge>}</SheetDescription></SheetHeader>
    <div className="space-y-6 px-4 pb-4">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <Fact label={t("staff.fields.summary")}>{item.summary ?? t("staff.none")}</Fact>
        <Fact label={t("staff.fields.host")}>{item.hostName ?? t("staff.none")}</Fact>
        <Fact label={t("staff.fields.category")}>{item.category ? t(`categories.${item.category as DiscoverCategory}`) : t("staff.none")}</Fact>
        <Fact label={t("staff.fields.language")}>{item.language ? languageName(item.language) : t("staff.none")}</Fact>
        {item.audience && <Fact label={t("staff.fields.audience")}>{audiences.has(item.audience) ? ministryTypes(item.audience as "church") : item.audience}</Fact>}
        <Fact label={t("staff.fields.price")}>{item.free === null ? t("staff.none") : item.free ? t("staff.free") : t("staff.paid")}</Fact>
        {item.reason && <Fact label={t("staff.fields.reason")}>{item.reason}</Fact>}
        <Fact label={t("staff.submitted")}>{date(item.requestedAt)}</Fact>
        <Fact label={t("staff.fields.openReports")}>{item.openReports}</Fact>
        <Fact label={t("staff.fields.ministryId")}><code className="text-xs">{item.tenantId}</code></Fact>
        <Fact label={t("staff.fields.listingId")}><code className="text-xs">{item.id}</code></Fact>
      </dl>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {(canApprove || canReject || canSuspend || canReinstate) && <section aria-label={t("staff.review")} className="space-y-3">
        {(canReject || canSuspend) && <Field data-invalid={reasonError || undefined}><FieldLabel htmlFor="staff-reason">{t("staff.reasonLabel")}</FieldLabel>
          <Textarea id="staff-reason" rows={3} maxLength={500} value={reason} aria-invalid={reasonError || undefined} aria-describedby={reasonError ? "staff-reason-error" : undefined} onChange={(e) => { setReason(e.target.value); setReasonError(false); }} />
          {reasonError && <FieldError id="staff-reason-error">{t("staff.reasonRequired")}</FieldError>}</Field>}
        <div className="flex flex-wrap gap-2">
          {canApprove && <Button type="button" size="responsive" disabled={busy} onClick={() => void approve()}>{t("staff.approve")}</Button>}
          {canReject && <Button type="button" variant="outline" size="responsive" onClick={() => { if (needsReason(setReasonError, reason)) setConfirm("reject"); }}>{t("staff.reject")}</Button>}
          {canSuspend && <Button type="button" variant="destructive" size="responsive" onClick={() => { if (needsReason(setReasonError, reason)) setConfirm("suspend"); }}>{t("staff.suspend")}</Button>}
          {canReinstate && <Button type="button" size="responsive" disabled={busy} onClick={async () => { setBusy(true); setError(""); const failure = await decide("reinstate"); setBusy(false); if (failure) setError(failure); }}>{t("staff.reinstate")}</Button>}
        </div>
      </section>}
      {admin && <section aria-labelledby="staff-standing" className="space-y-3 border-t pt-4">
        <h3 id="staff-standing" className="text-base font-semibold">{t("staff.standingTitle")}</h3>
        <p className="text-sm text-muted-foreground">{t("staff.standingBody")}</p>
        <Field data-invalid={standingError || undefined}><FieldLabel htmlFor="staff-standing-reason">{t("staff.standingReason")}</FieldLabel>
          <Textarea id="staff-standing-reason" rows={2} maxLength={500} value={standingReason} aria-invalid={standingError || undefined} aria-describedby={standingError ? "staff-standing-error" : undefined} onChange={(e) => { setStandingReason(e.target.value); setStandingError(false); }} />
          {standingError && <FieldError id="staff-standing-error">{t("staff.reasonRequired")}</FieldError>}</Field>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="destructive" size="responsive" onClick={() => { if (needsReason(setStandingError, standingReason)) setConfirm("standing"); }}>{t("staff.standingSuspend")}</Button>
          <ConfirmDialog tone="neutral" trigger={<Button type="button" variant="outline" size="responsive">{t("staff.standingRestore")}</Button>} title={t("staff.standingRestore")} confirmLabel={t("staff.confirm")} cancelLabel={t("staff.cancel")} onConfirm={() => standing(false)} />
        </div>
      </section>}
    </div>
    <ConfirmDialog open={confirm === "reject"} onOpenChange={(open) => { if (!open) setConfirm(null); }} title={t("staff.confirmReject")} description={t("staff.confirmRejectBody")} confirmLabel={t("staff.reject")} cancelLabel={t("staff.cancel")} onConfirm={() => decide("reject")} />
    <ConfirmDialog open={confirm === "suspend"} onOpenChange={(open) => { if (!open) setConfirm(null); }} title={t("staff.confirmSuspend")} description={t("staff.confirmSuspendBody")} confirmLabel={t("staff.suspend")} cancelLabel={t("staff.cancel")} onConfirm={() => decide("suspend")} />
    <ConfirmDialog open={confirm === "standing"} onOpenChange={(open) => { if (!open) setConfirm(null); }} title={t("staff.standingSuspend")} description={t("staff.standingBody")} confirmLabel={t("staff.standingSuspend")} cancelLabel={t("staff.cancel")} onConfirm={() => standing(true)} />
  </>;
}

function ReportPanel({ report, listing, onDone, onOpenListing, date }: { report: StaffReport; listing: QueueItem | undefined; onDone: (message: string) => Promise<void>; onOpenListing: (item: QueueItem) => void; date: (value: string) => string }) {
  const t = useTranslations("DiscoverScreens"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function resolve(status: "reviewed" | "dismissed") {
    setBusy(true); setError("");
    const result = await request(`/api/platform/discover/reports/${report.id}/resolve`, { method: "POST", body: { status } });
    setBusy(false);
    if (result.ok) await onDone(t("staff.report.resolved")); else setError(t("staff.failed"));
  }
  return <>
    <SheetHeader><SheetTitle className="break-words">{listing?.name ?? t("staff.panelReport")}</SheetTitle><SheetDescription>{t(`typeNames.${report.type}`)}</SheetDescription></SheetHeader>
    <div className="space-y-6 px-4 pb-4">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <Fact label={t("staff.report.reason")}>{t(`staff.report.reasons.${report.reason as "spam"}`)}</Fact>
        {report.note && <Fact label={t("staff.report.note")}>{report.note}</Fact>}
        <Fact label={t("staff.reportedOn")}>{date(report.createdAt)}</Fact>
        {listing && <><Fact label={t("staff.fields.host")}>{listing.hostName ?? t("staff.none")}</Fact><Fact label={t("staff.fields.state")}>{t(`card.status.${listing.state as "pending"}`)}</Fact></>}
        <Fact label={t("staff.fields.ministryId")}><code className="text-xs">{report.tenantId}</code></Fact>
        <Fact label={t("staff.fields.listingId")}><code className="text-xs">{report.resourceId}</code></Fact>
      </dl>
      {!listing && <p className="text-sm text-muted-foreground">{t("staff.report.noName")}</p>}
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="responsive" disabled={busy} onClick={() => void resolve("reviewed")}>{t("staff.report.markReviewed")}</Button>
        <Button type="button" variant="outline" size="responsive" disabled={busy} onClick={() => void resolve("dismissed")}>{t("staff.report.dismiss")}</Button>
        {listing && <Button type="button" variant="ghost" size="responsive" onClick={() => onOpenListing(listing)}>{t("staff.review")}</Button>}
      </div>
    </div>
  </>;
}
