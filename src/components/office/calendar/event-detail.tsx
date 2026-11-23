"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { CalendarDays, ExternalLink, Pencil, Trash2, Users, Video, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PersonLink } from "@/components/office/mail/person-link";
import { CalendarLogo } from "@/components/office/provider-logo";
import { PlatformLogo } from "@/components/social/platform-logo";
import { platformLabels } from "@/lib/social/labels";
import { plannerHref, safeLink, type CalendarApi, type CalendarItem } from "@/lib/office/calendar";
import type { PlannerItem } from "@/lib/social/api";
import { OfficeApiError, type OfficePlatform } from "@/lib/office/mail";
import { notify } from "@/lib/toast";

/** Meeting provider names, in code like every product name (never in the message catalogue). */
const meetingName = { meet: "Google Meet", teams: "Microsoft Teams" } as const;

export function whenText(start: Date, end: Date, allDay: boolean, locale: string) {
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }), time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
  if (allDay) return start.toDateString() === end.toDateString() ? day.format(start) : `${day.format(start)} – ${day.format(end)}`;
  return start.toDateString() === end.toDateString() ? `${day.format(start)}, ${time.format(start)} – ${time.format(end)}` : `${day.format(start)} ${time.format(start)} – ${day.format(end)} ${time.format(end)}`;
}

/**
 * The event detail panel: time, calendar, join link and attendees the provider returned (live, held in component state only), the explicit link to a CRM person,
 * and Edit and Delete, which work only for events created in Harvest and only while the server says writes are available.
 */
