/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/calendar/components/event-dialog.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { useMemo, useState } from "react";
import { Calendar as CalendarIcon, Trash2 } from "lucide-react";
import { format, isBefore } from "date-fns";
import { useTranslations } from "next-intl";

import type { CalendarEvent } from "@/lib/event-view";
import { calendarLabel, type NamedCalendar } from "@/lib/office/calendar";
import type { OfficePlatform } from "@/lib/office/mail";
import { CalendarLogo } from "@/components/office/provider-logo";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const StartHour = 0, EndHour = 24, DefaultStartHour = 9, DefaultEndHour = 10;
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
  event: (CalendarEvent & { description?: string; location?: string }) | null;
  isOpen: boolean;
  onClose: () => void;
  calendars: NamedCalendar[];
  platform: OfficePlatform;
}

/**
 * The new and edit event drawer. There is no onSave and no onDelete: every control is disabled while the server answers `disabled` for create, update and
 * delete, and nothing here sends a request. Attendees and the automatic meeting link stay disabled even once writes are on, until their decisions are made.
 */
export function EventDialog({ event, isOpen, onClose, calendars, platform }: EventDialogProps) {
  const t = useTranslations("OfficeCalendar.form"), w = useTranslations("OfficeCalendar");
  const formatTime = (date: Date) => `${date.getHours().toString().padStart(2, "0")}:${(Math.floor(date.getMinutes() / 15) * 15).toString().padStart(2, "0")}`;
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [startDate, setStartDate] = useState<Date>(event ? new Date(event.start) : new Date());
  const [endDate, setEndDate] = useState<Date>(event ? new Date(event.end) : new Date());
  const [startTime, setStartTime] = useState(event ? formatTime(new Date(event.start)) : `${String(DefaultStartHour).padStart(2, "0")}:00`);
  const [endTime, setEndTime] = useState(event ? formatTime(new Date(event.end)) : `${String(DefaultEndHour).padStart(2, "0")}:00`);
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [location, setLocation] = useState(event?.location ?? "");
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 sm:max-w-md" data-testid="event-form">
        <SheetHeader className="border-b">
          <SheetTitle>{event?.id ? t("editTitle") : t("newTitle")}</SheetTitle>
          <SheetDescription data-testid="form-writes-note">{w("writesOff")}</SheetDescription>
        </SheetHeader>
        <div tabIndex={0} role="region" aria-label={event?.id ? t("editTitle") : t("newTitle")} className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <fieldset disabled className="grid gap-4 border-0 p-4">
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
            <Label htmlFor="location">{t("location")}</Label>
            <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="*:not-first:mt-1.5">
            <Label htmlFor="time-zone">{t("timeZone")}</Label>
            <Select value={zone}>
              <SelectTrigger id="time-zone"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={zone}>{zone}</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="*:not-first:mt-1.5">
            <Label htmlFor="calendar-pick" className="flex items-center gap-2"><CalendarLogo source={platform} />{t("calendar")}</Label>
            <Select value={calendars[0]?.ref ?? "primary"}>
              <SelectTrigger id="calendar-pick"><SelectValue /></SelectTrigger>
              <SelectContent>{(calendars.length ? calendars : [{ ref: "primary", name: "" }]).map((calendar) => <SelectItem key={calendar.ref} value={calendar.ref}>{calendar.name || calendarLabel[platform]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="*:not-first:mt-1.5">
            <Label htmlFor="attendees">{t("attendees")}</Label>
            <Input id="attendees" type="email" data-testid="form-attendees" />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="meeting-link" data-testid="form-meeting" />
            <Label htmlFor="meeting-link">{t("meetingLink")}</Label>
          </div>
        </fieldset>
        </div>
        <SheetFooter className="flex-row border-t sm:justify-between">
          {event?.id && (
            <Button variant="destructive" size="icon-responsive" disabled aria-label={t("delete")}>
              <Trash2 size={16} aria-hidden="true" />
            </Button>
          )}
          <div className="flex flex-1 justify-end gap-2">
            <Button type="button" variant="outline" size="responsive" onClick={onClose} data-testid="form-close">
              {t("close")}
            </Button>
            <Button type="button" size="responsive" disabled data-testid="form-save">{t("save")}</Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
