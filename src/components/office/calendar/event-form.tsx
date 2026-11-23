/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/calendar/components/event-dialog.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar as CalendarIcon, TriangleAlert } from "lucide-react";
import { format, isBefore, parseISO } from "date-fns";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useConnectAttempt } from "@/components/office/use-connect-attempt";
import { addPlainDays, calendarLabel, calendarWriteGrant, writesAvailable, zonedInstant, zonedParts, type CalendarApi, type CalendarItem, type EventInput, type NamedCalendar } from "@/lib/office/calendar";
import { OfficeApiError, type OfficeConnection } from "@/lib/office/mail";
import { notify } from "@/lib/toast";
import { CalendarLogo } from "@/components/office/provider-logo";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const StartHour = 0, EndHour = 24;
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface EventDialogProps {
  /** The event being edited (created in Harvest), or null for a new one. */
  event: CalendarItem | null;
  isOpen: boolean;
  onClose: () => void;
  /** Called after a saved create or update, or when the event changed elsewhere, so the view reloads. */
  onChanged: () => void;
  /** Called once write access is granted, so the connection is read again. */
  onGranted: () => void;
  api: CalendarApi;
  connection: OfficeConnection;
  noticeVersion: number;
}

const formatTime = (time: string) => `${time.slice(0, 2)}:${String(Math.floor(Number(time.slice(3, 5)) / 15) * 15).padStart(2, "0")}`;
const roundedNow = () => { const now = new Date(); now.setMinutes(Math.ceil((now.getMinutes() + 1) / 15) * 15, 0, 0); return now; };

/**
 * The new and edit event drawer. Single events only, on the person's own calendar: no attendees (invites are not available), no recurrence. The calendar list holds
 * only writable calendars, the event uses that calendar's time zone, and the video link is off by default. Write access is a separate grant asked for the first time.
 * While the server says writes are not available every control stays disabled, as before.
 */
