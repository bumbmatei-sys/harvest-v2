"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormSection } from "@/components/form-section";
import { useCrmRequest } from "@/components/crm/request";
import { ReviewChecklist } from "@/components/newsletter/review-checklist";
import { ReviewStatus, type StatusAction } from "@/components/newsletter/review-status";
import { ReviewSummary } from "@/components/newsletter/review-summary";
import { ScheduleTimePicker } from "@/components/newsletter/schedule-time-picker";
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

  const checkText = (item: Item) => item.id === "imageAlt" ? c(`imageAlt.${item.level === "pass" ? "pass" : "warn"}`, { count: checks.find((x) => x.id === "imageAlt")?.count ?? 0 })
    : t(`items.${item.id}.${item.level}` as "items.audience.pass", { count: checks.find((x) => x.id === item.id)?.count ?? 0 });
  const scheduledParts = (iso: string) => {
    try {
      const at = new Date(iso);
      return { date: new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(at),
        time: new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(at) };
    } catch { return { date: iso.slice(0, 10), time: iso.slice(11, 16) }; }
  };
  const statusActions: StatusAction[] = [
    ...(scheduled && !changing ? [{ id: "change" as const, label: t("changeTime"), onClick: () => setChanging(true) }] : []),
    ...(scheduled ? [{ id: "cancel" as const, label: t("cancelSchedule"), onClick: () => setCancelOpen(true) }] : []),
    ...(finished ? [{ id: "duplicate" as const, label: t("duplicate"), onClick: () => void duplicate(), disabled: working }] : []),
  ];
  const share = estimate?.selected ? Math.round((estimate.eligible / estimate.selected) * 100) : 0;
  const recipientText = !listIds.length ? t("noAudience") : failed ? t("countFailed") : !estimate ? t("counting") : t("count", { eligible: estimate.eligible, selected: estimate.selected });

  return <div className="space-y-6" data-review-step>
    <Alert data-sending-off><AlertTitle>{t("offTitle")}</AlertTitle><AlertDescription>{t("offBody")}</AlertDescription></Alert>
    {error && <Alert variant="destructive" role="alert" data-review-error><AlertDescription>{error}</AlertDescription></Alert>}

    {(scheduled || finished) && <ReviewStatus title={t("statusTitle")} state={dispatch.state} stateLabel={s(dispatch.state as "draft")}
      tone={scheduled ? "live" : dispatch.state === "cancelled" ? "off" : "warn"} moreLabel={t("moreActions")}
      description={scheduled ? t("queued") : dispatch.state === "cancelled" ? t("cancelledBody") : undefined}
      stats={scheduled && dispatch.scheduledAt ? [{ key: "date", label: t("statusDate"), value: scheduledParts(dispatch.scheduledAt).date },
        { key: "time", label: t("statusTime"), value: scheduledParts(dispatch.scheduledAt).time }, { key: "zone", label: t("statusZone"), value: zone }] : undefined}
      recipients={scheduled && estimate && listIds.length ? { label: t("recipients"), value: t("statusOf", { eligible: estimate.eligible, selected: estimate.selected }),
        percent: share, percentLabel: t("statusPercent", { percent: share }), progressLabel: t("recipientsProgress") } : undefined}
      actions={statusActions}>
      {scheduled && changing && <div className="space-y-3" data-change-time>
        <ScheduleTimePicker id="nl-new-at" legend={t("newTime")} timeLabel={t("newTimeOfDay")} describedBy="nl-new-at-zone" timeZone={zone} value={newAt} onChange={setNewAt} />
        <p id="nl-new-at-zone" className="text-sm text-muted-foreground">{t("zone", { zone })}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="min-h-11" aria-disabled={working || undefined} onClick={() => void reschedule()}>{working && <Spinner decorative />}{t("saveTime")}</Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setChanging(false)}>{t("keepTime")}</Button></div>
      </div>}
    </ReviewStatus>}

    <ReviewSummary title={t("summary")} status={!scheduled && !finished ? { label: blocking.length ? t("notReady") : t("ready"), ready: blocking.length === 0 } : undefined} details={[
      { key: "audience", label: t("audience"), value: names.length ? names.join(", ") : t("noAudience") },
      { key: "recipients", label: t("recipients"), value: recipientText, live: true },
      { key: "subject", label: t("subject"), value: subject.trim() || t("missing") },
      { key: "preheader", label: t("preheader"), value: preheader.trim() || t("missing") },
      { key: "from", label: t("from"), value: sender ? (sender.displayName ? t("fromValue", { name: sender.displayName, address: sender.address }) : sender.address) : t("missing") },
      { key: "replyTo", label: t("replyTo"), value: reply?.address ?? t("missing") },
      { key: "when", label: t("when"), value: scheduled && dispatch.scheduledAt ? t("scheduledFor", { when: formatScheduled(dispatch.scheduledAt, zone, locale), zone })
        : schedule ? t("scheduledFor", { when: formatScheduled(schedule.at, timeZone, locale), zone: timeZone }) : when.mode === "now" ? t("whenNow") : t("noTime") },
    ]} />

    {!scheduled && !finished && <ReviewChecklist title={t("checklist")} blocking={blocking.length} progressLabel={t("checklistProgress")}
      status={blocking.length ? t("blocking", { count: blocking.length }) : t("noBlocking")}
      items={items.map((item) => ({ id: item.id, level: item.level, text: checkText(item),
        fix: item.level === "pass" || !item.fix ? undefined : { label: t(`fix.${item.id}` as "fix.audience"), href: item.fix.href, onFix: item.fix.step ? () => onStep(item.fix!.step!) : undefined } }))} />}

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
