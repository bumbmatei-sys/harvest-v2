"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useRequest } from "@/hooks/use-request";
import type { ChecklistItem } from "@/lib/campaign-wizard";

export type ChecklistRow = { item: ChecklistItem; done: boolean; automatic: boolean; doneAt: string | null };

/**
 * The post-creation setup checklist (PRD "Post-Creation Checklist"): the nine tasks still to do, ticked by hand and saved per item. Two of them tick
 * themselves when the campaign's departments already have leaders; those cannot be unticked here. Ticking records state only: nothing is created,
 * published or sent.
 */
export function CampaignChecklist({ tenantId, campaignId, initial }: { tenantId: string; campaignId: string; initial: ChecklistRow[] }) {
  const t = useTranslations("CampaignWizard.checklist"), request = useRequest();
  const [rows, setRows] = useState(initial), [error, setError] = useState(""), [saving, setSaving] = useState<string | null>(null);
  const done = rows.filter((row) => row.done).length;
  async function toggle(item: ChecklistItem, next: boolean) {
    setSaving(item); setError("");
    const result = await request<{ items: ChecklistRow[] }>(`/api/workspaces/${tenantId}/campaigns/${campaignId}/checklist`, { method: "PUT", body: { item, done: next } });
    setSaving(null);
    if (result.ok) setRows(result.data.items); else setError(result.error);
  }
  return <Card data-slot="campaign-checklist">
    <CardHeader><CardTitle><h2 className="text-base font-semibold">{t("title")}</h2></CardTitle><CardDescription>{t("description")}</CardDescription>
      <div className="flex items-center gap-3 pt-2"><Progress value={Math.round((done / rows.length) * 100)} aria-label={t("progress", { done, total: rows.length })} className="h-2 flex-1" />
        <span className="shrink-0 text-sm text-muted-foreground">{t("progress", { done, total: rows.length })}</span></div></CardHeader>
    <CardContent className="space-y-2">
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <ul className="space-y-2">{rows.map((row) => {
        const name = t(`items.${row.item}`), id = `checklist-${row.item}`;
        return <li key={row.item}><Label htmlFor={id} className="flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 font-normal">
          <Checkbox id={id} checked={row.done} disabled={row.automatic || saving === row.item} aria-label={row.done ? t("markNotDone", { item: name }) : t("markDone", { item: name })}
            onCheckedChange={(next) => void toggle(row.item, next === true)} />
          <span className={row.done ? "min-w-0 flex-1 text-muted-foreground line-through" : "min-w-0 flex-1"}>{name}</span>
          {row.automatic && <span className="shrink-0 text-xs text-muted-foreground">{t("automatic")}</span>}
        </Label></li>;
      })}</ul>
    </CardContent>
  </Card>;
}
