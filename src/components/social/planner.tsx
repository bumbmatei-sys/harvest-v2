"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { CalendarClock, ChevronLeft, ChevronRight, Copy, Pencil, Plus, RotateCw, ShieldAlert, XCircle } from "lucide-react";
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
import { PlatformLogo } from "@/components/social/platform-logo";
import { ScheduleDialog } from "@/components/social/schedule-dialog";
import { ScheduleManager } from "@/components/social/schedule-manager";
import { SocialHeader, SocialToolbar } from "@/components/social/social-nav";
import { useReason } from "@/components/social/use-reason";
import { useSocialData } from "@/components/social/use-social-data";
import { WeekView } from "@/components/social/week-calendar";
import { useMediaQuery } from "@/hooks/use-media-query";
import { socialApi, SocialApiError, type DraftSummary, type DraftView, type PlannerItem, type Target } from "@/lib/social/api";
import { parseMonth, type CalendarEvent } from "@/lib/event-view";
import { joinParts } from "@/lib/social/join";
import { platformLabels } from "@/lib/social/labels";
import { socialPlatforms } from "@/lib/social/platforms";
import { browserTimeZone, formatClock, formatWhen } from "@/lib/social/time";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";

const statuses = ["queued", "scheduled", "publishing", "published", "failed", "cancelled", "unknown"] as const;
type Action = { kind: "reschedule"; items: PlannerItem[]; whole: boolean } | { kind: "cancel"; item: PlannerItem } | { kind: "move"; item: PlannerItem; iso: string } | { kind: "place"; draft: { id: string; version: number }; iso: string } | { kind: "scheduleDraft"; draft: DraftSummary };
const dayMs = 86_400_000;

