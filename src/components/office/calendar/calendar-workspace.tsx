/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/calendar/components/event-calendar.tsx (toolbar, view switch, month, week and day views); code written for Harvest, no kit code copied. The grids are the shared derived month, week and agenda components. Harvest notes: docs/ui-sources.md. */
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addDays, format, isValid, parseISO, startOfDay } from "date-fns";
import { ChevronLeft, ChevronRight, Plus, RotateCw, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState } from "@/components/empty-state";
import { MonthCalendar } from "@/components/events/month-calendar";
import { AvailabilityView } from "@/components/office/calendar/availability-view";
import { EventDetail, SocialDetail } from "@/components/office/calendar/event-detail";
import { AgendaView } from "@/components/office/calendar/agenda-view";
import { EventDialog } from "@/components/office/calendar/event-form";
import { CalendarLogo } from "@/components/office/provider-logo";
import { PlatformLogo } from "@/components/social/platform-logo";
import { WeekView } from "@/components/calendar/week-view";
import type { CalendarEvent } from "@/lib/event-view";
import { showMarks, toggleSource, shownSources, type Selection, type Source } from "@/lib/files-screen";
import { calendarEvent, calendarLabel, calendarViews, isSocialId, overlayStatuses, rangeFor, shiftDate, socialEvent, writesAvailable, type CalendarApi, type CalendarItem, type CalendarView, type NamedCalendar } from "@/lib/office/calendar";
import type { Result, Page, OfficeConnection } from "@/lib/office/mail";
import { socialApi, type PlannerItem } from "@/lib/social/api";
import { cn } from "@/lib/utils";

const pageCap = 5, socialSourceId = "social";
type Feed<T> = { status: "loading" | "ready" | "error" | "unavailable"; items: T[]; partial: boolean };
const feed = <T,>(status: Feed<T>["status"] = "loading"): Feed<T> => ({ status, items: [], partial: false });

/** Reads one provider list to the end, at most five pages; an unfinished list is reported as partial, never presented as complete. */
async function readAll<T>(page: (cursor?: string) => Promise<Result<Page<T>>>): Promise<{ state: "available"; items: T[]; partial: boolean } | { state: Exclude<Result<never>["state"], "available"> }> {
  const items: T[] = []; let cursor: string | undefined, partial = false;
  for (let index = 0; index < pageCap; index++) {
    const result = await page(cursor);
    if (result.state !== "available") return { state: result.state };
    items.push(...result.data.items); partial ||= !!result.data.partial;
    if (!result.data.nextCursor) return { state: "available", items, partial };
    cursor = result.data.nextCursor;
  }
  return { state: "available", items, partial: true };
}

/**
 * The connected calendar: month, week, day and availability over the person's live events, the optional read-only overlay of scheduled social posts, source
 * chips with small marks when more than one source is shown, and the event detail panel. Everything is fetched for this one connection and held in memory only.
 * Creating, editing and deleting go through the Office route only when the server says writes are available (synthetic provider outside production); otherwise the controls stay disabled.
 */
