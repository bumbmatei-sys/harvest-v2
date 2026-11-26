"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { EventCard } from "@/components/events/event-card";
import { SearchableSelect } from "@/components/searchable-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRequest } from "@/hooks/use-request";
import { formatDay } from "@/lib/event-view";
import type { CampaignEventCandidate, CampaignEventsView } from "@/server/campaign-events";

/**
 * Campaign events: the ministry events this campaign shows, as the shared Events cards. Events owners/admins (`view.manage`) open each event in Events,
 * add one from the ministry's events or remove one; removing never changes the event. Everyone else sees only what the server returned and no controls.
 */
export function CampaignEvents({ tenantId, campaignId, view, candidates, now }: {
  tenantId: string; campaignId: string; view: CampaignEventsView; candidates: CampaignEventCandidate[]; now: number;
}) {
  const t = useTranslations("CampaignEvents"), locale = useLocale(), request = useRequest(), router = useRouter();
  const [error, setError] = useState(""), [saving, setSaving] = useState<string | null>(null);
  const events = `/workspaces/${tenantId}/events`;
  async function change(eventId: string, linked: boolean) {
    setSaving(eventId); setError("");
    const result = await request<CampaignEventsView>(`/api/workspaces/${tenantId}/campaigns/${campaignId}/events`, { method: "PUT", body: { eventId, linked } });
    setSaving(null);
    if (result.ok) router.refresh(); else setError(result.error);
  }
  return <Card data-slot="campaign-events">
    <CardHeader className="flex flex-wrap items-center justify-between gap-3">
      <CardTitle><h2 className="text-base font-semibold">{t("title")}</h2></CardTitle>
      {view.manage && <Button asChild variant="outline" className="min-h-11 lg:min-h-9"><Link href={`${events}/new`} prefetch={false}><Plus aria-hidden="true" />{t("create")}</Link></Button>}
    </CardHeader>
    <CardContent className="space-y-3">
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {view.events.length ? <ul className="space-y-2" aria-label={t("title")}>{view.events.map((event) => <li key={event.id} className="flex items-start gap-2">
        <EventCard event={event} href={view.manage ? `${events}/${event.id}` : undefined} now={now} manage={view.manage} className="min-w-0 flex-1" />
        {view.manage && <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 lg:size-9" disabled={saving !== null} aria-label={t("remove", { title: event.title })}
          onClick={() => void change(event.id, false)}><X className="size-4" aria-hidden="true" /></Button>}
      </li>)}</ul> : <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      {view.manage && <SearchableSelect id="campaign-events-add" value={undefined} ariaLabel={t("add")} placeholder={t("add")} searchLabel={t("search")} emptyLabel={t("noMatch")}
        className="w-full sm:w-80" options={candidates.map((event) => ({ value: event.id, label: `${event.title} · ${formatDay(event.startsAt, event.timeZone, locale)}${event.status === "draft" ? ` · ${t("draft")}` : ""}` }))}
        onChange={(value) => { if (value && saving === null) void change(value, true); }} />}
    </CardContent>
  </Card>;
}
