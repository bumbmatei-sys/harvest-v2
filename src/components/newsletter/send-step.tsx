"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FormSection } from "@/components/form-section";
import { ScheduleTimePicker } from "@/components/newsletter/schedule-time-picker";
import { useCrmRequest } from "@/components/crm/request";
import type { InboxCheck } from "@/lib/email/inbox-check";

export type ListOption = { id: string; name: string; audienceId: string };
export type SenderOption = { id: string; address: string; displayName?: string | null };
export type Estimate = { selected: number; eligible: number; skipped: Record<string, number> };
export type When = { mode: "now" | "later"; at: string };

/** Live recipient estimate for a selection (debounced). `null` while counting or with no list; "error" when the count failed. */
export function useRecipientEstimate(tenantId: string, listIds: string[], segmentIds: string[]) {
  const request = useCrmRequest();
  const [estimate, setEstimate] = useState<Estimate | null>(null), [state, setState] = useState<"idle" | "error">("idle");
  const selection = JSON.stringify([listIds, segmentIds]);
  useEffect(() => {
    if (listIds.length === 0) return;
    let live = true;
    const timer = setTimeout(async () => {
      const result = await request<Estimate>(`/api/workspaces/${tenantId}/newsletter/recipient-estimate`, { method: "POST", body: { listIds, segmentIds } });
      if (!live) return;
      if (result.ok) { setEstimate(result.data); setState("idle"); } else setState("error");
    }, 350);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, tenantId, request]);
  return { estimate: listIds.length ? estimate : null, failed: state === "error" };
}

