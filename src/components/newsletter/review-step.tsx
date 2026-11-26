"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, CircleAlert, CircleCheck, Send, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormSection } from "@/components/form-section";
import { StatusBadge } from "@/components/status-badge";
import { useCrmRequest } from "@/components/crm/request";
import { useRecipientEstimate, type ListOption, type SenderOption, type When } from "@/components/newsletter/send-step";
import type { InboxCheck } from "@/lib/email/inbox-check";
import { formatScheduled, NEWSLETTER_SCHEDULE_HORIZON_MS, scheduleInputValue, zonedSchedule } from "@/lib/newsletter-schedule";

export type Dispatch = { state: string; version: number; scheduledAt: string | null; timezone: string | null; frozenAt: string | null };
export type TestResult = { ok: boolean; at: number } | null;
type Review = { token: string; version: number; expiresAt: string; estimate: { selected: number; eligible: number } };
type Item = { id: string; level: "pass" | "warn" | "fail"; fix?: { step?: "write" | "send"; href?: string } };

/** Fixed server conflict codes the screen explains; anything else shows the catalogue message from the server. */
const knownCodes = ["IDENTITY_REQUIRED", "IDENTITY_UNVERIFIED", "SELECTION_REQUIRED", "SELECTION_CHANGED", "SCHEDULE_IN_PAST", "SCHEDULE_TOO_FAR",
  "MAILING_ADDRESS_REQUIRED", "STALE_VERSION", "REVIEW_REQUIRED", "NOT_RESCHEDULABLE"] as const;

/**
 * Review before sending: what goes out (audience and count, subject, preview text, from), a checklist of blocking problems with a way to fix
 * each, the last test send, and scheduling. Sending is off: a scheduled email is queued and nobody receives it, which the screen says plainly.
 * Scheduling runs the server review (a one-use token for this exact revision, recipients and time) and asks for confirmation before it queues.
 */