/** Queue (Drafts, Scheduled by day, Sent) and Calendar (week or month, with the drafts aside) over one set of actions: move, cancel, duplicate and per-destination retry. */
export function Planner({ tenantId, view }: { tenantId: string; view: "queue" | "calendar" }) {
  const t = useTranslations("SocialPublish.planner"), status = useTranslations("SocialPublish.status"), reason = useReason(), locale = useLocale();
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const data = useSocialData(tenantId), api = useMemo(() => socialApi(tenantId), [tenantId]);
  const zone = useMemo(() => browserTimeZone(), []), wide = useMediaQuery("(min-width: 1280px)");
  const mode = params.get("mode") === "month" ? "month" : "week", schedule = params.get("schedule") ?? "";
  const account = params.get("account") ?? "", platform = params.get("platform") ?? "", statusFilter = params.get("status") ?? "";
  const [now] = useState(() => new Date());
  const month = parseMonth(params.get("month") ?? undefined, now);
  const weekStart = startOfWeek(params.get("week") ? parseISO(params.get("week")!) : now, { weekStartsOn: 1 });
  const [items, setItems] = useState<PlannerItem[] | null>(null), [failed, setFailed] = useState(false), [reloadKey, setReloadKey] = useState(0);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null), [detail, setDetail] = useState<PlannerItem | null>(null), [action, setAction] = useState<Action | null>(null);
  const [manageOpen, setManageOpen] = useState(false), [draftsOpen, setDraftsOpen] = useState(false), [busyDraft, setBusyDraft] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null), weekScroll = useRef<HTMLDivElement>(null);
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

  // Range: the visible grid for Calendar; two months back and ten ahead for Queue (the server allows a year).
  const range = useMemo(() => {
    if (view === "queue") return { from: addDays(new Date(), -60), to: addDays(new Date(), 300) };
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
        const kinds = view === "queue" ? ["queued", "scheduled", "published", "failed", "unknown"] : [statusFilter];
        for (const kind of kinds) {
          let cursor = ""; let pages = 0;
          do {
            const query: Record<string, string> = { from: range.from.toISOString(), to: range.to.toISOString(), timezone: zone, limit: "100", ...(kind ? { status: kind } : {}), ...(account ? { connectionId: account } : {}), ...(platform ? { platform } : {}), ...(cursor ? { cursor } : {}) };
            const page = await api.planner(query, controller.signal); collected.push(...Object.values(page.days).flat()); cursor = page.nextCursor ?? ""; pages++;
          } while (cursor && pages < 5);
        }
        if (controller.signal.aborted) return;
        setItems(collected.filter((item) => item.status !== "draft").sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))); setFailed(false);
      } catch { if (!controller.signal.aborted) setFailed(true); }
    })();
    return () => controller.abort();
  // The range is compared by value (rangeKey).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, data.state, view, rangeKey, zone, account, platform, statusFilter, reloadKey]);

  useEffect(() => {
    // Open the week at its first post (or 7 AM), not at midnight.
    if (view !== "calendar" || mode !== "week" || !weekScroll.current || items === null) return;
    const first = Math.min(...items.filter((item) => item.status !== "draft").map((item) => new Date(item.at)).filter((date) => date >= weekStart && date < addDays(weekStart, 7)).map((date) => date.getHours()), 8);
    weekScroll.current.scrollTop = Math.max(0, first - 1) * 64;
  // Runs when the loaded posts or the week change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, view, mode, params.get("week")]);
  const visible = useMemo(() => (items ?? []).filter((item) => !schedule || item.scheduleId === schedule), [items, schedule]);
  const toolbarProps = { schedules: data.schedules, schedule, onSchedule: (id: string) => setParam({ schedule: id }), onManage: () => setManageOpen(true), draftCount: data.drafts.length, onDrafts: () => setDraftsOpen(true) };
  const connectionName = (item: PlannerItem) => { const connection = data.connections.find((entry) => entry.id === item.connectionId); return connection?.displayName ?? (item.platform ? platformLabels[item.platform] : ""); };
  const toEvent = (item: PlannerItem): CalendarEvent => ({ id: item.id, title: item.summary || t("noText"), start: new Date(item.at), end: new Date(new Date(item.at).getTime() + 60 * 60_000), status: item.status === "cancelled" ? "cancelled" : "published", ended: item.status === "published" });
  const events = useMemo(() => visible.map(toEvent), [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(visible.map((item) => [item.id, item])), [visible]);
  const logo = (item: PlannerItem) => item.platform ? <PlatformLogo platform={item.platform} className={cn("size-3.5 shrink-0", item.status === "failed" && "text-destructive")} /> : null;
  const monthChip = (event: CalendarEvent) => { const item = byId.get(event.id); if (!item) return null;
    return <>{logo(item)}<span className="truncate max-sm:sr-only"><span className="opacity-70">{formatClock(item.at, zone, locale)} </span>{event.title}</span>
      <span className="sr-only">{joinParts([item.platform ? platformLabels[item.platform] : "", status(item.status), formatClock(item.at, zone, locale)], ", ")}</span></>; };
  const weekChip = (event: CalendarEvent) => { const item = byId.get(event.id); if (!item) return null;
    return <><span className="flex items-center gap-1 text-[11px] text-muted-foreground">{logo(item)}<span className="truncate">{formatClock(item.at, zone, locale)}</span>{item.status === "failed" && <span className="font-medium text-destructive max-sm:sr-only">{status("failed")}</span>}</span>
      <span className="line-clamp-2 break-words max-sm:sr-only">{event.title}</span>
      <span className="sr-only">{joinParts([item.platform ? platformLabels[item.platform] : "", status(item.status), event.title], ", ")}</span></>; };

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
    try { await api.change(draft.id, { action: "schedule", version: draft.version, target }); notify.success(t("draftScheduled")); refresh(); }
    catch (cause) { throw new Error(describe(cause)); }
  }
  async function retry(draft: DraftView, deliveryId: string, version: number) {
    try { await api.change(draft.id, { action: "retry", version: draft.version, deliveries: [{ id: deliveryId, version }] }); notify.success(t("retried")); refresh(); }
    catch (cause) { notify.error(describe(cause)); }
  }
  async function duplicateDraftSummary(summary: DraftSummary) { setBusyDraft(summary.id); await duplicate(summary.id, summary.version); setBusyDraft(null); }

  async function retryItem(item: PlannerItem) {
    if (!item.draftId) return; setRetrying(item.id);
    try { const fresh = (await api.draft(item.draftId)).draft; const delivery = fresh.destinations.find((entry) => entry.id === item.id);
      if (delivery) await api.change(fresh.id, { action: "retry", version: fresh.version, deliveries: [{ id: delivery.id, version: delivery.version }] }); notify.success(t("retried")); refresh(); }
    catch (cause) { notify.error(describe(cause)); } finally { setRetrying(null); }
  }
  const dropAt = (day: Date, time: number, dt: DataTransfer) => { const target = new Date(day); target.setHours(Math.floor(time), Math.round((time % 1) * 60), 0, 0); handleDrop(target, dt); };
  const handleDrop = (target: Date, dt: DataTransfer) => {
    const raw = dt.getData("application/x-harvest-draft");
    if (raw) { try { setAction({ kind: "place", draft: JSON.parse(raw) as { id: string; version: number }, iso: target.toISOString() }); } catch { /* ignored: not our drag */ } return; }
    const item = byId.get(dt.getData("application/x-harvest-post"));
    if (item && (item.status === "queued" || item.status === "scheduled")) setAction({ kind: "move", item, iso: target.toISOString() });
    else if (item) notify.info(t("notMovable"));
  };
  const keepTime = (day: Date, from: PlannerItem | undefined, hour?: number) => { const base = from ? new Date(from.at) : new Date(); const next = new Date(day); next.setHours(hour ?? base.getHours(), from ? base.getMinutes() : 0, 0, 0); return next; };
  const dropOnDay = (day: Date, dt: DataTransfer) => handleDrop(dt.getData("application/x-harvest-draft") ? new Date(new Date(day).setHours(9, 0, 0, 0)) : keepTime(day, byId.get(dt.getData("application/x-harvest-post"))), dt);


  // Rendering --------------------------------------------------------------------------------------------
  const header = (active: "calendar" | "queue") => <SocialHeader tenantId={tenantId} active={active} zone={zone} />;
  if (data.state === "loading") return <div className="space-y-4" aria-busy="true"><Skeleton className="h-16 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (data.state === "unavailable") return <div className="space-y-4">{header(view)}<EmptyState icon={ShieldAlert} title={t("unavailableTitle")} description={t("unavailable")} solid /></div>;
  if (data.state === "error") return <div className="space-y-4">{header(view)}<Alert variant="destructive" role="alert"><AlertDescription>{t("loadFailed")} <Button type="button" variant="link" onClick={data.reload}>{t("retry")}</Button></AlertDescription></Alert></div>;

  const newPost = <Button asChild size="responsive"><Link href={`/workspaces/${tenantId}/social/compose`} prefetch={false}><Plus aria-hidden="true" />{t("newPost")}</Link></Button>;
  const href = (patch: Record<string, string>) => { const next = new URLSearchParams(params.toString()); next.set("view", "calendar"); for (const [key, value] of Object.entries(patch)) next.set(key, value); return `${pathname}?${next}`; };
  const drafts = <DraftsPanel tenantId={tenantId} drafts={data.drafts} connections={data.connections} draggable onSchedule={(draft) => setAction({ kind: "scheduleDraft", draft })} onDuplicate={(draft) => void duplicateDraftSummary(draft)} busyId={busyDraft} />;
  const draftsSheet = <Sheet open={draftsOpen && (view === "queue" || !wide)} onOpenChange={setDraftsOpen}><SheetContent className="w-full overflow-y-auto sm:max-w-md" aria-describedby={undefined}><SheetHeader><SheetTitle>{t("draftsTitle")}</SheetTitle></SheetHeader><div className="p-4 pt-0">{drafts}</div></SheetContent></Sheet>;

  const lineOf = (item: PlannerItem) => joinParts([item.platform ? platformLabels[item.platform] : "", connectionName(item)]);
  const logos = (group: PlannerItem[]) => <span className="inline-flex items-center gap-1.5">{group.map((item) => <span key={item.id} className="inline-flex" title={lineOf(item)}>{logo(item)}<span className="sr-only">{lineOf(item)}</span></span>)}</span>;
  const dayLabel = (iso: string) => { const date = new Date(iso); const diff = Math.round((new Date(format(date, "yyyy-MM-dd")).getTime() - new Date(format(now, "yyyy-MM-dd")).getTime()) / dayMs);
    return { key: format(date, "yyyy-MM-dd"), title: diff === 0 ? t("today") : diff === 1 ? t("tomorrow") : new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date), date: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date) }; };
  const group = (list: PlannerItem[]) => { const map = new Map<string, PlannerItem[]>(); for (const item of list) { const key = `${item.draftId ?? item.id}|${item.at}`; map.set(key, [...(map.get(key) ?? []), item]); } return [...map.values()]; };
  const upcoming = group(visible.filter((item) => item.status === "queued" || item.status === "scheduled" || item.status === "publishing")), attention = group(visible.filter((item) => item.status === "failed" || item.status === "unknown"));
  const sent = group(visible.filter((item) => item.status === "published")).reverse();
  const days = new Map<string, { title: string; date: string; groups: PlannerItem[][] }>();
  for (const entry of upcoming) { const label = dayLabel(entry[0].at); const day = days.get(label.key) ?? { title: label.title, date: label.date, groups: [] }; day.groups.push(entry); days.set(label.key, day); }
  const card = (entry: PlannerItem[], kind: "scheduled" | "sent" | "attention") => { const first = entry[0], mixed = entry.some((item) => item.status !== entry[0].status) || kind === "attention" || entry.length > 1;
    return <article key={`${first.id}-${kind}`} className="space-y-2 rounded-lg border bg-card p-3" data-testid={kind === "sent" ? "sent-item" : "queue-item"} data-queue-kind={kind}>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{kind === "sent" && <StatusBadge tone="success" label={status("published")} />}<span className="font-semibold text-foreground">{kind === "sent" ? formatWhen(first.at, zoneOf(first), locale) : formatClock(first.at, zoneOf(first), locale)}</span>{logos(entry)}</p>
      <p className="line-clamp-3 break-words text-sm">{first.summary || t("noText")}</p>
      {mixed && <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0" aria-label={t("destinations")}>{entry.map((item) => <li key={item.id} className="flex items-center gap-1.5 text-xs" data-delivery-status={item.status}>
        {logo(item)}<span className="sr-only">{lineOf(item)}</span><StatusBadge tone={deliveryTone(item.status)} label={status(item.status)} dot />
        {item.status === "failed" && item.lastErrorCode && <span className="text-destructive">{reason(item.lastErrorCode)}</span>}
        {item.retryable && item.draftId && <Button type="button" variant="ghost" size="xs" className="min-h-11 lg:min-h-6" disabled={retrying === item.id} onClick={() => void retryItem(item)}><RotateCw aria-hidden="true" />{t("retry")}</Button>}</li>)}</ul>}
      {kind !== "sent" && <div className="flex items-center gap-1 border-t pt-2" data-testid="queue-actions">
        <Button type="button" variant="outline" size="responsive" className="mr-auto" onClick={() => setDetail(first)}><Pencil aria-hidden="true" />{t("edit")}</Button>
        {entry.every((item) => item.status === "queued" || item.status === "scheduled") && <Button type="button" variant="ghost" size="icon-responsive" title={t("reschedule")} aria-label={t("reschedule")} onClick={() => setAction({ kind: "reschedule", items: entry, whole: true })}><CalendarClock aria-hidden="true" /></Button>}
        <Button type="button" variant="ghost" size="icon-responsive" title={t("duplicate")} aria-label={t("duplicate")} disabled={!first.draftId} onClick={() => void duplicate(first.draftId!, first.version)}><Copy aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="icon-responsive" className="text-muted-foreground hover:text-destructive" title={t("cancel")} aria-label={t("cancel")} disabled={!first.draftId} onClick={() => setAction({ kind: "cancel", item: first })}><XCircle aria-hidden="true" /></Button>
      </div>}
    </article>; };
  const column = (id: string, title: string, count: number, body: React.ReactNode, aside?: string) => <section data-queue-column={id} aria-labelledby={`col-${id}`} className="flex min-w-0 flex-col rounded-xl border bg-muted/30">
    <header className="flex items-center gap-2 border-b px-4 py-3"><h2 id={`col-${id}`} className="text-sm font-semibold">{title}</h2><span className="text-xs text-muted-foreground">{count}</span>{aside && <span className="ml-auto text-xs text-muted-foreground">{aside}</span>}</header>
    <div className="flex max-h-[40rem] min-h-40 flex-col gap-2 overflow-y-auto p-3">{body}</div></section>;
  const none = (text: string) => <p className="px-1 py-6 text-center text-sm text-muted-foreground">{text}</p>;
  const zoneName = (zone.split("/").pop() ?? zone).replace(/_/g, " ");
  const queueBody = items === null && !failed ? <Skeleton className="h-64 w-full" /> : failed ? <Alert variant="destructive" role="alert"><AlertDescription>{t("loadFailed")}</AlertDescription></Alert>
    : <div className="grid min-w-0 gap-3 lg:grid-cols-3" data-testid="queue-list">
      {column("drafts", t("draftsTitle"), data.drafts.length, data.drafts.length === 0 ? none(t("nothingDrafts")) : <DraftsPanel tenantId={tenantId} drafts={data.drafts} connections={data.connections} onSchedule={(draft) => setAction({ kind: "scheduleDraft", draft })} onDuplicate={(draft) => void duplicateDraftSummary(draft)} busyId={busyDraft} />)}
      {column("scheduled", t("scheduled"), upcoming.length, <>
        {attention.length > 0 && <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2" data-testid="attention"><h3 className="px-1 text-sm font-semibold text-destructive">{t("attention", { count: attention.length })}</h3>{attention.map((entry) => card(entry, "attention"))}</div>}
        {upcoming.length === 0 ? none(t("nothingScheduled")) : [...days.entries()].map(([key, day]) => <div key={key} data-queue-day={key} className="space-y-2"><h3 className="px-1 pt-1 text-sm font-semibold">{day.title} <span className="font-normal text-muted-foreground">{day.date}</span></h3>{day.groups.map((entry) => card(entry, "scheduled"))}</div>)}</>, zoneName)}
      {column("sent", t("sent"), sent.length, sent.length === 0 ? none(t("nothingSent")) : sent.map((entry) => card(entry, "sent")))}
    </div>;

  const dayItems = selectedDay ? visible.filter((item) => isSameDay(new Date(item.at), selectedDay)) : [];
  const row = (item: PlannerItem) => <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3" data-testid="planner-row" data-status={item.status}>
    <div className="flex min-w-0 flex-1 items-center gap-2">{logo(item)}<div className="min-w-0"><p className="truncate text-sm font-medium">{item.summary || t("noText")}</p><p className="truncate text-xs text-muted-foreground">{joinParts([lineOf(item), formatWhen(item.at, zoneOf(item), locale)])}</p></div></div>
    <StatusBadge tone={deliveryTone(item.status)} label={status(item.status)} dot /><Button type="button" variant="outline" size="responsive" onClick={() => setDetail(item)}>{t("open")}</Button></li>;
  const title = mode === "week" ? new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(weekStart) : new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(month);
  const prev = mode === "week" ? href({ mode: "week", week: format(addDays(weekStart, -7), "yyyy-MM-dd") }) : href({ mode: "month", month: format(addMonths(month, -1), "yyyy-MM") });
  const next = mode === "week" ? href({ mode: "week", week: format(addDays(weekStart, 7), "yyyy-MM-dd") }) : href({ mode: "month", month: format(addMonths(month, 1), "yyyy-MM") });
  const todayHref = mode === "week" ? href({ mode: "week", week: format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd") }) : href({ mode: "month", month: format(new Date(), "yyyy-MM") });
  const controls = <div className="flex flex-wrap items-center justify-between gap-2" role="group" aria-label={t("filters")}>
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="responsive"><Link href={todayHref} prefetch={false}>{t("today")}</Link></Button>
      <Button asChild variant="ghost" size="icon-responsive"><Link href={prev} prefetch={false} aria-label={mode === "week" ? t("previousWeek") : t("previousMonth")}><ChevronLeft aria-hidden="true" /></Link></Button>
      <Button asChild variant="ghost" size="icon-responsive"><Link href={next} prefetch={false} aria-label={mode === "week" ? t("nextWeek") : t("nextMonth")}><ChevronRight aria-hidden="true" /></Link></Button>
      <h2 className="text-base font-semibold" aria-live="polite" data-testid="calendar-title">{title}</h2>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground" data-testid="calendar-zone">{zoneName}</span>
      <div role="group" aria-label={t("viewMode")} className="inline-flex rounded-lg bg-muted p-[3px]">
        {(["week", "month"] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setParam({ mode: value })}
          className={cn("inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-9", mode === value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t(value)}</button>)}
      </div>
      {newPost}
    </div>
    <div className="flex w-full flex-wrap items-center gap-2">
      <NativeSelect aria-label={t("account")} value={account} onChange={(event) => setParam({ account: event.target.value })} className="min-h-11 w-auto min-w-36 lg:min-h-9">
        <NativeSelectOption value="">{t("allAccounts")}</NativeSelectOption>{data.connections.map((connection) => <NativeSelectOption key={connection.id} value={connection.id}>{connection.displayName ?? platformLabels[connection.platform]}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect aria-label={t("platform")} value={platform} onChange={(event) => setParam({ platform: event.target.value })} className="min-h-11 w-auto min-w-36 lg:min-h-9">
        <NativeSelectOption value="">{t("allPlatforms")}</NativeSelectOption>{socialPlatforms.filter((value) => data.connections.some((connection) => connection.platform === value)).map((value) => <NativeSelectOption key={value} value={value}>{platformLabels[value]}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect aria-label={t("statusLabel")} value={statusFilter} onChange={(event) => setParam({ status: event.target.value })} className="min-h-11 w-auto min-w-36 lg:min-h-9">
        <NativeSelectOption value="">{t("allStatuses")}</NativeSelectOption>{statuses.map((value) => <NativeSelectOption key={value} value={value}>{status(value)}</NativeSelectOption>)}</NativeSelect>
    </div>
  </div>;
  const calendarBody = <div className="space-y-3">{controls}
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-4">
        {failed && <Alert variant="destructive" role="alert"><AlertDescription>{t("loadFailed")}</AlertDescription></Alert>}
        {mode === "month" ? <><MonthCalendar currentDate={month} events={events} selectedDay={selectedDay} onDaySelect={setSelectedDay} monthHref={(value) => href({ mode: "month", month: value })} namespace="SocialPublish.planner" renderChip={monthChip} onDropOnDay={dropOnDay} />
          <section aria-live="polite" aria-labelledby="planner-day" className="space-y-2"><h2 id="planner-day" className="text-sm font-medium text-muted-foreground">{selectedDay ? format(selectedDay, "EEEE, MMMM d") : t("selectDay")}</h2>
            {selectedDay && (dayItems.length === 0 ? <p className="text-sm text-muted-foreground">{t("emptyDay")}</p> : <ul className="m-0 list-none space-y-2 p-0">{dayItems.map(row)}</ul>)}</section></>
          : <div className="overflow-hidden rounded-xl border bg-card"><div ref={weekScroll} tabIndex={0} role="region" aria-label={t("calendarScroll")} className="max-h-[42rem] overflow-y-auto outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"><WeekView currentDate={weekStart} events={events} label={t("weekGrid")} renderChip={weekChip} onEventSelect={(event) => { const item = byId.get(event.id); if (item) setDetail(item); }} onDropAt={dropAt} /></div></div>}
      </div>
      {wide && <aside aria-label={t("draftsTitle")} className="min-w-0 space-y-2 rounded-xl border bg-muted/30 p-3"><h2 className="text-sm font-semibold">{t("draftsTitle")}</h2>{drafts}</aside>}
    </div></div>;

  const moveText = action?.kind === "move" || action?.kind === "place" ? formatWhen(action.iso, zone, locale) : "";
  return <div className="min-w-0 space-y-4">
    {header(view)}
    <SocialToolbar {...toolbarProps}>{view === "queue" && newPost}</SocialToolbar>
    {view === "queue" ? queueBody : calendarBody}
    {draftsSheet}
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
