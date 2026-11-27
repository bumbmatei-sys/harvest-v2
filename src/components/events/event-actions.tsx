"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarPlus, Video } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCrmRequest } from "@/components/crm/request";
import { eventPhase, mayAskForJoinLink, type EventItem, type EventState } from "@/lib/event-view";

type RsvpResult = { outcome: "ok"; event: EventItem } | { outcome: "full" };

/**
 * Response controls on the event page: Going, Not going, waitlist join and an explicit seat claim, the calendar file and the join link.
 * Everything shown follows the event the server returned; the join link is requested only on a click and kept in memory, and the
 * server decides whether the window is open (an answer of "not found" is shown as unavailable, never as a reason).
 */
export function EventActions({ tenantId, initial, now, calendarHref }: { tenantId: string; initial: EventItem; now: number; calendarHref: string }) {
  const t = useTranslations("Events"), request = useCrmRequest(), router = useRouter();
  const [event, setEvent] = useState(initial), [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(""), [stale, setStale] = useState(false), [notice, setNotice] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const base = `/api/workspaces/${tenantId}/events/${event.id}`, phase = eventPhase(event, now), open = phase === "upcoming" || phase === "live";
  const full = event.capacity !== null && event.available === 0, before = phase === "upcoming";

  async function respond(state: EventState) {
    setBusy(state); setError(""); setNotice(""); setStale(false);
    const result = await request<RsvpResult>(`${base}/rsvp`, { method: "PUT", body: { state, expectedVersion: event.rsvpVersion } });
    setBusy(null);
    if (!result.ok) { setError(result.error); setStale(result.status === 409); return; }
    if (result.data.outcome === "full") { setError(t("fullNotice")); router.refresh(); return; }
    setEvent(result.data.event); setNotice(t(`notices.${state}`));
    router.refresh();
  }
  async function join() {
    setBusy("join"); setError(""); setNotice("");
    const result = await request<{ url: string }>(`${base}/join`, { method: "POST" });
    setBusy(null);
    if (result.ok) setLink(result.data.url); else { setLink(null); setError(t("joinUnavailable")); }
  }

  const choice = (state: EventState, label: string, primary = false) => <Button type="button" variant={event.rsvp === state ? "default" : primary ? "default" : "outline"} className="min-h-11 flex-1 sm:flex-none"
    aria-pressed={event.rsvp === state} aria-disabled={busy !== null || undefined} onClick={() => { if (busy === null && event.rsvp !== state) void respond(state); }}>
    {busy === state && <Spinner decorative size="sm" />}{label}</Button>;

  return <div className="space-y-4">
    {phase === "cancelled" && <Alert role="status"><AlertDescription>{t("cancelledNotice")}</AlertDescription></Alert>}
    {phase === "ended" && <Alert role="status"><AlertDescription>{t("endedNotice")}</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{error}
      {stale && <Button type="button" variant="outline" className="min-h-11" onClick={() => location.reload()}>{t("reload")}</Button>}</AlertDescription></Alert>}
    {open && <div className="space-y-3" role="group" aria-label={t("yourResponse")}>
      <div className="flex flex-wrap gap-2">
        {event.rsvp === "waitlisted" ? <>
          {event.canClaimSeat && choice("going", t("claimSeat"), true)}
          {choice("not_going", t("leaveWaitlist"))}
        </> : <>
          {full && before && event.rsvp !== "going" ? choice("waitlisted", t("joinWaitlist"), true) : choice("going", t("going"), true)}
          {choice("not_going", t("notGoing"))}
        </>}
      </div>
      {event.rsvp === "waitlisted" && !event.canClaimSeat && <p className="text-sm text-muted-foreground">{t("waitlistWaiting")}</p>}
    </div>}
    <p role="status" aria-live="polite" className={notice ? "text-sm" : "sr-only"}>{notice}</p>
    <div className="flex flex-wrap gap-2">
      {open && <Button asChild variant="outline" className="min-h-11"><a href={calendarHref} download><CalendarPlus aria-hidden="true" />{t("addToCalendar")}</a></Button>}
      {mayAskForJoinLink(event, now) && <Button type="button" variant="outline" className="min-h-11" aria-disabled={busy !== null || undefined} onClick={() => { if (busy === null) void join(); }}>
        {busy === "join" ? <Spinner decorative size="sm" /> : <Video aria-hidden="true" />}{t("joinOnline")}</Button>}
    </div>
    {link && <Button asChild className="min-h-11"><a href={link} target="_blank" rel="noopener noreferrer">{t("openMeeting")}</a></Button>}
  </div>;
}
