"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Spinner } from "@/components/ui/spinner";
import { WizardLayout } from "@/components/wizard-layout";
import { EditorShell } from "@/components/editor/editor-shell";
import { EventCoverPicker, type CoverChange } from "@/components/events/event-cover-picker";
import { useEventCoverUrl } from "@/components/events/use-event-cover-url";
import { useEditorHosted } from "@/components/editor/editor-context";
import { BasicsStep, PlaceStep, TypeStep, type SetStep } from "@/components/campaigns/wizard-steps";
import { TeamsStep, type WizardPerson } from "@/components/campaigns/teams-step";
import { ToolsStep } from "@/components/campaigns/tools-step";
import { BudgetStep } from "@/components/campaigns/budget-step";
import { ConnectStep } from "@/components/campaigns/connect-step";
import { ReviewStep } from "@/components/campaigns/review-step";
import { useRequest } from "@/hooks/use-request";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { wizardSteps, type Issue, type WizardStep } from "@/lib/campaign-wizard";
import { adoptServer, dirtySteps, formFromDraft, isAvailable, isEditable, issuesOf, stepPayload, stepStatuses, type DraftView, type EditableStep, type InvitationView } from "@/lib/campaign-wizard-form";

type SaveState = "saved" | "saving" | "dirty" | "error" | "invalid" | "conflict";

/** The save state beside the title: a polite live region, so "Saved" is announced without moving focus. */
function SaveStatus({ state }: { state: SaveState }) {
  const t = useTranslations("CampaignWizard.save");
  const Icon = state === "saved" ? Check : state === "saving" ? null : CircleAlert;
  return <span role="status" aria-live="polite" data-save-state={state} className="inline-flex min-h-6 items-center gap-1.5 text-sm text-muted-foreground">
    {state === "saving" ? <Spinner decorative size="sm" /> : Icon && <Icon className="size-4" aria-hidden="true" />}{t(state === "dirty" ? "unsaved" : state)}</span>;
}

/**
 * The campaign wizard on the shared EditorShell and WizardLayout (steps 1 to 3 here; the rest are listed and not yet available). Each step autosaves on
 * its own after a short pause. The server checks the version: a change made elsewhere is a 409, shown as "changed elsewhere, reload". Next saves first.
 * Anyone in the ministry who can write campaigns edits and finishes an open draft (founder decision, 25 Nov); the creator stays its owner. Nothing here
 * publishes or sends anything.
 */