export function ReviewStep({ tenantId, campaignId, campaignName, lists, groups, senders, listIds, segmentIds, senderId, replyToId, subject, preheader, checks, when, timeZone,
  dispatch, onDispatch, testResult, onSendTest, onStep, beforeReview, busy }: {
  tenantId: string; campaignId: string; campaignName: string; lists: ListOption[]; groups: ListOption[]; senders: SenderOption[]; listIds: string[]; segmentIds: string[];
  senderId: string | null; replyToId: string | null; subject: string; preheader: string; checks: InboxCheck[]; when: When; timeZone: string;
  dispatch: Dispatch; onDispatch: (next: Partial<Dispatch>) => void; testResult: TestResult; onSendTest: () => Promise<void>;
  onStep: (step: "write" | "send") => void; beforeReview: () => Promise<boolean>; busy: boolean;
}) {
  const t = useTranslations("NewsletterCampaigns.review"), c = useTranslations("NewsletterCampaigns.checks"), s = useTranslations("NewsletterCampaigns.status");
  const locale = useLocale(), request = useCrmRequest(), router = useRouter();
  const { estimate, failed } = useRecipientEstimate(tenantId, listIds, segmentIds);
  const [review, setReview] = useState<Review | null>(null), [working, setWorking] = useState(false), [error, setError] = useState("");
  const [testing, setTesting] = useState(false), [cancelOpen, setCancelOpen] = useState(false);
  const [changing, setChanging] = useState(false), [newAt, setNewAt] = useState(() => dispatch.scheduledAt ? scheduleInputValue(dispatch.scheduledAt, dispatch.timezone ?? timeZone) : "");
  // The clock for the time check, refreshed every 30 seconds so a time that passes while the screen is open turns into a problem.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const base = `/api/workspaces/${tenantId}/newsletter/campaigns/${campaignId}`;
  const audienceHref = `/workspaces/${tenantId}/newsletter/audience`, senderHref = `/workspaces/${tenantId}/newsletter/sender`;
  const zone = dispatch.timezone ?? timeZone;
  const sender = senders.find((x) => x.id === senderId), reply = senders.find((x) => x.id === replyToId);
  const names = [...lists.filter((l) => listIds.includes(l.id)), ...groups.filter((g) => segmentIds.includes(g.id))].map((x) => x.name);
  const schedule = when.mode === "later" ? zonedSchedule(when.at, timeZone) : null;
  const level = (id: InboxCheck["id"]) => checks.find((check) => check.id === id)?.level ?? "pass";
  const timeLevel = (at: string): Item["level"] => {
    const ms = Date.parse(at);
    return Number.isNaN(ms) || ms <= now || ms > now + NEWSLETTER_SCHEDULE_HORIZON_MS ? "fail" : "pass";
  };
  const items: Item[] = [
    { id: "audience", level: listIds.length ? "pass" : "fail", fix: { step: "send" } },
    { id: "recipients", level: !listIds.length || !estimate ? (failed ? "fail" : "warn") : estimate.eligible > 0 ? "pass" : "fail", fix: { href: audienceHref } },
    { id: "subject", level: level("subject") === "fail" ? "fail" : "pass", fix: { step: "write" } },
    { id: "content", level: level("content"), fix: { step: "write" } },
    { id: "links", level: level("links"), fix: { step: "write" } },
    { id: "address", level: level("address"), fix: { step: "write" } },
    { id: "unsubscribe", level: "pass" },
    { id: "sender", level: senderId && replyToId ? "pass" : "fail", fix: senders.length ? { step: "send" } : { href: senderHref } },
    { id: "time", level: when.mode === "now" ? "fail" : schedule ? timeLevel(schedule.at) : "fail", fix: { step: "send" } },
    { id: "preview", level: level("preview") === "pass" ? "pass" : "warn", fix: { step: "write" } },
    { id: "imageAlt", level: level("imageAlt"), fix: { step: "write" } },
  ];
  const blocking = items.filter((item) => item.level === "fail");
  const ready = blocking.length === 0 && !busy;
  const scheduled = dispatch.state === "scheduled", finished = !["draft", "reviewed", "scheduled"].includes(dispatch.state);

  const explain = (result: { error: string; details?: Record<string, string | number> }) => {
    const code = String(result.details?.code ?? "");
    return (knownCodes as readonly string[]).includes(code) ? t(`errors.${code}` as "errors.STALE_VERSION") : result.error;
  };

  async function startSchedule() {
    if (!schedule || working) return;
    setError(""); setWorking(true);
    try {
      if (!(await beforeReview())) { setError(t("errors.notSaved")); return; }
      const result = await request<Review>(`${base}/review`, { method: "POST", body: { version: dispatch.version, dispatch: { mode: "schedule", schedule } } });
      if (!result.ok) { setError(explain(result)); return; }
      onDispatch({ state: "reviewed", version: result.data.version });
      setReview(result.data);
    } finally { setWorking(false); }
  }
  async function confirmSchedule() {
    if (!review || !schedule) return;
    const result = await request<{ state: string; version: number; scheduledAt: string; timezone: string }>(`${base}/schedule`, { method: "POST",
      body: { version: review.version, token: review.token, dispatch: { mode: "schedule", schedule } } });
    if (!result.ok) { setReview(null); setError(explain(result)); return; }
    setReview(null);
    onDispatch({ state: result.data.state, version: result.data.version, scheduledAt: result.data.scheduledAt, timezone: result.data.timezone, frozenAt: new Date().toISOString() });
    setNewAt(scheduleInputValue(result.data.scheduledAt, result.data.timezone));
  }
  async function reschedule() {
    const next = zonedSchedule(newAt, zone);
    if (!next) { setError(t("errors.SCHEDULE_IN_PAST")); return; }
    setError(""); setWorking(true);
    const result = await request<{ version: number; scheduledAt: string; timezone: string }>(`${base}/reschedule`, { method: "POST", body: { version: dispatch.version, schedule: next } });
    setWorking(false);
    if (!result.ok) { setError(explain(result)); return; }
    onDispatch({ version: result.data.version, scheduledAt: result.data.scheduledAt, timezone: result.data.timezone });
    setChanging(false);
  }
  async function cancel(): Promise<string | void> {
    const result = await request<{ state: string; version: number }>(`${base}/cancel`, { method: "POST", body: { version: dispatch.version } });
    if (!result.ok) return explain(result);
    onDispatch({ state: result.data.state, version: result.data.version });
  }
  async function duplicate() {
    setWorking(true);
    const result = await request<{ id: string }>(`${base}/duplicate`, { method: "POST", body: { name: t("copyName", { name: campaignName }).slice(0, 100) } });
    setWorking(false);
    if (result.ok) router.push(`/workspaces/${tenantId}/newsletter/campaigns/${result.data.id}`); else setError(explain(result));
  }
  async function test() { setTesting(true); try { await onSendTest(); } finally { setTesting(false); } }

  const icon = (value: Item["level"]) => value === "pass" ? <CircleCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
    : value === "warn" ? <TriangleAlert className="size-4 shrink-0 text-foreground" aria-hidden="true" /> : <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />;
  const fixControl = (item: Item) => item.level === "pass" || !item.fix ? null : item.fix.href
    ? <Link href={item.fix.href} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" data-fix={item.id}>{t(`fix.${item.id}` as "fix.audience")}</Link>
    : <Button type="button" variant="link" className="min-h-11 px-0" data-fix={item.id} onClick={() => onStep(item.fix!.step!)}>{t(`fix.${item.id}` as "fix.audience")}</Button>;
  const checkText = (item: Item) => item.id === "imageAlt" ? c(`imageAlt.${item.level === "pass" ? "pass" : "warn"}`, { count: checks.find((x) => x.id === "imageAlt")?.count ?? 0 })
    : t(`items.${item.id}.${item.level}` as "items.audience.pass", { count: checks.find((x) => x.id === item.id)?.count ?? 0 });
  const recipientText = !listIds.length ? t("noAudience") : failed ? t("countFailed") : !estimate ? t("counting") : t("count", { eligible: estimate.eligible, selected: estimate.selected });

  return <div className="space-y-6" data-review-step>
    <Alert data-sending-off><AlertTitle>{t("offTitle")}</AlertTitle><AlertDescription>{t("offBody")}</AlertDescription></Alert>
    {error && <Alert variant="destructive" role="alert" data-review-error><AlertDescription>{error}</AlertDescription></Alert>}

    {(scheduled || finished) && <FormSection title={t("statusTitle")}>
      <div className="space-y-3 rounded-lg border p-4" data-dispatch-state={dispatch.state}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={scheduled ? "info" : dispatch.state === "cancelled" ? "neutral" : "warning"} label={s(dispatch.state as "draft")} dot />
          {scheduled && dispatch.scheduledAt && <span className="text-sm font-medium" data-scheduled-at>{t("scheduledFor", { when: formatScheduled(dispatch.scheduledAt, zone, locale), zone })}</span>}
        </div>
        {scheduled && <p className="text-sm text-muted-foreground">{t("queued")}</p>}
        {dispatch.state === "cancelled" && <p className="text-sm text-muted-foreground">{t("cancelledBody")}</p>}
        {scheduled && changing && <div className="space-y-2">
          <Label htmlFor="nl-new-at">{t("newTime")}</Label>
          <Input id="nl-new-at" type="datetime-local" className="min-h-11 w-full sm:w-72" aria-describedby="nl-new-at-zone" value={newAt} onChange={(e) => setNewAt(e.target.value)} />
          <p id="nl-new-at-zone" className="text-sm text-muted-foreground">{t("zone", { zone })}</p>
        </div>}
        <div className="flex flex-wrap gap-2">
          {scheduled && !changing && <Button type="button" variant="outline" className="min-h-11" onClick={() => setChanging(true)}><CalendarClock aria-hidden="true" />{t("changeTime")}</Button>}
          {scheduled && changing && <>
            <Button type="button" className="min-h-11" aria-disabled={working || undefined} onClick={() => void reschedule()}>{working && <Spinner decorative />}{t("saveTime")}</Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setChanging(false)}>{t("keepTime")}</Button></>}
          {scheduled && <Button type="button" variant="outline" className="min-h-11" onClick={() => setCancelOpen(true)}>{t("cancelSchedule")}</Button>}
          {finished && <Button type="button" variant="outline" className="min-h-11" aria-disabled={working || undefined} onClick={() => void duplicate()}>{t("duplicate")}</Button>}
        </div>
      </div>
    </FormSection>}

    <FormSection title={t("summary")}>
      <dl className="grid gap-4 text-sm sm:grid-cols-2" data-review-summary>
        <div className="space-y-1"><dt className="text-muted-foreground">{t("audience")}</dt><dd className="font-medium" data-summary="audience">{names.length ? names.join(", ") : t("noAudience")}</dd></div>
        <div className="space-y-1"><dt className="text-muted-foreground">{t("recipients")}</dt><dd className="font-medium" data-summary="recipients" aria-live="polite">{recipientText}</dd></div>
        <div className="space-y-1"><dt className="text-muted-foreground">{t("subject")}</dt><dd className="font-medium break-words" data-summary="subject">{subject.trim() || t("missing")}</dd></div>
        <div className="space-y-1"><dt className="text-muted-foreground">{t("preheader")}</dt><dd className="font-medium break-words" data-summary="preheader">{preheader.trim() || t("missing")}</dd></div>
        <div className="space-y-1"><dt className="text-muted-foreground">{t("from")}</dt><dd className="font-medium break-words" data-summary="from">{sender ? (sender.displayName ? t("fromValue", { name: sender.displayName, address: sender.address }) : sender.address) : t("missing")}</dd></div>
        <div className="space-y-1"><dt className="text-muted-foreground">{t("replyTo")}</dt><dd className="font-medium break-words" data-summary="replyTo">{reply?.address ?? t("missing")}</dd></div>
        <div className="space-y-1 sm:col-span-2"><dt className="text-muted-foreground">{t("when")}</dt><dd className="font-medium" data-summary="when">
          {scheduled && dispatch.scheduledAt ? t("scheduledFor", { when: formatScheduled(dispatch.scheduledAt, zone, locale), zone })
            : schedule ? t("scheduledFor", { when: formatScheduled(schedule.at, timeZone, locale), zone: timeZone }) : when.mode === "now" ? t("whenNow") : t("noTime")}</dd></div>
      </dl>
    </FormSection>

    {!scheduled && !finished && <FormSection title={t("checklist")}>
      <ul className="divide-y rounded-lg border" data-review-checklist>
        {items.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm" data-item={item.id} data-level={item.level}>
          <span className="flex min-h-11 min-w-0 items-center gap-2">{icon(item.level)}<span>{checkText(item)}</span></span>{fixControl(item)}</li>)}
      </ul>
      <p role="status" className="text-sm font-medium" data-blocking={blocking.length}>{blocking.length ? t("blocking", { count: blocking.length }) : t("noBlocking")}</p>
    </FormSection>}

    <FormSection title={t("test")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" role="status" data-test-result={testResult ? (testResult.ok ? "sent" : "failed") : "none"}>
          {testResult ? (testResult.ok ? t("testSent", { time: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(testResult.at) }) : t("testFailed")) : t("testNone")}</p>
        <Button type="button" variant="outline" className="min-h-11" aria-disabled={testing || undefined} onClick={() => { if (!testing) void test(); }}>{testing ? <Spinner decorative /> : <Send aria-hidden="true" />}{t("sendTest")}</Button>
      </div>
    </FormSection>

    {!scheduled && !finished && <div className="flex flex-wrap items-center gap-2">
      {when.mode === "now"
        ? <Button type="button" className="min-h-11" disabled data-send-button>{t("sendNow")}</Button>
        : <Button type="button" className="min-h-11" disabled={!ready} aria-busy={working || undefined} onClick={() => void startSchedule()} data-schedule-button>{working && <Spinner decorative />}{t("schedule")}</Button>}
      <p className="text-sm text-muted-foreground">{when.mode === "now" ? t("nowOff") : !ready ? t("fixFirst") : t("scheduleHint")}</p>
    </div>}

    <ConfirmDialog open={review !== null} onOpenChange={(open) => { if (!open) setReview(null); }} tone="neutral" title={t("confirmTitle")}
      description={review && schedule ? t("confirmBody", { eligible: review.estimate.eligible, selected: review.estimate.selected, when: formatScheduled(schedule.at, timeZone, locale), zone: timeZone }) : undefined}
      confirmLabel={t("confirm")} cancelLabel={t("back")} busyLabel={t("scheduling")} onConfirm={confirmSchedule} />
    <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title={t("cancelTitle")} description={t("cancelDescription")} confirmLabel={t("cancelConfirm")} cancelLabel={t("keepScheduled")} onConfirm={cancel} />
  </div>;
}