export function EventDialog({ event, isOpen, onClose, onChanged, onGranted, api, connection, noticeVersion }: EventDialogProps) {
  const t = useTranslations("OfficeCalendar.form"), w = useTranslations("OfficeCalendar");
  const platform = connection.platform!, writes = writesAvailable(connection), granted = (connection.grants & calendarWriteGrant) === calendarWriteGrant;
  const editing = event !== null;
  const [calendars, setCalendars] = useState<NamedCalendar[] | null>(null), [calendarRef, setCalendarRef] = useState(event?.calendarRef ?? "");
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const zone = event?.timezone || calendars?.find((calendar) => calendar.ref === calendarRef)?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const initial = useMemo(() => {
    if (!event) { const start = roundedNow(), end = new Date(start.getTime() + 60 * 60_000); return { allDay: false, startDate: start, endDate: end, startTime: format(start, "HH:mm"), endTime: format(end, "HH:mm") }; }
    const allDay = event.allDay === true || /^\d{4}-\d{2}-\d{2}$/.test(event.start);
    if (allDay) return { allDay, startDate: parseISO(event.start.slice(0, 10)), endDate: parseISO(addPlainDays(event.end.slice(0, 10), -1)), startTime: "09:00", endTime: "10:00" };
    const from = zonedParts(event.start, event.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone), to = zonedParts(event.end, event.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    return { allDay, startDate: parseISO(from.date), endDate: parseISO(to.date), startTime: formatTime(from.time), endTime: formatTime(to.time) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [startDate, setStartDate] = useState<Date>(initial.startDate);
  const [endDate, setEndDate] = useState<Date>(initial.endDate);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [meeting, setMeeting] = useState(event?.meetingLink != null);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<"failed" | "changed" | "grant" | "invalid" | null>(null);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const meetingOk = connection.capabilities.meeting === "available";
  const off = !writes || busy;

  useEffect(() => {
    if (!isOpen || !writes || !granted) return;
    const controller = new AbortController();
    void api.writableCalendars(connection.id, controller.signal).then((result) => {
      if (result.state !== "available") return setCalendars([]);
      setCalendars(result.data.items);
      setCalendarRef((current) => current || result.data.defaultRef || "");
    }, () => setCalendars([]));
    return () => controller.abort();
  }, [api, connection.id, isOpen, writes, granted]);

  const start = useCallback((chosen: typeof platform, connectionId?: string) => api.startConnect(chosen, noticeVersion, connectionId, "write"), [api, noticeVersion]);
  const finish = useCallback((attemptId: string) => api.finishConnect(attemptId), [api]);
  const { phase, begin, cancel } = useConnectAttempt({ start, finish, onConnected: () => { setProblem(null); onGranted(); } });
  const asking = phase.name === "starting" || phase.name === "pending";

  const payload = (): EventInput => {
    const base = { title: title.trim(), ...(description.trim() ? { description: description.trim() } : {}), attendees: [] as [], meeting, timezone: zone };
    const first = format(startDate, "yyyy-MM-dd"), last = format(endDate, "yyyy-MM-dd");
    return allDay ? { ...base, allDay: true, start: first, end: addPlainDays(last, 1) }
      : { ...base, start: zonedInstant(first, startTime, zone), end: zonedInstant(last, endTime, zone) };
  };
  const valid = title.trim() !== "" && calendarRef !== "" && (allDay ? !isBefore(endDate, startDate) : Date.parse(payload().start) < Date.parse(payload().end));

  async function save() {
    if (!valid || busy) return;
    setBusy(true); setProblem(null);
    try {
      const body = payload();
      const key = JSON.stringify([calendarRef, body]);
      // One request id per attempt: a retry of the same form never creates a second event, and a changed form gets a new id.
      if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      const result = event
        ? await api.updateEvent(connection.id, { calendarRef: event.calendarRef, eventRef: event.ref, version: event.version ?? "", event: body })
        : await api.createEvent(connection.id, { calendarRef, requestId: attempt.current.id, event: body });
      if (result.state === "available") { notify.success(t(editing ? "updated" : "created")); onChanged(); onClose(); return; }
      setProblem(result.state === "write_access_needed" ? "grant" : "failed");
    } catch (error) {
      if (error instanceof OfficeApiError && error.conflict) { setProblem("changed"); } else if (error instanceof OfficeApiError && error.status === 400) setProblem("invalid"); else setProblem("failed");
    } finally { setBusy(false); }
  }

  // Memoize time options so they're only calculated once
  const timeOptions = useMemo(() => {
    const options = [];
    for (let hour = StartHour; hour <= EndHour; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const formattedHour = hour.toString().padStart(2, "0");
        const formattedMinute = minute.toString().padStart(2, "0");
        const value = `${formattedHour}:${formattedMinute}`;
        // Use a fixed date to avoid unnecessary date object creations
        const date = new Date(2000, 0, 1, hour, minute);
        const label = format(date, "h:mm a");
        options.push({ value, label });
      }
    }
    return options;
  }, []); // Empty dependency array ensures this only runs once

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 sm:max-w-md" data-testid="event-form">
        <SheetHeader className="border-b">
          <SheetTitle>{editing ? t("editTitle") : t("newTitle")}</SheetTitle>
          {!writes && <SheetDescription data-testid="form-writes-note">{w("writesOff")}</SheetDescription>}
          {writes && <SheetDescription className="sr-only">{editing ? t("editTitle") : t("newTitle")}</SheetDescription>}
        </SheetHeader>
        {writes && !granted ? <div className="flex-1 space-y-3 p-4" data-testid="grant-prompt" role="region" aria-label={t("grantTitle")}>
          <p className="font-medium">{t("grantTitle")}</p>
          {phase.name === "pending" && <Alert role="status" data-testid="grant-pending"><Spinner /><AlertDescription><p>{w("connect.pendingBody")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {phase.url && <Button asChild variant="outline" size="responsive"><a href={phase.url} target="_blank" rel="noopener noreferrer">{w("connect.openAgain")}</a></Button>}
              <Button type="button" variant="outline" size="responsive" onClick={cancel}>{w("connect.cancel")}</Button></div></AlertDescription></Alert>}
          {(phase.name === "failed" || phase.name === "refused") && <Alert variant="destructive" role="alert" data-testid="grant-failed"><AlertDescription>{t("grantFailed")}</AlertDescription></Alert>}
          {phase.name !== "pending" && <Button type="button" size="responsive" disabled={asking} onClick={() => void begin(platform, connection.id)} data-testid="grant-allow">{phase.name === "starting" ? <Spinner /> : <CalendarLogo source={platform} />}{t("grantAllow")}</Button>}
        </div> : <>
        <div tabIndex={0} role="region" aria-label={editing ? t("editTitle") : t("newTitle")} className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {problem && <div className="px-4 pt-4"><Alert variant="destructive" role="alert" data-testid={`form-${problem}`}><TriangleAlert aria-hidden="true" /><AlertDescription className="flex flex-wrap items-center gap-2">
          {t(`problem.${problem}`)}
          {problem === "changed" && <Button type="button" variant="outline" size="responsive" onClick={() => { onChanged(); onClose(); }} data-testid="form-reload">{t("reload")}</Button>}
        </AlertDescription></Alert></div>}
        <fieldset disabled={off} className="grid gap-4 border-0 p-4">
          <div className="*:not-first:mt-1.5">
            <Label htmlFor="title">{t("title")}</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="*:not-first:mt-1.5">
            <Label htmlFor="description">{t("notes")}</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
            <div className="min-w-0 flex-1 *:not-first:mt-1.5">
              <Label htmlFor="start-date">{t("startDate")}</Label>
              <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="start-date"
                    variant={"outline"}
                    className={cn(
                      "group bg-background hover:bg-background border-input w-full justify-between px-3 font-normal outline-offset-0 outline-none focus-visible:outline-[3px]",
                      !startDate && "text-muted-foreground"
                    )}>
                    <span className={cn("truncate", !startDate && "text-muted-foreground")}>
                      {startDate ? format(startDate, "PPP") : t("pickDate")}
                    </span>
                    <CalendarIcon
                      size={16}
                      className="text-muted-foreground/80 shrink-0"
                      aria-hidden="true"
                    />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    defaultMonth={startDate}
                    onSelect={(date) => {
                      if (date) {
                        setStartDate(date);
                        // If end date is before the new start date, update it to match the start date
                        if (isBefore(endDate, date)) {
                          setEndDate(date);
                        }
                        setStartDateOpen(false);
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {!allDay && (
              <div className="min-w-28 *:not-first:mt-1.5">
                <Label htmlFor="start-time">{t("startTime")}</Label>
                <Select value={startTime} onValueChange={setStartTime}>
                  <SelectTrigger id="start-time">
                    <SelectValue placeholder={t("pickTime")} />
                  </SelectTrigger>
                  <SelectContent>
                    {timeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
            <div className="min-w-0 flex-1 *:not-first:mt-1.5">
              <Label htmlFor="end-date">{t("endDate")}</Label>
              <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="end-date"
                    variant={"outline"}
                    className={cn(
                      "group bg-background hover:bg-background border-input w-full justify-between px-3 font-normal outline-offset-0 outline-none focus-visible:outline-[3px]",
                      !endDate && "text-muted-foreground"
                    )}>
                    <span className={cn("truncate", !endDate && "text-muted-foreground")}>
                      {endDate ? format(endDate, "PPP") : t("pickDate")}
                    </span>
                    <CalendarIcon
                      size={16}
                      className="text-muted-foreground/80 shrink-0"
                      aria-hidden="true"
                    />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    defaultMonth={endDate}
                    disabled={{ before: startDate }}
                    onSelect={(date) => {
                      if (date) {
                        setEndDate(date);
                        setEndDateOpen(false);
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {!allDay && (
              <div className="min-w-28 *:not-first:mt-1.5">
                <Label htmlFor="end-time">{t("endTime")}</Label>
                <Select value={endTime} onValueChange={setEndTime}>
                  <SelectTrigger id="end-time">
                    <SelectValue placeholder={t("pickTime")} />
                  </SelectTrigger>
                  <SelectContent>
                    {timeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="all-day"
              checked={allDay}
              onCheckedChange={(checked) => setAllDay(checked === true)}
            />
            <Label htmlFor="all-day">{t("allDay")}</Label>
          </div>

          <div className="*:not-first:mt-1.5">
            <Label htmlFor="calendar-pick" className="flex items-center gap-2"><CalendarLogo source={platform} />{t("calendar")}</Label>
            <Select value={calendarRef} onValueChange={setCalendarRef} disabled={editing || calendars === null || calendars.length === 0}>
              <SelectTrigger id="calendar-pick" data-testid="form-calendar"><SelectValue placeholder={calendars === null ? t("loadingCalendars") : t("pickCalendar")} /></SelectTrigger>
              <SelectContent>{(calendars ?? []).map((calendar) => <SelectItem key={calendar.ref} value={calendar.ref}>{calendar.name || calendarLabel[platform]}</SelectItem>)}</SelectContent>
            </Select>
            {calendars !== null && calendars.length === 0 && !editing && <p className="text-sm text-muted-foreground" data-testid="form-no-calendars">{t("noCalendars")}</p>}
          </div>
          <p className="text-sm text-muted-foreground" data-testid="form-zone">{t("timeZoneIs", { zone })}</p>
          <div className="*:not-first:mt-1.5">
            <Label htmlFor="attendees">{t("attendees")}</Label>
            <Input id="attendees" type="email" disabled aria-describedby="attendees-note" data-testid="form-attendees" />
            <p id="attendees-note" className="text-sm text-muted-foreground" data-testid="form-attendees-note">{t("invitesOff")}</p>
          </div>
          <div className="*:not-first:mt-1.5">
            <div className="flex items-center gap-2">
              <Switch id="meeting-link" checked={meeting && meetingOk} onCheckedChange={setMeeting} disabled={off || !meetingOk} aria-describedby={meetingOk ? undefined : "meeting-note"} data-testid="form-meeting" />
              <Label htmlFor="meeting-link">{t("meetingLink")}</Label>
            </div>
            {!meetingOk && <p id="meeting-note" className="text-sm text-muted-foreground" data-testid="form-meeting-note">{t("meetingOff")}</p>}
          </div>
        </fieldset>
        </div>
        <SheetFooter className="flex-row border-t sm:justify-end">
          <Button type="button" variant="outline" size="responsive" onClick={onClose} disabled={busy} data-testid="form-close">{t("close")}</Button>
          <Button type="button" size="responsive" disabled={off || !valid} onClick={() => void save()} data-testid="form-save">{busy && <Spinner />}{t("save")}</Button>
        </SheetFooter>
        </>}
      </SheetContent>
    </Sheet>
  );
}
