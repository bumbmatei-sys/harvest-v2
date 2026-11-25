"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Blocks, Check, CircleAlert, ClipboardCheck, FileText, MapPin, QrCode, Shapes, Users, Wallet, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Spinner } from "@/components/ui/spinner";
import { WizardLayout } from "@/components/wizard-layout";
import { EditorShell } from "@/components/editor/editor-shell";
import { useEditorHosted } from "@/components/editor/editor-context";
import { AccentIcon, accentVars } from "@/components/accent-icon";
import { campaignTypeAccent } from "@/components/campaigns/campaign-type-art";
import { BasicsStep, PlaceStep, TypeStep, type SetStep } from "@/components/campaigns/wizard-steps";
import { useRequest } from "@/hooks/use-request";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { wizardSteps, type WizardStep } from "@/lib/campaign-wizard";
import { adoptServer, dirtySteps, formFromDraft, isEditable, issuesOf, stepPayload, stepStatuses, type DraftView, type EditableStep } from "@/lib/campaign-wizard-form";

// Each step's mark beside its heading, tinted with the chosen type's accent (neutral until a type is picked).
const stepIcons: Record<WizardStep, LucideIcon> = {
  type: Shapes, basics: FileText, place: MapPin, leaders: Users, tools: Blocks, budget: Wallet, connect: QrCode, review: ClipboardCheck,
};

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
 * Only the person who started the draft edits it; an owner or admin who opens someone else's draft reads it and may discard it. Nothing here publishes
 * or sends anything.
 */
