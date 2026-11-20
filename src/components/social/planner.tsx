"use client";
import Link from "next/link";
import { joinParts } from "@/lib/social/join";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addDays, endOfMonth, endOfWeek, format, isSameDay, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { CalendarClock, CalendarPlus, Copy, ListOrdered, ShieldAlert, XCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { MonthCalendar } from "@/components/events/month-calendar";
import { StatusBadge } from "@/components/status-badge";
import { DeliveryResults, deliveryTone } from "@/components/social/delivery-results";
import { DraftsPanel } from "@/components/social/drafts-panel";
import { ScheduleDialog } from "@/components/social/schedule-dialog";
import { ScheduleManager } from "@/components/social/schedule-manager";
import { SocialNav } from "@/components/social/social-nav";
import { useReason } from "@/components/social/use-reason";
import { useSocialData } from "@/components/social/use-social-data";
import { WeekCalendar } from "@/components/social/week-calendar";
import { useMediaQuery } from "@/hooks/use-media-query";
import { socialApi, SocialApiError, type DraftSummary, type DraftView, type PlannerItem, type Target } from "@/lib/social/api";
import { parseMonth, type CalendarEvent } from "@/lib/event-view";
import { platformLabels, platformMonograms } from "@/lib/social/labels";
import { socialPlatforms } from "@/lib/social/platforms";
import { browserTimeZone, formatClock, formatWhen } from "@/lib/social/time";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";

const statuses = ["queued", "scheduled", "publishing", "published", "failed", "cancelled", "unknown"] as const;
type Action = { kind: "reschedule"; items: PlannerItem[]; whole: boolean } | { kind: "cancel"; item: PlannerItem } | { kind: "move"; item: PlannerItem; iso: string } | { kind: "place"; draft: { id: string; version: number }; iso: string } | { kind: "scheduleDraft"; draft: DraftSummary };

/** Queue, Calendar (month and week) and the drafts panel over one set of actions: move, cancel, duplicate and per-destination retry. All data comes from the Publish routes. */
export function Planner({ tenantId, view }: { tenantId: string; view: "queue" | "calendar" }) {
  const t = useTranslations("SocialPublish.planner"), status = useTranslations("SocialPublish.status"), reason = useReason(), locale = useLocale();
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const data = useSocialData(tenantId), api = useMemo(() => socialApi(tenantId), [tenantId]);
  const zone = useMemo(() => browserTimeZone(), []), wide = useMediaQuery("(min-width: 1280px)");
  const mode = params.get("mode") === "week" ? "week" : "month", schedule = params.get("schedule") ?? "";
  const account = params.get("account") ?? "", platform = params.get("platform") ?? "", statusFilter = params.get("status") ?? "";
  const [now] = useState(() => new Date());
  const month = parseMonth(params.get("month") ?? undefined, now);
  const weekStart = startOfWeek(params.get("week") ? parseISO(params.get("week")!) : now, { weekStartsOn: 1 });
  const [items, setItems] = useState<PlannerItem[] | null>(null), [failed, setFailed] = useState(false), [reloadKey, setReloadKey] = useState(0);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null), [detail, setDetail] = useState<PlannerItem | null>(null), [action, setAction] = useState<Action | null>(null);
  const [manageOpen, setManageOpen] = useState(false), [draftsOpen, setDraftsOpen] = useState(false), [busyDraft, setBusyDraft] = useState<string | null>(null);
  const setParam = useCallback((patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString()); next.set("view", view);
    for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
    router.replace(`${pathname}?${next}`);
  }, [params, pathname, router, view]);
  const refresh = useCallback(() => { setReloadKey((value) => value + 1); data.reload(); }, [data]);
  const describe = useCallback((cause: unknown) => {
    if (cause instanceof SocialApiError) {
      if (cause.unavailable) return t("unavailable");
      if (cause.conflict) return t("changed");
      const destinations = cause.details.destinations as { errors: string[] }[] | undefined;
      return reason(destinations?.[0]?.errors[0] ?? cause.code ?? "UNKNOWN");
    }
    return t("failed");
  }, [reason, t]);

  // Range: the visible grid for Calendar, the next year for Queue.
  const range = useMemo(() => {
    if (view === "queue") return { from: new Date(), to: addDays(new Date(), 365) };
    if (mode === "week") return { from: weekStart, to: addDays(weekStart, 7) };
    return { from: startOfWeek(startOfMonth(month), { weekStartsOn: 0 }), to: addDays(endOfWeek(endOfMonth(month), { weekStartsOn: 0 }), 1) };
  }, [view, mode, weekStart, month]);
  const rangeKey = `${range.from.toISOString()}|${range.to.toISOString()}`;
  useEffect(() => {
    if (data.state !== "ready") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const collected: PlannerItem[] = [];
        if (view === "queue" && schedule) {
          let next: string | null = null;
          do { const page: Awaited<ReturnType<typeof api.queue>> = await api.queue(schedule, controller.signal); collected.push(...page.queue); next = null; } while (next);
        } else {
          const kinds = view === "queue" ? ["queued", "scheduled"] : [statusFilter];
          for (const kind of kinds) {
            let cursor = ""; let pages = 0;
            do {
              const query: Record<string, string> = { from: range.from.toISOString(), to: range.to.toISOString(), timezone: zone, limit: "100", ...(kind ? { status: kind } : {}), ...(account ? { connectionId: account } : {}), ...(platform ? { platform } : {}), ...(cursor ? { cursor } : {}) };
              const page = await api.planner(query, controller.signal); collected.push(...Object.values(page.days).flat()); cursor = page.nextCursor ?? ""; pages++;
            } while (cursor && pages < 5);
          }
        }
        if (controller.signal.aborted) return;
        setItems(collected.filter((item) => item.status !== "draft").sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))); setFailed(false);
      } catch { if (!controller.signal.aborted) setFailed(true); }
    })();
    return () => controller.abort();
  // The range is compared by value (rangeKey).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, data.state, view, schedule, rangeKey, zone, account, platform, statusFilter, reloadKey]);

  const nav = <SocialNav tenantId={tenantId} active={view} schedules={data.schedules} schedule={schedule} onSchedule={(id) => setParam({ schedule: id })} onManage={() => setManageOpen(true)} draftCount={data.drafts.length} onDrafts={() => setDraftsOpen(true)} />;
  const connectionName = (item: PlannerItem) => { const connection = data.connections.find((entry) => entry.id === item.connectionId); return connection?.displayName ?? (item.platform ? platformLabels[item.platform] : ""); };
  const toEvent = (item: PlannerItem): CalendarEvent => ({ id: item.id, title: item.summary || t("noText"), start: new Date(item.at), end: new Date(new Date(item.at).getTime() + 30 * 60_000), status: item.status === "cancelled" ? "cancelled" : "published", ended: item.status === "published" });
  const events = useMemo(() => (items ?? []).map(toEvent), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map((items ?? []).map((item) => [item.id, item])), [items]);
  const chip = (event: CalendarEvent) => { const item = byId.get(event.id); if (!item) return null;
    return <><span aria-hidden="true" className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold", item.status === "failed" ? "bg-destructive text-destructive-foreground" : "bg-selected")}>{item.platform ? platformMonograms[item.platform] : ""}</span>
      <span className="truncate max-sm:sr-only"><span className="opacity-70">{formatClock(item.at, zone, locale)} </span>{event.title}</span>
      <span className="sr-only">{joinParts([item.platform ? platformLabels[item.platform] : "", status(item.status), formatClock(item.at, zone, locale)], ", ")}</span></>; };

  // Actions ---------------------------------------------------------------------------------------------
  const zoneOf = (item: PlannerItem) => item.displayTimezone || zone;
  async function applyMove(item: PlannerItem, target: Target) {
    try { await api.change(item.draftId!, { action: "moveDelivery", version: item.version, deliveryId: item.id, deliveryVersion: item.deliveryVersion, target }); notify.success(t("moved")); refresh(); }
    catch (cause) { if (cause instanceof SocialApiError && cause.conflict) refresh(); throw new Error(describe(cause)); }
  }
  async function applyWhole(items: PlannerItem[], target: Target) {
    const first = items[0];
    try { await api.change(first.draftId!, { action: "move", version: first.version, target }); notify.success(t("moved")); refresh(); }
    catch (cause) { if (cause instanceof SocialApiError && cause.conflict) refresh(); throw new Error(describe(cause)); }
  }
  async function cancelPost(item: PlannerItem) {
    try {
      await api.change(item.draftId!, { action: "cancel", version: item.version });
      const fresh = (await api.draft(item.draftId!)).draft, cancelled = fresh.destinations.filter((delivery) => delivery.status === "cancelled").length, rest = fresh.destinations.length - cancelled;
      // The server cancels only deliveries that are scheduled or failed and have no provider record; others are left alone and shown with their own state.
      notify.info(rest === 0 ? t("cancelledAll") : t("cancelledSome", { cancelled, total: fresh.destinations.length, rest })); refresh();
    } catch (cause) { if (cause instanceof SocialApiError && cause.conflict) refresh(); throw new Error(describe(cause)); }
  }
  async function duplicate(draftId: string, version: number) {
    try { const copy = await api.change(draftId, { action: "duplicate", version }); router.push(`/workspaces/${tenantId}/social/compose?draft=${copy.draft.id}`); }
    catch (cause) { notify.error(describe(cause)); }
  }
  async function place(draft: { id: string; version: number }, target: Target) {
    try { await api.change(draft.id, { action: "schedule", version: draft.version, target }); notify.success(t("scheduled")); refresh(); }
    catch (cause) { throw new Error(describe(cause)); }
  }
  async function retry(draft: DraftView, deliveryId: string, version: number) {
    try { await api.change(draft.id, { action: "retry", version: draft.version, deliveries: [{ id: deliveryId, version }] }); notify.success(t("retried")); refresh(); }
    catch (cause) { notify.error(describe(cause)); }
  }
  async function duplicateDraftSummary(summary: DraftSummary) { setBusyDraft(summary.id); await duplicate(summary.id, summary.version); setBusyDraft(null); }

  const handleDrop = (target: Date, dt: DataTransfer) => {
    const raw = dt.getData("application/x-harvest-draft");
    if (raw) { try { setAction({ kind: "place", draft: JSON.parse(raw) as { id: string; version: number }, iso: target.toISOString() }); } catch { /* ignored: not our drag */ } return; }
    const item = byId.get(dt.getData("application/x-harvest-post"));
    if (item && (item.status === "queued" || item.status === "scheduled")) setAction({ kind: "move", item, iso: target.toISOString() });
    else if (item) notify.info(t("notMovable"));
  };
  const keepTime = (day: Date, from: PlannerItem | undefined, hour?: number) => { const base = from ? new Date(from.at) : new Date(); const next = new Date(day); next.setHours(hour ?? base.getHours(), from ? base.getMinutes() : 0, 0, 0); return next; };
  const dropOnDay = (day: Date, dt: DataTransfer) => handleDrop(dt.getData("application/x-harvest-draft") ? new Date(new Date(day).setHours(9, 0, 0, 0)) : keepTime(day, byId.get(dt.getData("application/x-harvest-post"))), dt);
  const dropOnHour = (day: Date, hour: number, dt: DataTransfer) => handleDrop(keepTime(day, byId.get(dt.getData("application/x-harvest-post")), hour), dt);
  const movable = (item: PlannerItem) => (item.status === "queued" || item.status === "scheduled") && item.draftId !== null;

  // Rendering --------------------------------------------------------------------------------------------
  if (data.state === "loading") return <div className="space-y-4" aria-busy="true"><Skeleton className="h-11 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (data.state === "unavailable") return <div className="space-y-4">{nav}<EmptyState icon={ShieldAlert} title={t("unavailableTitle")} description={t("unavailable")} solid /></div>;
  if (data.state === "error") return <div className="space-y-4">{nav}<Alert variant="destructive" role="alert"><AlertDescription>{t("loadFailed")} <Button type="button" variant="link" onClick={data.reload}>{t("retry")}</Button></AlertDescription></Alert></div>;

  const filters = view === "calendar" && <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("filters")}>
    <div role="group" aria-label={t("viewMode")} className="inline-flex rounded-lg bg-muted p-[3px]">
      {(["month", "week"] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setParam({ mode: value })}
        className={cn("inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-9", mode === value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t(value)}</button>)}
    </div>
    <NativeSelect aria-label={t("account")} value={account} onChange={(event) => setParam({ account: event.target.value })} className="min-h-11 w-auto min-w-36 lg:min-h-9">
      <NativeSelectOption value="">{t("allAccounts")}</NativeSelectOption>{data.connections.map((connection) => <NativeSelectOption key={connection.id} value={connection.id}>{connection.displayName ?? platformLabels[connection.platform]}</NativeSelectOption>)}</NativeSelect>
    <NativeSelect aria-label={t("platform")} value={platform} onChange={(event) => setParam({ platform: event.target.value })} className="min-h-11 w-auto min-w-36 lg:min-h-9">
      <NativeSelectOption value="">{t("allPlatforms")}</NativeSelectOption>{socialPlatforms.filter((value) => data.connections.some((connection) => connection.platform === value)).map((value) => <NativeSelectOption key={value} value={value}>{platformLabels[value]}</NativeSelectOption>)}</NativeSelect>
    <NativeSelect aria-label={t("statusLabel")} value={statusFilter} onChange={(event) => setParam({ status: event.target.value })} className="min-h-11 w-auto min-w-36 lg:min-h-9">
      <NativeSelectOption value="">{t("allStatuses")}</NativeSelectOption>{statuses.map((value) => <NativeSelectOption key={value} value={value}>{status(value)}</NativeSelectOption>)}</NativeSelect>
  </div>;
  const href = (patch: Record<string, string>) => { const next = new URLSearchParams(params.toString()); next.set("view", "calendar"); for (const [key, value] of Object.entries(patch)) next.set(key, value); return `${pathname}?${next}`; };
  const dayItems = selectedDay ? (items ?? []).filter((item) => isSameDay(new Date(item.at), selectedDay)) : [];
  const row = (item: PlannerItem) => <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3" data-testid="planner-row" data-status={item.status}>
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.summary || t("noText")}</p><p className="truncate text-xs text-muted-foreground">{joinParts([item.platform ? platformLabels[item.platform] : "", connectionName(item), formatWhen(item.at, zoneOf(item), locale)])}</p></div>
    <StatusBadge tone={deliveryTone(item.status)} label={status(item.status)} dot /><Button type="button" variant="outline" size="responsive" onClick={() => setDetail(item)}>{t("open")}</Button></li>;
  const drafts = <DraftsPanel tenantId={tenantId} drafts={data.drafts} connections={data.connections} draggable onSchedule={(draft) => setAction({ kind: "scheduleDraft", draft })} onDuplicate={(draft) => void duplicateDraftSummary(draft)} busyId={busyDraft} />;

  // Queue groups: one row per post, each destination with its own status.
  const groups = (() => { const map = new Map<string, PlannerItem[]>(); for (const item of items ?? []) { const key = item.draftId ?? item.id; map.set(`${key}|${item.at}`, [...(map.get(`${key}|${item.at}`) ?? []), item]); } return [...map.values()]; })();
  const body = view === "queue" ? (items === null && !failed ? <Skeleton className="h-40 w-full" /> : failed ? <Alert variant="destructive" role="alert"><AlertDescription>{t("loadFailed")}</AlertDescription></Alert>
    : groups.length === 0 ? <EmptyState icon={ListOrdered} title={t("queueEmpty")} solid /> : <ol className="m-0 list-none space-y-2 p-0" aria-label={t("queueLabel")} data-testid="queue-list">
      {groups.map((group) => { const first = group[0], whole = group.every(movable);
        return <li key={`${first.id}`} className="space-y-3 rounded-xl border bg-card p-4" data-testid="queue-item">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="line-clamp-2 text-sm font-medium">{first.summary || t("noText")}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><CalendarClock className="size-3.5" aria-hidden="true" />{joinParts([formatWhen(first.at, zoneOf(first), locale), zoneOf(first)])}</p></div></div>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={t("destinations")}>{group.map((item) => <li key={item.id} className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs" data-delivery-status={item.status}>
            <span className="font-medium">{item.platform ? platformLabels[item.platform] : ""}</span><span className="text-muted-foreground">{connectionName(item)}</span><StatusBadge tone={deliveryTone(item.status)} label={status(item.status)} dot /></li>)}</ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="responsive" disabled={!whole} onClick={() => setAction({ kind: "reschedule", items: group, whole: true })}><CalendarClock aria-hidden="true" />{t("reschedule")}</Button>
            <Button type="button" variant="outline" size="responsive" disabled={!first.draftId} onClick={() => void duplicate(first.draftId!, first.version)}><Copy aria-hidden="true" />{t("duplicate")}</Button>
            <Button type="button" variant="outline" size="responsive" disabled={!first.draftId} onClick={() => setAction({ kind: "cancel", item: first })}><XCircle aria-hidden="true" />{t("cancel")}</Button>
            <Button type="button" variant="ghost" size="responsive" onClick={() => setDetail(first)}>{t("details")}</Button>
          </div></li>; })}</ol>)
    : <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-4">
        {failed && <Alert variant="destructive" role="alert"><AlertDescription>{t("loadFailed")}</AlertDescription></Alert>}
        {mode === "month" ? <><MonthCalendar currentDate={month} events={events} selectedDay={selectedDay} onDaySelect={setSelectedDay} monthHref={(value) => href({ mode: "month", month: value })} namespace="SocialPublish.planner" renderChip={chip} onDropOnDay={dropOnDay} />
          <section aria-live="polite" aria-labelledby="planner-day" className="space-y-2"><h2 id="planner-day" className="text-sm font-medium text-muted-foreground">{selectedDay ? format(selectedDay, "EEEE, MMMM d") : t("selectDay")}</h2>
            {selectedDay && (dayItems.length === 0 ? <p className="text-sm text-muted-foreground">{t("emptyDay")}</p> : <ul className="m-0 list-none space-y-2 p-0">{dayItems.map(row)}</ul>)}</section></>
          : <WeekCalendar weekStart={weekStart} events={events} weekHref={(value) => href({ mode: "week", week: value })} renderChip={chip} onSelect={(event) => { const item = byId.get(event.id); if (item) setDetail(item); }} onDropOnHour={dropOnHour} />}
      </div>
      {wide && <aside aria-label={t("draftsTitle")} className="min-w-0 space-y-2"><h2 className="text-sm font-semibold">{t("draftsTitle")}</h2>{drafts}</aside>}
    </div>;

  const moveText = action?.kind === "move" || action?.kind === "place" ? formatWhen(action.iso, zone, locale) : "";
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><h1 className="text-[28px] font-semibold tracking-tight">{view === "queue" ? t("queueTitle") : t("calendarTitle")}</h1>
      <Button asChild size="responsive"><Link href={`/workspaces/${tenantId}/social/compose`} prefetch={false}><CalendarPlus aria-hidden="true" />{t("newPost")}</Link></Button></div>
    {nav}{filters}{body}
    <Sheet open={draftsOpen && !wide} onOpenChange={setDraftsOpen}><SheetContent className="w-full overflow-y-auto sm:max-w-md" aria-describedby={undefined}><SheetHeader><SheetTitle>{t("draftsTitle")}</SheetTitle></SheetHeader><div className="p-4 pt-0">{drafts}</div></SheetContent></Sheet>
    <ScheduleManager tenantId={tenantId} open={manageOpen} onOpenChange={setManageOpen} schedules={data.schedules} onChanged={data.reload} />
    <PostDialog key={detail?.id} tenantId={tenantId} item={detail} onClose={() => setDetail(null)} connections={data.connections} zone={zone}
      onReschedule={(item) => { setDetail(null); setAction({ kind: "reschedule", items: [item], whole: false }); }} onCancel={(item) => { setDetail(null); setAction({ kind: "cancel", item }); }}
      onDuplicate={(item) => { setDetail(null); void duplicate(item.draftId!, item.version); }} onRetry={(draft, deliveryId, version) => void retry(draft, deliveryId, version)} />
    {action?.kind === "reschedule" && <ScheduleDialog open onOpenChange={(open) => { if (!open) setAction(null); }} title={t("rescheduleTitle")} confirmLabel={t("moveConfirm")} schedules={data.schedules} scheduleId={schedule || undefined}
      initialIso={action.items[0].at} initialZone={zoneOf(action.items[0])} onConfirm={(target) => action.whole ? applyWhole(action.items, target) : applyMove(action.items[0], target)} />}
    {action?.kind === "scheduleDraft" && <ScheduleDialog open onOpenChange={(open) => { if (!open) setAction(null); }} title={t("scheduleDraftTitle")} confirmLabel={t("scheduleConfirm")} schedules={data.schedules} scheduleId={schedule || undefined}
      onConfirm={(target) => place({ id: action.draft.id, version: action.draft.version }, target)} />}
    <ConfirmDialog open={action?.kind === "cancel"} onOpenChange={(open) => { if (!open) setAction(null); }} tone="destructive" title={t("cancelTitle")} description={t("cancelBody")} confirmLabel={t("cancelConfirm")} cancelLabel={t("keep")}
      onConfirm={async () => { if (action?.kind === "cancel") await cancelPost(action.item); }} />
    <ConfirmDialog open={action?.kind === "move" || action?.kind === "place"} onOpenChange={(open) => { if (!open) setAction(null); }} tone="neutral" title={action?.kind === "place" ? t("placeTitle") : t("moveTitle")} description={action?.kind === "place" ? t("placeBody", { time: moveText }) : t("moveBody", { time: moveText })}
      confirmLabel={action?.kind === "place" ? t("scheduleConfirm") : t("moveConfirm")} cancelLabel={t("keep")}
      onConfirm={async () => { if (action?.kind === "move") await applyMove(action.item, { kind: "time", scheduledFor: action.iso, timezone: zone }); else if (action?.kind === "place") await place(action.draft, { kind: "time", scheduledFor: action.iso, timezone: zone }); }} />
  </div>;
}