export function EventDetail({ tenantId, api, connectionId, item, calendarName, platform, start, end, allDay, contactId, writes, onLinked, onEdit, onChanged, onClose }: {
  tenantId: string; api: CalendarApi; connectionId: string; item: CalendarItem; calendarName: string; platform: OfficePlatform; start: Date; end: Date; allDay: boolean;
  contactId: string | null; writes: boolean; onLinked: (contactId: string | null) => void; onEdit: () => void; onChanged: () => void; onClose: () => void;
}) {
  const t = useTranslations("OfficeCalendar.detail"), p = useTranslations("OfficeMail.person"), w = useTranslations("OfficeCalendar"), locale = useLocale();
  const [busy, setBusy] = useState(false);
  const mine = writes && item.createdHere === true, stale = useRef(false);
  const join = safeLink(item.meetingLink);
  async function link(id: string) {
    setBusy(true);
    try {
      const result = await api.link(connectionId, { eventRef: item.ref, calendarRef: item.calendarRef, contactId: id });
      if (result.state !== "available") return p("failed");
      onLinked(id); notify.success(p("linkedToast")); return null;
    } catch { return p("failed"); } finally { setBusy(false); }
  }
  async function remove() {
    try {
      const result = await api.deleteEvent(connectionId, { calendarRef: item.calendarRef, eventRef: item.ref, version: item.version ?? "" });
      if (result.state === "available") { notify.success(t("deleted")); onChanged(); onClose(); return; }
      return t("deleteFailed");
    } catch (error) {
      if (error instanceof OfficeApiError && error.conflict) { stale.current = true; return t("changedElsewhere"); }
      throw error;
    }
  }
  async function unlink() {
    if (!contactId) return;
    setBusy(true);
    try { const result = await api.unlink(connectionId, { contactId, itemRef: item.ref }); if (result.state === "available") { onLinked(null); notify.success(p("unlinkedToast")); } else notify.error(p("unlinkFailed")); }
    catch { notify.error(p("unlinkFailed")); } finally { setBusy(false); }
  }
  return <>
    <SheetHeader className="flex-row items-start gap-2 pb-0">
      <div className="min-w-0 flex-1"><SheetTitle className="break-words text-lg" data-testid="detail-title">{item.title || t("untitled")}</SheetTitle>
        <SheetDescription className="mt-1" data-testid="detail-when">{whenText(start, end, allDay, locale)}</SheetDescription></div>
      <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("close")} onClick={onClose} data-testid="detail-close"><X aria-hidden="true" /></Button>
    </SheetHeader>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
      <dl className="space-y-3 text-sm">
        <div className="flex items-center gap-2"><dt className="sr-only">{t("calendar")}</dt><dd className="flex items-center gap-2"><CalendarLogo source={platform} className="size-4 shrink-0" /><span>{calendarName}</span></dd></div>
        {join && <div className="flex items-center gap-2"><dt className="sr-only">{t("join")}</dt><dd className="flex flex-wrap items-center gap-2"><Video className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Button asChild variant="outline" size="responsive"><a href={join} target="_blank" rel="noopener noreferrer" data-testid="join-link">{t("joinMeeting")}<ExternalLink aria-hidden="true" /></a></Button>
          {item.meetingKind && <span className="text-muted-foreground" data-testid="meeting-kind">{meetingName[item.meetingKind]}</span>}</dd></div>}
        {item.attendees.length > 0 && <div className="flex items-start gap-2"><dt className="sr-only">{t("attendees")}</dt><dd className="flex items-start gap-2"><Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <ul className="space-y-0.5 break-all" data-testid="attendees">{item.attendees.map((address) => <li key={address}>{address}</li>)}</ul></dd></div>}
        {item.description && <div><dt className="sr-only">{t("notes")}</dt><dd><p className="whitespace-pre-wrap break-words text-muted-foreground" data-testid="detail-notes">{item.description}</p></dd></div>}
      </dl>
      <div className="flex flex-wrap items-center gap-2 border-t pt-4"><PersonLink tenantId={tenantId} contactId={contactId} busy={busy} onLink={(person) => link(person.id)} onUnlink={() => void unlink()} /></div>
      <div className="space-y-2 border-t pt-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="responsive" disabled={!mine} aria-describedby={mine ? undefined : "detail-writes-note"} onClick={onEdit} data-testid="event-edit"><Pencil aria-hidden="true" />{t("edit")}</Button>
          {mine
            ? <ConfirmDialog trigger={<Button type="button" variant="outline" size="responsive" data-testid="event-delete"><Trash2 aria-hidden="true" />{t("delete")}</Button>}
              onOpenChange={(open) => { if (!open && stale.current) { stale.current = false; onChanged(); } }} title={t("deleteTitle")} description={t("deleteBody")} confirmLabel={t("delete")} cancelLabel={t("cancel")} busyLabel={t("deleting")} onConfirm={remove} />
            : <Button type="button" variant="outline" size="responsive" disabled aria-describedby="detail-writes-note" data-testid="event-delete"><Trash2 aria-hidden="true" />{t("delete")}</Button>}
        </div>
        {!mine && <p id="detail-writes-note" className="text-sm text-muted-foreground" data-testid="writes-note">{writes ? t("readOnlyEvent") : w("writesOff")}</p>}
      </div>
    </div>
  </>;
}

/** A scheduled social post on the overlay: read-only, time, network mark and a short title, with a link to the post in the planner. */
export function SocialDetail({ tenantId, item, start, onClose }: { tenantId: string; item: PlannerItem; start: Date; onClose: () => void }) {
  const t = useTranslations("OfficeCalendar.detail"), locale = useLocale();
  const when = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(start);
  return <>
    <SheetHeader className="flex-row items-start gap-2 pb-0">
      <div className="min-w-0 flex-1"><SheetTitle className="break-words text-lg" data-testid="detail-title">{item.summary.trim().slice(0, 60) || t("socialUntitled")}</SheetTitle>
        <SheetDescription className="mt-1" data-testid="detail-when">{when}</SheetDescription></div>
      <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("close")} onClick={onClose} data-testid="detail-close"><X aria-hidden="true" /></Button>
    </SheetHeader>
    <div className="space-y-4 px-4 pb-4">
      <p className="flex items-center gap-2 text-sm">{item.platform ? <><PlatformLogo platform={item.platform} /><span>{platformLabels[item.platform]}</span></> : <CalendarDays className="size-4" aria-hidden="true" />}<span className="text-muted-foreground">{t("socialReadOnly")}</span></p>
      <Button asChild variant="outline" size="responsive"><Link href={plannerHref(tenantId, item)} prefetch={false} data-testid="open-planner">{t("openPlanner")}<ExternalLink aria-hidden="true" /></Link></Button>
    </div>
  </>;
}