export function CampaignWizard({ tenantId, initial, viewerId, canDiscard, ownerName, listHref }: {
  tenantId: string; initial: DraftView; viewerId: string; canDiscard: boolean; ownerName: string; listHref: string;
}) {
  const t = useTranslations("CampaignWizard"), request = useRequest(), hosted = useEditorHosted();
  const endpoint = `/api/workspaces/${tenantId}/campaigns/drafts/${initial.id}`;
  const editable = initial.createdBy === viewerId;
  const [draft, setDraft] = useState(initial), [form, setForm] = useState(() => formFromDraft(initial));
  // Resume where the person left off, but never on a step that is not available yet.
  const [step, setStep] = useState<WizardStep>(() => { const at = wizardSteps[Math.min(Math.max(initial.currentStep, 1), wizardSteps.length) - 1]; return isEditable(at) ? at : "place"; });
  const [saveState, setSaveState] = useState<SaveState>("saved"), [error, setError] = useState(""), [attempted, setAttempted] = useState<Partial<Record<EditableStep, boolean>>>({});
  const [discarding, setDiscarding] = useState(false), [confirmLeave, setConfirmLeave] = useState(false);
  const formRef = useRef(form), draftRef = useRef(draft), locked = useRef(false), chain = useRef<Promise<boolean>>(Promise.resolve(true)), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const conflict = saveState === "conflict", disabled = !editable || conflict;

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
  const { destination, setDestination, leave } = useUnsavedChangesGuard(saveState !== "saved" && saveState !== "conflict");
  useEffect(() => {
    if (!destination) return;
    let live = true;
    void flush().then((ok) => { if (!live) return; if (ok) leave(); else setConfirmLeave(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination]);

  const issues = useMemo(() => issuesOf(form, draft), [form, draft]);
  const reached = Math.max(draft.currentStep, wizardSteps.indexOf(step) + 1);
  const statuses = stepStatuses(issues, reached);
  const payload = isEditable(step) ? stepPayload(step, form) : null;
  const problems = payload && !payload.ok && attempted[step as EditableStep] ? payload.problems : {};
  const shellSteps = wizardSteps.map((id) => ({ id, label: t(`steps.${id}`), done: statuses[id] === "done", attention: statuses[id] === "attention", disabled: !isEditable(id), badge: isEditable(id) ? undefined : t("comingSoon") }));
  const layoutSteps = shellSteps.map((entry) => ({ ...entry, description: isEditable(entry.id) ? t(`questions.${entry.id}`) : undefined, icon: <AccentIcon icon={stepIcons[entry.id]} /> }));
  const title = form.basics.name.trim() || t("untitled");

  async function validate(id: string) {
    const current = id as WizardStep;
    if (isEditable(current)) setAttempted((state) => ({ ...state, [current]: true }));
    if (disabled) return true;
    // A step that cannot be saved (an empty name, an end date before the start) stays put and shows why.
    if (isEditable(current) && !stepPayload(current, formRef.current).ok) return false;
    return flush();
  }
  async function discard() {
    const result = await request(`${endpoint}/discard`, { method: "POST", body: { version: draftRef.current.version } });
    if (!result.ok) { if (result.status !== 409) return result.error; stale(); setDiscarding(false); return; }
    locked.current = true; location.assign(listHref);
  }

  const body = isEditable(step) ? {
    type: <TypeStep form={form} set={set} disabled={disabled} problems={problems} />,
    basics: <BasicsStep form={form} set={set} disabled={disabled} problems={problems} />,
    place: <PlaceStep form={form} set={set} disabled={disabled} problems={problems} />,
  }[step] : null;
  const breadcrumb = <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><Link href={listHref}>{t("draftBack")}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbPage>{title}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>;
  const sidebar = { typeLabel: t("typeLabel"), status: { kind: "draft" as const, label: t("status.draft") }, back: { href: listHref, label: t("draftBack") }, dirty: saveState !== "saved" };
  const actions = canDiscard && <ConfirmDialog tone="destructive" open={discarding} onOpenChange={setDiscarding} title={t("discardTitle")} description={t("discardBody")} cancelLabel={t("discardCancel")} confirmLabel={t("discardConfirm")}
    trigger={<Button variant="outline" className="min-h-11">{t("discard")}</Button>} onConfirm={discard} />;

  const accent = form.type ? campaignTypeAccent[form.type] : null;
  // The chosen type tints the wizard: the step chips, the accent line on the step card and the phone progress bar.
  return <div className="contents" data-campaign-accent={accent ?? undefined} style={accentVars(accent)}><EditorShell breadcrumb={breadcrumb} title={title} status={<><Badge variant="secondary">{t("status.draft")}</Badge>{editable && <SaveStatus state={saveState} />}</>} actions={actions}
    steps={shellSteps} current={step} onStep={(id) => setStep(id as WizardStep)} stepsLabel={t("stepsLabel")} previewLabel={t("stepsLabel")} sidebar={sidebar}>
    {!editable && <Alert><AlertDescription>{ownerName ? t("readOnly", { name: ownerName }) : t("readOnlyUnknown")}</AlertDescription></Alert>}
    {conflict && <Alert variant="destructive" role="alert"><AlertTitle>{t("conflictTitle")}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">{t("conflictBody")}<Button variant="outline" className="min-h-11" onClick={() => location.reload()}>{t("reload")}</Button></AlertDescription></Alert>}
    {error && !conflict && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{error}
      {saveState === "error" && <Button variant="outline" className="min-h-11" onClick={() => void flush()}>{t("retry")}</Button>}</AlertDescription></Alert>}
    <div onBlurCapture={() => { if (isEditable(step)) setAttempted((state) => (state[step] ? state : { ...state, [step]: true })); }}>
      <WizardLayout steps={layoutSteps} current={step} onStepChange={(id) => setStep(id as WizardStep)} stepsLabel={t("stepsLabel")} stepper={false} focusOnStepChange={hosted} validate={validate}>
        {body}
      </WizardLayout>
    </div>
    <ConfirmDialog tone="neutral" open={confirmLeave && destination !== null} onOpenChange={(open) => { if (!open) { setConfirmLeave(false); setDestination(null); } }}
      title={t("leaveTitle")} description={t("leaveBody")} cancelLabel={t("leaveStay")} confirmLabel={t("leaveGo")} onConfirm={leave} />
  </EditorShell></div>;
}