export function CalendarWorkspace({ tenantId, api, connection, noticeVersion, socialOverlay, disconnect, onReconnect, onGranted }: {
  tenantId: string; api: CalendarApi; connection: OfficeConnection; noticeVersion: number; socialOverlay: boolean; disconnect: React.ReactNode; onReconnect: () => void; onGranted: () => void;
}) {
  const t = useTranslations("OfficeCalendar"), locale = useLocale();
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const platform = connection.platform!;
  const viewParam = params.get("view"), view: CalendarView = calendarViews.find((value) => value === viewParam) ?? "month";
  const dateParam = params.get("date"), parsed = dateParam ? parseISO(dateParam) : null;
  const date = useMemo(() => startOfDay(parsed && isValid(parsed) ? parsed : new Date()), [dateParam]); // eslint-disable-line react-hooks/exhaustive-deps
  const overlayOn = socialOverlay && params.get("social") === "1";
  const availabilityOn = connection.capabilities.availability === "available", writes = writesAvailable(connection);

  const go = useCallback((next: Record<string, string | null>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) { if (value) query.set(key, value); else query.delete(key); }
    const text = query.toString();
    if (text !== params.toString()) router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const range = useMemo(() => rangeFor(view, date), [view, date]);
  const fromIso = range.from.toISOString(), toIso = range.to.toISOString();
  const [calendars, setCalendars] = useState<NamedCalendar[]>([]);
  const [events, setEvents] = useState<Feed<CalendarItem>>(feed()), [posts, setPosts] = useState<Feed<PlannerItem>>(feed());
  const [selection, setSelection] = useState<Selection>(new Set()), [selected, setSelected] = useState<string | null>(null), [form, setForm] = useState<{ item: CalendarItem | null } | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({}), [version, setVersion] = useState(0);
  const events_ = view !== "availability";
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    void api.calendars(connection.id, controller.signal).then((result) => { if (result.state === "available") setCalendars(result.data.items); }, () => undefined);
    return () => controller.abort();
  }, [api, connection.id]);

  useEffect(() => {
    if (!events_) return;
    let stopped = false;
    void Promise.resolve().then(async () => {
      setEvents(feed()); setNow(Date.now());
      try {
        const result = await readAll<CalendarItem>((cursor) => api.events(connection.id, { start: fromIso, end: toIso, ...(cursor ? { cursor } : {}) }));
        if (stopped) return;
        if (result.state === "reconnect_needed") return onReconnect();
        if (result.state !== "available") return setEvents(feed(result.state === "temporarily_unavailable" ? "error" : "unavailable"));
        const seen = new Set<string>();
        setEvents({ status: "ready", partial: result.partial, items: result.items.filter((item) => { const key = `${item.calendarRef}:${item.ref}`; if (seen.has(key)) return false; seen.add(key); return true; }) });
      } catch (error) { if (!stopped) setEvents(feed(error instanceof Error && "unavailable" in error && (error as { unavailable: boolean }).unavailable ? "unavailable" : "error")); }
    });
    return () => { stopped = true; };
  }, [api, connection.id, fromIso, toIso, events_, onReconnect, version]);

  useEffect(() => {
    if (!overlayOn || !events_) return;
    let stopped = false;
    const social = socialApi(tenantId), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    void Promise.resolve().then(async () => {
      setPosts(feed());
      try {
        const items: PlannerItem[] = []; let cursor = "", partial = false;
        for (let index = 0; index < pageCap; index++) {
          const page = await social.planner({ from: fromIso, to: toIso, timezone, limit: "100", ...(cursor ? { cursor } : {}) });
          if (stopped) return;
          items.push(...Object.values(page.days).flat());
          if (!page.nextCursor) { cursor = ""; break; }
          cursor = page.nextCursor;
        }
        partial = cursor !== "";
        setPosts({ status: "ready", partial, items: items.filter((item) => overlayStatuses.has(item.status) && item.platform !== null) });
      } catch (error) { if (!stopped) setPosts(feed((error as { unavailable?: boolean }).unavailable ? "unavailable" : "error")); }
    });
    return () => { stopped = true; };
  }, [tenantId, overlayOn, events_, fromIso, toIso, version]);

  // Sources: each calendar of the connection (one when the provider names none) and, while the overlay is on, the ministry's scheduled social posts.
  const sources = useMemo<Source[]>(() => {
    const own = (calendars.length ? calendars : [{ ref: "primary", name: calendarLabel[platform] }]).map((calendar): Source => ({ id: `cal:${calendar.ref}`, kind: platform, name: calendar.name || calendarLabel[platform] }));
    return overlayOn ? [...own, { id: socialSourceId, kind: "harvest", name: t("socialSource") }] : own;
  }, [calendars, overlayOn, platform, t]);
  const shown = shownSources(sources, selection), marks = showMarks(shown), shownIds = new Set(shown.map((source) => source.id));
  const calendarName = (ref: string) => sources.find((source) => source.id === `cal:${ref}`)?.name ?? calendarLabel[platform];

  const entries = useMemo(() => {
    const map = new Map<string, { event: CalendarEvent; item?: CalendarItem; post?: PlannerItem }>();
    const first = sources.find((source) => source.id !== socialSourceId)?.id;
    for (const item of events.items) {
      const id = `cal:${item.calendarRef}`, event = calendarEvent(item, now);
      // A calendar the provider did not list belongs to the first calendar source.
      if (shownIds.has(sources.some((source) => source.id === id) ? id : first ?? id)) map.set(event.id, { event, item });
    }
    if (shownIds.has(socialSourceId)) for (const post of posts.items) { const event = socialEvent(post, now); map.set(event.id, { event, post }); }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.items, posts.items, selection, sources]);
  const list = useMemo(() => [...entries.values()].map((entry) => entry.event), [entries]);

  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
  const mark = (id: string, item?: CalendarItem, post?: PlannerItem) => !marks ? null : post?.platform ? <PlatformLogo platform={post.platform} className="size-3.5 shrink-0" />
    : <CalendarLogo source={isSocialId(id) ? "harvest" : platform} className="size-3.5 shrink-0" label={item ? calendarName(item.calendarRef) : undefined} />;
  const chipText = (event: CalendarEvent, post?: PlannerItem) => <>{post && !marks && post.platform && <PlatformLogo platform={post.platform} className="size-3.5 shrink-0" />}<span className="truncate">{!event.allDay && <span className="font-normal opacity-70">{time.format(event.start)} </span>}{event.title}</span></>;
  const monthChip = (event: CalendarEvent) => { const entry = entries.get(event.id); if (!entry) return null; return <>{mark(event.id, entry.item, entry.post)}{chipText(event, entry.post)}</>; };
  const weekChip = (event: CalendarEvent) => { const entry = entries.get(event.id); if (!entry) return null;
    return <><span className="flex items-center gap-1 text-[11px] text-muted-foreground">{mark(event.id, entry.item, entry.post) ?? (entry.post?.platform && <PlatformLogo platform={entry.post.platform} className="size-3.5 shrink-0" />)}<span className="truncate">{time.format(event.start)}</span></span>
      <span className="truncate font-medium">{event.title}</span></>; };
  const rowChip = (event: CalendarEvent) => { const entry = entries.get(event.id); return <>{entry && mark(event.id, entry.item, entry.post)}<span className="truncate">{event.title}</span></>; };

  const title = view === "month" ? new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date)
    : view === "agenda" ? `${new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(range.from)} – ${new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(addDays(range.to, -1))}`
    : view === "day" ? new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date)
      : `${new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(range.from)} – ${new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(addDays(range.to, -1))}`;
  const setDate = (value: Date) => go({ date: format(value, "yyyy-MM-dd") });
  const detail = selected ? entries.get(selected) ?? null : null;
  const loadingNow = events_ && events.status === "loading";
  const overlap = { moreText: (count: number) => t("overlapMore", { count }), moreLabel: (count: number) => t("overlapLabel", { count }), title: t("overlapTitle"), renderRow: (event: CalendarEvent) => <>{rowChip(event)}<span className="ms-auto text-xs text-muted-foreground">{time.format(event.start)}</span></> };
  const none = events_ && events.status === "ready" && list.length === 0;

  return <div className="space-y-3" data-testid="calendar" data-view={view}>
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t("toolbar")}>
      <Button type="button" variant="outline" size="responsive" onClick={() => setDate(new Date())} data-testid="today">{t("today")}</Button>
      <Button type="button" variant="ghost" size="icon-responsive" aria-label={t(`previous.${view}`)} onClick={() => setDate(shiftDate(view, date, -1))} data-testid="prev"><ChevronLeft aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-responsive" aria-label={t(`next.${view}`)} onClick={() => setDate(shiftDate(view, date, 1))} data-testid="next"><ChevronRight aria-hidden="true" /></Button>
      <h2 className="min-w-0 flex-1 basis-40 text-base font-semibold" aria-live="polite" data-testid="calendar-title">{title}</h2>
      <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("refresh")} onClick={() => setVersion((value) => value + 1)} data-testid="refresh"><RotateCw aria-hidden="true" /></Button>
      <Button type="button" size="responsive" onClick={() => setForm({ item: null })} data-testid="new-event"><Plus aria-hidden="true" />{t("newEvent")}</Button>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup type="single" variant="outline" value={view} onValueChange={(value) => { if (value) go({ view: value === "month" ? null : value }); }} aria-label={t("viewLabel")} data-testid="view-switch">
        {calendarViews.filter((value) => value !== "availability" || availabilityOn).map((value) => <ToggleGroupItem key={value} value={value} aria-label={t(`views.${value}`)} data-testid={`view-${value}`}>{t(`views.${value}`)}</ToggleGroupItem>)}
      </ToggleGroup>
      {socialOverlay && events_ && <label className="flex min-h-11 items-center gap-2 text-sm lg:min-h-9"><Switch checked={overlayOn} onCheckedChange={(value) => go({ social: value ? "1" : null })} data-testid="social-toggle" />{t("showSocial")}</label>}
      <span className="ms-auto flex items-center gap-2" data-testid="account-chip"><CalendarLogo source={platform} className="size-4" /><span className="text-sm text-muted-foreground">{calendarLabel[platform]}</span>{disconnect}</span>
    </div>
    {sources.length > 1 && events_ && <div role="group" aria-label={t("sourceFilter")} className="flex flex-wrap items-center gap-2" data-testid="source-filter">
      <Button type="button" size="responsive" variant={selection.size === 0 ? "default" : "outline"} aria-pressed={selection.size === 0} onClick={() => setSelection(new Set())} data-testid="source-all">{t("allSources")}</Button>
      {sources.map((source) => <Button key={source.id} type="button" size="responsive" variant={selection.has(source.id) ? "default" : "outline"} aria-pressed={selection.has(source.id)} onClick={() => setSelection(toggleSource(selection, source.id, sources.map((item) => item.id)))} data-testid={`source-${source.id}`}>
        <CalendarLogo source={source.kind} />{source.name}</Button>)}
    </div>}

    {events_ && events.partial && <Alert role="status" data-testid="partial-notice"><TriangleAlert aria-hidden="true" /><AlertDescription>{t("partial")}</AlertDescription></Alert>}
    {events_ && overlayOn && posts.status === "error" && <Alert variant="destructive" role="alert" data-testid="social-error"><AlertDescription>{t("socialFailed")}</AlertDescription></Alert>}
    {events_ && overlayOn && posts.status === "unavailable" && <Alert role="status" data-testid="social-unavailable"><AlertDescription>{t("socialUnavailable")}</AlertDescription></Alert>}
    {events_ && overlayOn && posts.partial && <Alert role="status" data-testid="social-partial"><TriangleAlert aria-hidden="true" /><AlertDescription>{t("socialPartial")}</AlertDescription></Alert>}

    {view === "availability" ? <AvailabilityView api={api} connectionId={connection.id} from={range.from} to={range.to} onReconnect={onReconnect} />
      : events.status === "error" ? <Alert variant="destructive" role="alert" data-testid="events-error"><AlertDescription className="flex flex-wrap items-center gap-2">{t("loadEventsFailed")}
        <Button type="button" variant="outline" size="responsive" onClick={() => setVersion((value) => value + 1)}>{t("retry")}</Button></AlertDescription></Alert>
        : events.status === "unavailable" ? <EmptyState icon={TriangleAlert} title={t("unavailableTitle")} description={t("unavailable")} solid />
          : <div className={cn("min-w-0", loadingNow && "opacity-60")} aria-busy={loadingNow} data-testid="calendar-body">
            {loadingNow && <div role="status" aria-label={t("loading")} className="mb-2"><Skeleton className="h-2 w-full" /></div>}
            {none && <p className="mb-2 text-sm text-muted-foreground" role="status" data-testid="empty-range">{t("emptyRange")}</p>}
            {view === "month" && <MonthCalendar hideHeader weekStartsOn={1} namespace="OfficeCalendar.month" currentDate={date} events={list} selectedDay={null} renderChip={monthChip}
              monthHref={() => pathname} onDaySelect={(day) => go({ view: "day", date: format(day, "yyyy-MM-dd") })} />}
            {view === "agenda" && <div className="overflow-hidden rounded-xl border bg-card"><AgendaView currentDate={date} events={list} renderRow={(event) => <>{rowChip(event)}<span className="ms-auto shrink-0 text-xs text-muted-foreground">{event.allDay ? t("allDay") : time.format(event.start)}</span></>} onEventSelect={(event) => setSelected(event.id)} /></div>}
            {(view === "week" || view === "day") && <div className="overflow-hidden rounded-xl border bg-card"><div tabIndex={0} role="region" aria-label={t("gridScroll")} className="max-h-[42rem] overflow-y-auto outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <WeekView mode={view === "day" ? "day" : "week"} currentDate={view === "day" ? date : range.from} events={list} label={t(`grid.${view}`)} overlap={overlap} renderChip={weekChip}
                allDay={{ label: t("allDay"), render: rowChip }} onEventSelect={(event) => setSelected(event.id)} /></div></div>}
          </div>}

    <Sheet open={detail !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-3 pt-[calc(1rem+env(safe-area-inset-top))] sm:max-w-md" data-testid="event-panel">
        {detail?.item && <EventDetail key={detail.event.id} tenantId={tenantId} api={api} connectionId={connection.id} item={detail.item} calendarName={calendarName(detail.item.calendarRef)} platform={platform}
          start={detail.event.start} end={detail.event.end} allDay={!!detail.event.allDay} contactId={links[detail.event.id] ?? null} writes={writes}
          onLinked={(contactId) => setLinks((current) => { const next = { ...current }; if (contactId) next[detail.event.id] = contactId; else delete next[detail.event.id]; return next; })} onEdit={() => { setForm({ item: detail.item! }); setSelected(null); }} onChanged={() => setVersion((value) => value + 1)} onClose={() => setSelected(null)} />}
        {detail?.post && <SocialDetail tenantId={tenantId} item={detail.post} start={detail.event.start} onClose={() => setSelected(null)} />}
      </SheetContent>
    </Sheet>
    {form && <EventDialog key={form.item ? `${form.item.calendarRef}:${form.item.ref}:${form.item.version}` : "new"} event={form.item} isOpen onClose={() => setForm(null)} api={api} connection={connection} noticeVersion={noticeVersion}
      onChanged={() => { setSelected(null); setVersion((value) => value + 1); }} onGranted={onGranted} />}
  </div>;
}