export function CampaignWizard({ tenantId, initial, canDiscard, listHref, people }: { tenantId: string; initial: DraftView; canDiscard: boolean; listHref: string; people: WizardPerson[] }) {
  const t = useTranslations("CampaignWizard"), request = useRequest(), hosted = useEditorHosted(), router = useRouter();
  const endpoint = `/api/workspaces/${tenantId}/campaigns/drafts/${initial.id}`;
  const [draft, setDraft] = useState(initial), [form, setForm] = useState(() => formFromDraft(initial));
  // Resume where the person left off, but never on a step that is not available yet.
  const [step, setStep] = useState<WizardStep>(() => { const at = wizardSteps[Math.min(Math.max(initial.currentStep, 1), wizardSteps.length) - 1]; return isAvailable(at) ? at : "tools"; });
  const [saveState, setSaveState] = useState<SaveState>("saved"), [error, setError] = useState(""), [attempted, setAttempted] = useState<Partial<Record<EditableStep, boolean>>>({});
  const [serverIssues, setServerIssues] = useState<Issue[]>([]), [finishing, setFinishing] = useState(false), [discarding, setDiscarding] = useState(false), [coverBusy, setCoverBusy] = useState(false), [confirmLeave, setConfirmLeave] = useState(false);
  const formRef = useRef(form), draftRef = useRef(draft), locked = useRef(false), chain = useRef<Promise<boolean>>(Promise.resolve(true)), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const conflict = saveState === "conflict", disabled = conflict;

  const stale = useCallback(() => { locked.current = true; setSaveState("conflict"); }, []);
  /** Save every step whose answers differ from the server's copy, one at a time so each PATCH carries the version the last one returned. */
  const save = useCallback(async (): Promise<boolean> => {
    if (locked.current) return false;
    const skipped = new Set<EditableStep>();
    for (let round = 0; round < 8; round++) {
      const before = formFromDraft(draftRef.current), next = dirtySteps(formRef.current, before).find((candidate) => !skipped.has(candidate));
      if (!next) break;
      const payload = stepPayload(next, formRef.current);
      if (!payload.ok) { skipped.add(next); setAttempted((current) => ({ ...current, [next]: true })); continue; }
      setSaveState("saving"); setError("");
      const result = await request<DraftView>(endpoint, { method: "PATCH", body: { version: draftRef.current.version, step: next, data: payload.data } });
      if (!result.ok) {
        if (result.status === 409) stale(); else { setError(result.error); setSaveState("error"); }
        return false;
      }
      draftRef.current = result.data; setDraft(result.data);
      const merged = adoptServer(formRef.current, before, formFromDraft(result.data), next);
      formRef.current = merged; setForm(merged);
    }
    if (skipped.size) { setSaveState("invalid"); return false; }
    setSaveState("saved");
    return true;
  }, [endpoint, request, stale]);
  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    const run = chain.current.then(save);
    chain.current = run.catch(() => false);
    return run;
  }, [save]);
  const set: SetStep = (_step, update, delay = 800) => {
    if (disabled) return;
    const next = update(formRef.current);
    formRef.current = next; setForm(next); setSaveState("dirty"); setError("");
    clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), delay);
  };
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") void flush(); };
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); clearTimeout(timer.current); };
  }, [flush]);

  // Leaving the page saves first; only a save that cannot complete asks.
  const { destination, setDestination, leave } = useUnsavedChangesGuard((saveState !== "saved" && saveState !== "conflict") || coverBusy);
  useEffect(() => {
    if (!destination) return;
    let live = true;
    void flush().then((ok) => { if (!live) return; if (ok) leave(); else setConfirmLeave(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination]);

  // The cover saves on its own requests and moves the draft's version, so the next autosave must carry the new one.
  const cover = useEventCoverUrl(endpoint, draft.coverFileId);
  const coverChanged = ({ coverFileId, version }: CoverChange) => { const next = { ...draftRef.current, coverFileId, version }; draftRef.current = next; setDraft(next); };
  // Invitations are their own requests and do not move the draft's version; a person accepting elsewhere shows up when the page is visible again.
  const setInvitations = useCallback((invitations: InvitationView[]) => { const next = { ...draftRef.current, invitations }; draftRef.current = next; setDraft(next); }, []);
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const result = await request<DraftView>(endpoint, { method: "GET" });
      if (result.ok) { const next = { ...draftRef.current, invitations: result.data.invitations, assignments: result.data.assignments }; draftRef.current = next; setDraft(next); }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [endpoint, request]);
  const issues = useMemo(() => issuesOf(form, draft), [form, draft]);
  const reached = Math.max(draft.currentStep, wizardSteps.indexOf(step) + 1);
  const statuses = stepStatuses(issues, reached);
  const payload = isEditable(step) ? stepPayload(step, form) : null;
  const problems = payload && !payload.ok && attempted[step as EditableStep] ? payload.problems : {};
  const shellSteps = wizardSteps.map((id) => ({ id, label: t(`steps.${id}`), done: statuses[id] === "done", attention: statuses[id] === "attention", disabled: !isAvailable(id), badge: isAvailable(id) ? undefined : t("comingSoon") }));
  const layoutSteps = shellSteps.map((entry) => ({ ...entry, description: isAvailable(entry.id) ? t(`questions.${entry.id}` as "questions.type") : undefined }));
  const title = form.basics.name.trim() || t("untitled");

  async function validate(id: string) {
    const current = id as WizardStep;
    if (isEditable(current)) setAttempted((state) => ({ ...state, [current]: true }));
    if (disabled) return true;
    // A step that cannot be saved (an empty name, an end date before the start) stays put and shows why.
    if (isEditable(current) && !stepPayload(current, formRef.current).ok) return false;
    return flush();
  }
  /** Finish: save, then ask the server to create the campaign once. A second press, a retry or another tab ends at the same campaign. */
  async function finish() {
    setError(""); setServerIssues([]);
    if (disabled || !await flush()) return;
    if (issuesOf(formRef.current, draftRef.current).length) return;
    setFinishing(true);
    const result = await request<{ campaignId: string }>(`${endpoint}/finish`, { method: "POST", body: { version: draftRef.current.version } });
    if (result.ok) { locked.current = true; router.push(`/workspaces/${tenantId}/campaigns/${result.data.campaignId}`); return; }
    setFinishing(false);
    if (result.status === 409) { stale(); return; }
    if (result.status === 400 && typeof result.details?.issues === "string") {
      setServerIssues(result.details.issues.split(",").map((entry) => { const [step, code] = entry.split(":"); return { step, code } as Issue; })); return;
    }
    setError(result.error);
  }
  async function discard() {
    const result = await request(`${endpoint}/discard`, { method: "POST", body: { version: draftRef.current.version } });
    if (!result.ok) { if (result.status !== 409) return result.error; stale(); setDiscarding(false); return; }
    locked.current = true; location.assign(listHref);
  }

  const body = step === "review" ? <ReviewStep form={form} draft={draft} people={people} issues={issues} serverIssues={serverIssues} onEdit={(id) => setStep(id)} /> : isEditable(step) ? {
    type: <TypeStep form={form} set={set} disabled={disabled} problems={problems} />,
    basics: <BasicsStep form={form} set={set} disabled={disabled} problems={problems} cover={
      <EventCoverPicker endpoint={endpoint} saved coverFileId={draft.coverFileId} version={draft.version} url={cover.url} onUrlFailed={cover.failed} onChange={coverChanged}
        onBusyChange={setCoverBusy} disabled={disabled || saveState === "saving" || saveState === "dirty"} namespace="CampaignWizard.cover" />} />,
    place: <PlaceStep form={form} set={set} disabled={disabled} problems={problems} />,
    leaders: <TeamsStep form={form} set={set} disabled={disabled} draft={draft} people={people} endpoint={endpoint} saveNow={flush} onInvitations={setInvitations} />,
    tools: <ToolsStep form={form} set={set} disabled={disabled} type={form.type} />,
    budget: <BudgetStep form={form} set={set} disabled={disabled} problems={problems} onEdit={(id) => setStep(id)} />,
    connect: <ConnectStep form={form} set={set} disabled={disabled} onEdit={(id) => setStep(id)} />,
  }[step] : null;
  const breadcrumb = <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><Link href={listHref}>{t("draftBack")}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbPage>{title}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>;
  const sidebar = { typeLabel: t("typeLabel"), status: { kind: "draft" as const, label: t("status.draft") }, back: { href: listHref, label: t("draftBack") }, dirty: saveState !== "saved" };
  const actions = canDiscard && <ConfirmDialog tone="destructive" open={discarding} onOpenChange={setDiscarding} title={t("discardTitle")} description={t("discardBody")} cancelLabel={t("discardCancel")} confirmLabel={t("discardConfirm")}
    trigger={<Button variant="outline" className="min-h-11">{t("discard")}</Button>} onConfirm={discard} />;

  return <EditorShell breadcrumb={breadcrumb} title={title} status={<><Badge variant="secondary">{t("status.draft")}</Badge><SaveStatus state={saveState} /></>} actions={actions}
    steps={shellSteps} current={step} onStep={(id) => setStep(id as WizardStep)} stepsLabel={t("stepsLabel")} previewLabel={t("stepsLabel")} sidebar={sidebar}>
    {conflict && <Alert variant="destructive" role="alert"><AlertTitle>{t("conflictTitle")}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">{t("conflictBody")}<Button variant="outline" className="min-h-11" onClick={() => location.reload()}>{t("reload")}</Button></AlertDescription></Alert>}
    {error && !conflict && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{error}
      {saveState === "error" && <Button variant="outline" className="min-h-11" onClick={() => void flush()}>{t("retry")}</Button>}</AlertDescription></Alert>}
    <div onBlurCapture={() => { if (isEditable(step)) setAttempted((state) => (state[step] ? state : { ...state, [step]: true })); }}>
      <WizardLayout steps={layoutSteps} current={step} onStepChange={(id) => setStep(id as WizardStep)} stepsLabel={t("stepsLabel")} stepper={false} focusOnStepChange={hosted} validate={validate} onFinish={step === "review" ? finish : undefined} busy={finishing} finishLabel={t("review.finish")}>
        {body}
      </WizardLayout>
    </div>
    <ConfirmDialog tone="neutral" open={confirmLeave && destination !== null} onOpenChange={(open) => { if (!open) { setConfirmLeave(false); setDestination(null); } }}
      title={t("leaveTitle")} description={t("leaveBody")} cancelLabel={t("leaveStay")} confirmLabel={t("leaveGo")} onConfirm={leave} />
  </EditorShell>;
}
