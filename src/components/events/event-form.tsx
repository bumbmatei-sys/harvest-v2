"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Users } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EditorShell } from "@/components/editor/editor-shell";
import { useEditorHosted } from "@/components/editor/editor-context";
import { EventBadges } from "@/components/events/event-card";
import { FormSection } from "@/components/form-section";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusBadge } from "@/components/status-badge";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { Textarea } from "@/components/ui/textarea";
import { WizardLayout } from "@/components/wizard-layout";
import { useCrmRequest } from "@/components/crm/request";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { eventSteps, fieldProblems, reminderPresets, saveBody, timeZoneOptions, type EventFields, type EventStep, type FieldProblem } from "@/lib/event-form";
import { fromLocalInput, type EventItem } from "@/lib/event-view";

type SaveResult = { outcome: "ok"; event: EventItem } | { outcome: "full" };
const same = (a: EventFields, b: EventFields) => (Object.keys(a) as (keyof EventFields)[]).every((key) => a[key] === b[key]);

/**
 * Create and edit an event in the shared editor: details, schedule, access, with the draft shown as members will see it.
 * `initial` is null for a new event (its id comes from the page, so a retried save is the same event). Saving, publishing and
 * cancelling go to the Events API; the form never decides who may do what.
 */
export function EventForm({ tenantId, eventId, initial, initialFields, listHref, rosterHref, now }: {
  tenantId: string; eventId: string; initial: EventItem | null; initialFields: EventFields; listHref: string; rosterHref: string | null; now: number;
}) {
  const t = useTranslations("Events"), request = useCrmRequest(), router = useRouter(), hosted = useEditorHosted();
  const [data, setData] = useState<EventItem | null>(initial), [saved, setSaved] = useState(initialFields), [fields, setFields] = useState(initialFields);
  const [step, setStep] = useState<EventStep>("details"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [stale, setStale] = useState(false);
  const [touched, setTouched] = useState(false), [confirmCancel, setConfirmCancel] = useState(false);
  const endpoint = `/api/workspaces/${tenantId}/events/${eventId}`;
  const cancelled = data?.status === "cancelled", dirty = !same(fields, saved);
  const problems = fieldProblems(fields), shown = (problem: FieldProblem) => touched && problems.includes(problem);
  const { destination, setDestination, leave } = useUnsavedChangesGuard(dirty || busy);
  const set = <K extends keyof EventFields>(key: K, value: EventFields[K]) => { setNotice(""); setFields((previous) => ({ ...previous, [key]: value })); };
  const zones = timeZoneOptions(fields.timeZone);
  const reminders = [...new Set([...reminderPresets, ...(fields.reminder ? [Number(fields.reminder)] : [])])].sort((a, b) => a - b);

  function fail(result: { status: number; error: string }) { setStale(result.status === 409); setError(result.error); }
  async function save(): Promise<EventItem | null> {
    setTouched(true);
    const body = saveBody(fields);
    if (!body) { setError(t("fixFields")); return null; }
    if (data && !dirty) return data;
    const result = await request<SaveResult>(endpoint, { method: "PUT", body: { version: data?.version ?? 0, ...body } });
    if (!result.ok) { fail(result); return null; }
    if (result.data.outcome === "full") { setError(t("capacityBelow")); setStep("access"); return null; }
    setData(result.data.event); setSaved(fields);
    return result.data.event;
  }
  async function run(action: "save" | "publish") {
    setBusy(true); setError(""); setNotice(""); setStale(false);
    const event = await save();
    if (event && action === "publish") {
      const result = await request<EventItem>(endpoint, { method: "PATCH", body: { action: "publish", version: event.version } });
      if (result.ok) { setData(result.data); setNotice(t("publishedNotice")); } else fail(result);
    } else if (event) setNotice(t("savedNotice"));
    if (event && !initial) router.replace(`${listHref}/${eventId}`);
    setBusy(false);
  }
  async function cancel() {
    if (!data) return;
    setBusy(true); setError(""); setStale(false);
    const result = await request<EventItem>(endpoint, { method: "PATCH", body: { action: "cancel", version: data.version } });
    if (result.ok) { setData(result.data); setNotice(t("cancelledNoticeOwner")); } else fail(result);
    setConfirmCancel(false); setBusy(false);
  }

  const done = { details: !!fields.title.trim(), schedule: !problems.includes("start") && !problems.includes("end") && !problems.includes("order"), access: !problems.includes("capacity") && !problems.includes("join") };
  const steps = eventSteps.map((id) => ({ id, label: t(`steps.${id}`), done: done[id], attention: touched && (id === "details" ? problems.includes("title") : id === "schedule" ? !done.schedule : !done.access) }));
  const status = data ? <StatusBadge tone={data.status === "published" ? "success" : data.status === "cancelled" ? "danger" : "pending"} label={t(`phases.${data.status === "published" ? "upcoming" : data.status}`)} dot /> : <StatusBadge tone="pending" label={t("phases.draft")} dot />;
  const title = data?.title || t("newEvent");
  const actions = <>
    {rosterHref && <Button asChild variant="outline" className="min-h-11"><Link href={rosterHref}><Users aria-hidden="true" />{t("roster")}</Link></Button>}
    {data && !cancelled && <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setConfirmCancel(true)}>{t("cancelEvent")}</Button>}
    {!cancelled && data?.status !== "published" && <Button type="button" className="min-h-11" disabled={busy} onClick={() => void run("publish")}>{t("publish")}</Button>}
  </>;
  const breadcrumb = <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><Link href={listHref}>{t("title")}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{title}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>;
  const sidebar = { typeLabel: t("typeLabel"), status: { kind: data?.status === "published" ? "live" as const : "draft" as const, label: t(`phases.${data?.status === "published" ? "upcoming" : data?.status ?? "draft"}`) },
    back: { href: listHref, label: t("title") }, dirty };
  const preview = <Card><CardContent className="space-y-2 pt-6">
    <p className="text-base font-semibold break-words">{fields.title.trim() || t("untitled")}</p>
    <p className="text-sm text-muted-foreground">{t("previewTime", { start: fields.startsAt.replace("T", " "), end: fields.endsAt.replace("T", " "), zone: fields.timeZone })}</p>
    {fields.capacity.trim() && !problems.includes("capacity") && <p className="text-sm text-muted-foreground">{t("seatsTotal", { count: Number(fields.capacity) })}</p>}
    {data && <EventBadges event={data} now={now} manage />}
    <Button className="min-h-11 w-full" disabled>{t("going")}</Button>
  </CardContent></Card>;
  const invalid = (problem: FieldProblem) => shown(problem) || undefined;
  const message = (problem: FieldProblem, key: "titleRequired" | "invalidStart" | "invalidEnd" | "endBeforeStart" | "invalidCapacity" | "invalidLink") => shown(problem) && <FieldError>{t(key)}</FieldError>;

  return <EditorShell breadcrumb={breadcrumb} title={title} status={status} actions={actions} steps={steps} current={step} onStep={(id) => setStep(id as EventStep)}
    stepsLabel={t("stepsLabel")} previewLabel={t("preview")} sidebar={sidebar} preview={preview}>
    {cancelled && <Alert role="status"><AlertDescription>{t("readOnlyCancelled")}</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{error}{stale && <Button type="button" variant="outline" className="min-h-11" onClick={() => location.reload()}>{t("reload")}</Button>}</AlertDescription></Alert>}
    {notice && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
    <WizardLayout steps={steps} current={step} onStepChange={(id) => setStep(id as EventStep)} stepsLabel={t("stepsLabel")} stepper={false} focusOnStepChange={hosted}>
      {step === "details" && <FormSection title={<span className="sr-only">{t("steps.details")}</span>}>
        <Field data-invalid={invalid("title")}><FieldLabel htmlFor="event-title">{t("fieldTitle")}</FieldLabel>
          <Input id="event-title" className="min-h-11" value={fields.title} maxLength={120} required disabled={cancelled} aria-invalid={invalid("title")} onChange={(e) => set("title", e.target.value)} />{message("title", "titleRequired")}</Field>
        <Field><FieldLabel htmlFor="event-description">{t("fieldDescription")}</FieldLabel>
          <Textarea id="event-description" rows={5} value={fields.description} maxLength={4000} disabled={cancelled} onChange={(e) => set("description", e.target.value)} /></Field>
      </FormSection>}
      {step === "schedule" && <FormSection title={<span className="sr-only">{t("steps.schedule")}</span>}>
        <Field><FieldLabel htmlFor="event-zone">{t("fieldTimeZone")}</FieldLabel>
          <NativeSelect id="event-zone" className="min-h-11 w-full" value={fields.timeZone} disabled={cancelled} onChange={(e) => {
            const zone = e.target.value, start = fromLocalInput(fields.startsAt, fields.timeZone), end = fromLocalInput(fields.endsAt, fields.timeZone);
            // Keep the same instants when the zone changes, so the wall clock follows the zone and nothing moves silently.
            setNotice(""); setFields((previous) => ({ ...previous, timeZone: zone,
              startsAt: start ? new Intl.DateTimeFormat("sv-SE", { timeZone: zone, dateStyle: "short", timeStyle: "short" }).format(new Date(start)).replace(" ", "T") : previous.startsAt,
              endsAt: end ? new Intl.DateTimeFormat("sv-SE", { timeZone: zone, dateStyle: "short", timeStyle: "short" }).format(new Date(end)).replace(" ", "T") : previous.endsAt }));
          }}>{zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</NativeSelect></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={invalid("start")}><FieldLabel htmlFor="event-start">{t("fieldStart")}</FieldLabel>
            <Input id="event-start" type="datetime-local" className="min-h-11" value={fields.startsAt} required disabled={cancelled} aria-invalid={invalid("start")} onChange={(e) => set("startsAt", e.target.value)} />{message("start", "invalidStart")}</Field>
          <Field data-invalid={invalid("end") ?? invalid("order")}><FieldLabel htmlFor="event-end">{t("fieldEnd")}</FieldLabel>
            <Input id="event-end" type="datetime-local" className="min-h-11" value={fields.endsAt} required disabled={cancelled} aria-invalid={invalid("end") ?? invalid("order")} onChange={(e) => set("endsAt", e.target.value)} />
            {message("end", "invalidEnd")}{message("order", "endBeforeStart")}</Field>
        </div>
      </FormSection>}
      {step === "access" && <FormSection title={<span className="sr-only">{t("steps.access")}</span>}>
        <Field data-invalid={invalid("join")}><FieldLabel htmlFor="event-join">{t("fieldJoinLink")}</FieldLabel>
          <Input id="event-join" type="url" inputMode="url" className="min-h-11" value={fields.joinUrl} maxLength={2048} placeholder={t("joinPlaceholder")} disabled={cancelled} aria-invalid={invalid("join")} onChange={(e) => set("joinUrl", e.target.value)} />{message("join", "invalidLink")}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={invalid("capacity")}><FieldLabel htmlFor="event-capacity">{t("fieldCapacity")}</FieldLabel>
            <Input id="event-capacity" inputMode="numeric" className="min-h-11" value={fields.capacity} placeholder={t("noLimit")} disabled={cancelled} aria-invalid={invalid("capacity")} onChange={(e) => set("capacity", e.target.value.replace(/\D/g, "").slice(0, 9))} />{message("capacity", "invalidCapacity")}</Field>
          <Field><FieldLabel htmlFor="event-reminder">{t("fieldReminder")}</FieldLabel>
            <NativeSelect id="event-reminder" className="min-h-11 w-full" value={fields.reminder} disabled={cancelled} onChange={(e) => set("reminder", e.target.value)}>
              <option value="">{t("reminderOff")}</option>
              {reminders.map((minutes) => <option key={minutes} value={String(minutes)}>{t("reminderBefore", { minutes })}</option>)}</NativeSelect></Field>
        </div>
      </FormSection>}
    </WizardLayout>
    {!cancelled && <StickySaveBar guard={false} dirty={dirty || (!data && touched)} busy={busy && dirty} onSave={() => void run("save")} onDiscard={() => { setFields(saved); setError(""); setNotice(""); setTouched(false); }} saveLabel={t("saveDraft")} savingLabel={t("saving")} />}
    <ConfirmDialog tone="destructive" open={confirmCancel} onOpenChange={setConfirmCancel} title={t("cancelTitle")} description={t("cancelBody")} cancelLabel={t("keepEvent")} confirmLabel={t("cancelEvent")} onConfirm={cancel} />
    <ConfirmDialog tone="neutral" open={destination !== null} onOpenChange={(open) => { if (!open) setDestination(null); }} title={t("leaveTitle")} description={t("leaveBody")} cancelLabel={t("stay")} confirmLabel={t("leave")} onConfirm={leave} />
  </EditorShell>;
}