/** One post's dialog: the text, every destination with its own result (and a retry for the failed ones that can be retried), and the actions. */
function PostDialog({ tenantId, item, onClose, connections, zone, onReschedule, onCancel, onDuplicate, onRetry }: {
  tenantId: string; item: PlannerItem | null; onClose: () => void; connections: Parameters<typeof DeliveryResults>[0]["connections"]; zone: string;
  onReschedule: (item: PlannerItem) => void; onCancel: (item: PlannerItem) => void; onDuplicate: (item: PlannerItem) => void; onRetry: (draft: DraftView, deliveryId: string, version: number) => void;
}) {
  const t = useTranslations("SocialPublish.planner"), locale = useLocale(), api = useMemo(() => socialApi(tenantId), [tenantId]);
  const [draft, setDraft] = useState<DraftView | null>(null), id = useRef<string | null>(null);
  useEffect(() => {
    if (!item?.draftId) return;
    id.current = item.draftId;
    void api.draft(item.draftId).then(({ draft: fresh }) => { if (id.current === fresh.id) setDraft(fresh); }).catch(() => undefined);
  }, [api, item]);
  if (!item) return null;
  const canMove = (item.status === "queued" || item.status === "scheduled") && item.draftId !== null, canCancel = item.draftId !== null && ["queued", "scheduled", "failed"].includes(item.status);
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto" data-testid="post-dialog">
      <DialogHeader><DialogTitle>{t("postTitle")}</DialogTitle><DialogDescription>{joinParts([formatWhen(item.at, item.displayTimezone || zone, locale), item.displayTimezone || zone])}</DialogDescription></DialogHeader>
      <p className="whitespace-pre-wrap break-words text-sm">{draft?.document.content || item.summary || t("noText")}</p>
      {draft ? <DeliveryResults deliveries={draft.destinations} connections={connections} onRetry={(delivery) => onRetry(draft, delivery.id, delivery.version)} /> : <Skeleton className="h-16 w-full" />}
      <DialogFooter className="gap-2 sm:gap-2">
        {canMove && <Button type="button" variant="outline" size="responsive" onClick={() => onReschedule(item)}><CalendarClock aria-hidden="true" />{t("moveThis")}</Button>}
        {item.draftId && <Button type="button" variant="outline" size="responsive" onClick={() => onDuplicate(item)}><Copy aria-hidden="true" />{t("duplicate")}</Button>}
        {canCancel && <Button type="button" variant="outline" size="responsive" onClick={() => onCancel(item)}><XCircle aria-hidden="true" />{t("cancel")}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