/** Send step: who (lists and saved groups with a live count), when (in the ministry's time zone), from and reply-to, and the inbox check. Review and scheduling follow in the Review step. */
export function SendStep({ tenantId, lists, groups, senders, listIds, segmentIds, senderId, replyToId, onSelection, onIdentity, subject, checks, when, onWhen, timeZone, onReview }: {
  tenantId: string; lists: ListOption[]; groups: ListOption[]; senders: SenderOption[]; listIds: string[]; segmentIds: string[]; senderId: string | null; replyToId: string | null;
  onSelection: (listIds: string[], segmentIds: string[]) => void; onIdentity: (key: "senderId" | "replyToId", id: string | null) => void; subject: string; checks: InboxCheck[];
  when: When; onWhen: (when: When) => void; timeZone: string; onReview: () => void;
}) {
  const t = useTranslations("NewsletterCampaigns.send"), c = useTranslations("NewsletterCampaigns.checks");
  const { estimate, failed } = useRecipientEstimate(tenantId, listIds, segmentIds);
  const state = failed ? "error" : "idle";

  const toggleList = (id: string, on: boolean) => {
    const next = on ? [...listIds, id] : listIds.filter((x) => x !== id);
    const audiences = new Set(lists.filter((l) => next.includes(l.id)).map((l) => l.audienceId));
    onSelection(next, segmentIds.filter((s) => audiences.has(groups.find((g) => g.id === s)?.audienceId ?? "")));
  };
  const toggleGroup = (id: string, on: boolean) => onSelection(listIds, on ? [...segmentIds, id] : segmentIds.filter((x) => x !== id));
  const skipped = estimate ? Object.values(estimate.skipped).reduce((n, v) => n + (v ?? 0), 0) : 0;
  const icon = (level: InboxCheck["level"]) => level === "pass" ? <CircleCheck className="size-4 text-primary" aria-hidden="true" /> : level === "warn" ? <TriangleAlert className="size-4 text-foreground" aria-hidden="true" /> : <CircleAlert className="size-4 text-destructive" aria-hidden="true" />;
  const senderHref = `/workspaces/${tenantId}/newsletter/sender`;

  return <div className="space-y-6" data-send-step>
    <FormSection title={t("who")}>
      <fieldset className="space-y-1"><legend className="mb-1 text-sm font-medium">{t("lists")}</legend>
        {lists.length === 0 && <p className="text-sm text-muted-foreground">{t("noLists")}</p>}
        {lists.map((l) => <Label key={l.id} className="flex min-h-11 items-center gap-3 font-normal"><Checkbox checked={listIds.includes(l.id)} onCheckedChange={(v) => toggleList(l.id, v === true)} />{l.name}</Label>)}</fieldset>
      {groups.length > 0 && <fieldset className="space-y-1"><legend className="mb-1 text-sm font-medium">{t("groups")}</legend>
        {groups.map((g) => { const allowed = lists.some((l) => listIds.includes(l.id) && l.audienceId === g.audienceId);
          return <Label key={g.id} className="flex min-h-11 items-center gap-3 font-normal"><Checkbox disabled={!allowed} checked={segmentIds.includes(g.id)} onCheckedChange={(v) => toggleGroup(g.id, v === true)} />{g.name}</Label>; })}</fieldset>}
      <div role="status" aria-live="polite" className="rounded-lg border bg-muted/30 p-3 text-sm" data-recipient-count>
        {listIds.length === 0 ? t("chooseList") : state === "error" ? t("countFailed") : !estimate ? t("counting")
          : estimate && <><p className="font-medium">{t("count", { eligible: estimate.eligible, selected: estimate.selected })}</p>{skipped > 0 && <p className="text-muted-foreground">{t("skipped", { count: skipped })}</p>}</>}
        <p className="mt-1 text-muted-foreground">{t("autoSkip")}</p></div>
    </FormSection>
    <FormSection title={t("when")}>
      <RadioGroup value={when.mode} onValueChange={(v) => onWhen({ ...when, mode: v as "now" | "later" })} className="gap-1">
        <Label className="flex min-h-11 items-center gap-3 font-normal"><RadioGroupItem value="now" />{t("now")}</Label>
        <Label className="flex min-h-11 items-center gap-3 font-normal"><RadioGroupItem value="later" />{t("pickTime")}</Label></RadioGroup>
      {when.mode === "later" && <div className="space-y-2"><ScheduleTimePicker id="nl-at" legend={t("time")} timeLabel={t("timeOfDay")} describedBy="nl-at-zone" timeZone={timeZone} value={when.at} onChange={(at) => onWhen({ ...when, at })} />
        <p id="nl-at-zone" className="text-sm text-muted-foreground" data-time-zone>{t("zone", { zone: timeZone })}</p></div>}
    </FormSection>
    <FormSection title={t("summary")}>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {(["senderId", "replyToId"] as const).map((key) => <div key={key} className="space-y-1"><dt><Label htmlFor={`nl-${key}`}>{t(key === "senderId" ? "from" : "replyTo")}</Label></dt>
          <dd><NativeSelect id={`nl-${key}`} className="w-full" value={(key === "senderId" ? senderId : replyToId) ?? ""} onChange={(e) => onIdentity(key, e.target.value || null)}>
            <NativeSelectOption value="">{t("noSender")}</NativeSelectOption>{senders.map((s) => <NativeSelectOption key={s.id} value={s.id}>{s.displayName ? t("senderOption", { name: s.displayName, address: s.address }) : s.address}</NativeSelectOption>)}</NativeSelect></dd></div>)}
        <div><dt className="text-muted-foreground">{t("subject")}</dt><dd className="font-medium">{subject}</dd></div>
        <div><dt className="text-muted-foreground">{t("recipients")}</dt><dd className="font-medium">{estimate && listIds.length > 0 ? t("count", { eligible: estimate.eligible, selected: estimate.selected }) : t("pending")}</dd></div>
      </dl>
      {senders.length === 0 && <p className="text-sm"><Link href={senderHref} className="underline underline-offset-4" data-sender-link>{t("setUpSender")}</Link></p>}
    </FormSection>
    <FormSection title={t("inbox")}>
      <ul className="space-y-2" data-inbox-check>{checks.map((check) => { const text = c(`${check.id}.${check.level}` as "subject.pass", { count: check.count ?? 0 });
        return text ? <li key={check.id} className="flex items-start gap-2 text-sm" data-check={check.id} data-level={check.level}>{icon(check.level)}<span>{text}{check.id === "address" && check.level === "fail" && <> <Link href={senderHref} className="underline underline-offset-4" data-sender-link>{t("openSender")}</Link></>}</span></li> : null; })}</ul>
    </FormSection>
    <div className="flex flex-wrap gap-2">
      <Button type="button" className="min-h-11" onClick={onReview} data-review-button>{t("continue")}</Button>
    </div>
  </div>;
}
