"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRequest } from "@/hooks/use-request";
import type { CampaignFollowUpCounts } from "@/lib/follow-up-cases";

/**
 * CW-11, owners and admins only: how many of this campaign's follow-up cases are waiting, assigned, connected or closed (counts, never names or
 * contacts), a link to the follow-up list filtered to the campaign, and the campaign's follow-up team. The server decides access; this card only
 * renders what it was given and asks the team endpoint to add or remove one person.
 */
export function CampaignFollowUp({ tenantId, campaignId, counts, team, members }: {
  tenantId: string; campaignId: string; counts: CampaignFollowUpCounts; team: string[]; members: { id: string; name: string }[];
}) {
  const t = useTranslations("CampaignDashboard.followUp"), request = useRequest(), router = useRouter();
  const [error, setError] = useState(""), [saving, setSaving] = useState<string | null>(null);
  const names = new Map(members.map((member) => [member.id, member.name]));
  const onTeam = new Set(team);
  async function change(userId: string, member: boolean) {
    setSaving(userId); setError("");
    const result = await request<{ changed: boolean }>(`/api/workspaces/${tenantId}/campaigns/${campaignId}/follow-up`, { method: "PATCH", body: { userId, member } });
    setSaving(null);
    if (result.ok) router.refresh(); else setError(result.error);
  }
  const stats: [string, number][] = [[t("waiting"), counts.waiting], [t("assigned"), counts.assigned], [t("connected"), counts.connected], [t("closed"), counts.closed]];
  return <Card data-slot="campaign-follow-up">
    <CardHeader className="flex flex-wrap items-center justify-between gap-3">
      <CardTitle><h2 className="text-base font-semibold">{t("title")}</h2></CardTitle>
      <Button asChild variant="outline" className="min-h-11 lg:min-h-9"><Link href={`/workspaces/${tenantId}/connect/follow-up?campaign=${campaignId}`}>{t("openList")}</Link></Button>
    </CardHeader>
    <CardContent className="space-y-4">
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t("countsLabel")}>
        {stats.map(([label, value]) => <li key={label} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums">{value}</p></li>)}
      </ul>
      <section aria-labelledby="campaign-follow-up-team" className="space-y-2">
        <h3 id="campaign-follow-up-team" className="text-sm font-semibold">{t("team")}</h3>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {team.length ? <ul className="flex flex-wrap gap-2">{team.map((id) => {
          // Someone whose role was later lowered stays on the team (it grants nothing; assignment re-checks) until removed here.
          const name = names.get(id) ?? t("aMember");
          return <li key={id} className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 text-sm">
            <span className="min-w-0 break-words">{name}</span>
            <Button type="button" variant="ghost" size="icon" className="size-11 lg:size-8" disabled={saving === id} aria-label={t("remove", { name })}
              onClick={() => void change(id, false)}><X className="size-4" aria-hidden="true" /></Button>
          </li>;
        })}</ul> : <p className="text-sm text-muted-foreground">{t("noTeam")}</p>}
        <SearchableSelect id="campaign-follow-up-add" value={undefined} ariaLabel={t("add")} placeholder={t("add")} searchLabel={t("search")} emptyLabel={t("noMatch")}
          className="w-full sm:w-72" options={members.filter((member) => !onTeam.has(member.id)).map((member) => ({ value: member.id, label: member.name }))}
          onChange={(value) => { if (value && saving === null) void change(value, true); }} />
      </section>
    </CardContent>
  </Card>;
}
