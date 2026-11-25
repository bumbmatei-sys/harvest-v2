"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Rocket } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EditorShell } from "@/components/editor/editor-shell";
import { useEditorHosted } from "@/components/editor/editor-context";
import { FormSection } from "@/components/form-section";
import { StatusBadge } from "@/components/status-badge";
import { WizardLayout } from "@/components/wizard-layout";
import { AdPreview } from "@/components/ads/ad-preview";
import { AdSetStep, AdStep, GoalStep } from "@/components/ads/ad-steps";
import { useAdsError } from "@/components/ads/ads-error";
import { useAdLookups } from "@/components/ads/use-ad-lookups";
import { adsApi, newKey, type LaunchRequestView } from "@/lib/ads/api";
import { emptyDraft, fromPayload, problems, stepsFor, toPayload, type CreateStep, type Draft, type Mode } from "@/lib/ads/create";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";

type Save = "idle" | "saving" | "saved" | "local" | "error";
type Phase = "editing" | "checking" | "checked" | "launching" | "launched" | "ambiguous" | "failed";
const storageKey = (tenant: string) => `ads-create-draft:${tenant}`;
const readLocal = (tenant: string): Draft | null => { try { const raw = localStorage.getItem(storageKey(tenant)); return raw ? JSON.parse(raw) as Draft : null; } catch { return null; } };
const writeLocal = (tenant: string, draft: Draft | null) => { try { if (draft) localStorage.setItem(storageKey(tenant), JSON.stringify(draft)); else localStorage.removeItem(storageKey(tenant)); } catch { /* storage unavailable: the draft stays in memory and on the server */ } };

/**
 * Guided create and Boost a post, in the shared editor: goal, ad set, ad, review and launch, with a live preview beside the form. The draft is saved as you go (to the server once the
 * form is complete enough for the server to accept it, and on this device before that). Launch goes through the server's check, review and launch gate; a campaign starts paused unless you
 * choose otherwise, and a retried launch after an unclear outcome reuses its key, so a second campaign is never created.
 */
export function AdWizard({ tenantId, initialAccount, initialMode, initialRequest }: { tenantId: string; initialAccount: string | null; initialMode: Mode; initialRequest: string | null }) {
  const t = useTranslations("Ads.wizard"), l = useTranslations("Ads"), explain = useAdsError(), hosted = useEditorHosted();
  const api = useMemo(() => adsApi(tenantId), [tenantId]);
  const [raw, setDraft] = useState<Draft>(() => emptyDraft(initialMode, initialAccount ?? ""));
  const [step, setStep] = useState<CreateStep>("goal"), [touched, setTouched] = useState(false), [previews, setPreviews] = useState<Record<string, string>>({});
  const [save, setSave] = useState<Save>("idle"), [phase, setStage] = useState<Phase>("editing"), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [problemsFromServer, setServerProblems] = useState<string[]>([]), [confirming, setConfirming] = useState(false), [ready, setReady] = useState(false);
  const lookups = useAdLookups(tenantId, raw.adAccountId), key = useRef<string | null>(null), savedSig = useRef(""), chain = useRef<Promise<unknown>>(Promise.resolve()), requestRef = useRef<LaunchRequestView | null>(null);
  const draft = useMemo(() => ({ ...raw, adAccountId: lookups.adAccountId }), [raw, lookups.adAccountId]);
  const dirty = ready && phase === "editing" && JSON.stringify(draft) !== JSON.stringify({ ...emptyDraft(initialMode), adAccountId: draft.adAccountId });
  const { destination, setDestination, leave } = useUnsavedChangesGuard(dirty && save !== "saved");

  // Resume: a saved draft request, else the draft kept on this device.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (initialRequest) {
        try { const { request: saved } = await api.getRequest(initialRequest); if (!cancelled && ["draft", "reviewed", "failed"].includes(saved.status)) { setDraft(fromPayload(saved.kind, saved.payload)); requestRef.current = saved; savedSig.current = JSON.stringify(fromPayload(saved.kind, saved.payload)); setSave("saved"); } } catch { /* start fresh */ }
      } else { const local = readLocal(tenantId); if (local && !cancelled) { setDraft(local); setNotice(t("restored")); } }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, [api, initialRequest, tenantId, t]);

  const set = useCallback(<K extends keyof Draft>(field: K, value: Draft[K]) => { setNotice(""); setStage((p) => p === "checked" || p === "failed" ? "editing" : p); setServerProblems([]); setDraft((d) => ({ ...d, [field]: value })); }, []);
  const changeMode = (mode: Mode) => { setNotice(""); setStep("goal"); setDraft((d) => ({ ...emptyDraft(mode, d.adAccountId), name: d.name, goal: d.goal === "messages" && mode === "boost" ? "" : d.goal })); };
  const issues = useMemo(() => problems(draft), [draft]);
  const bad = (field: string) => touched && issues.some((p) => p.field === field || p.field.startsWith(`${field}.`));
  const stepList = stepsFor(draft.mode);

  // Autosave: local always, the server once the form is valid. Writes go one after another so each carries the version the last one returned.
  const persist = useCallback((current: Draft): Promise<void> => {
    const sig = JSON.stringify(current);
    if (sig === savedSig.current && requestRef.current) return chain.current.then(() => undefined);
    setSave("saving");
    const payload = toPayload(current), kind = current.mode;
    chain.current = chain.current.then(async () => {
      try {
        let saved = requestRef.current;
        if (saved && (saved.kind !== kind || saved.adAccountId !== current.adAccountId)) { await api.cancelRequest(saved.id).catch(() => undefined); saved = null; }
        const result = saved ? await api.updateRequest(saved.id, payload, saved.version) : await api.createRequest(kind, payload);
        requestRef.current = result.request; savedSig.current = sig; setSave("saved");
      } catch { setSave("error"); }
    });
    return chain.current.then(() => undefined);
  }, [api]);
  useEffect(() => {
    if (!ready || phase === "launched" || phase === "launching") return;
    if (JSON.stringify(draft) === savedSig.current) return;
    const timer = setTimeout(() => {
      writeLocal(tenantId, draft);
      if (issues.length) { if (dirty) setSave("local"); return; }
      void persist(draft);
    }, 800);
    return () => clearTimeout(timer);
  }, [draft, ready, phase, tenantId, issues, dirty, persist]);

  const addPreview = useCallback((ref: string, url: string) => setPreviews((p) => ({ ...p, [ref]: url })), []);
  const account = lookups.accounts.find((a) => a.id === draft.adAccountId);
  const post = lookups.posts.find((p) => p.ref === draft.postRef);
  const attention = new Set(issues.filter(() => touched).map((p) => p.step));
  const steps = stepList.map((id) => ({ id, label: t(`steps.${id}`), done: id === "review" ? phase === "launched" : !issues.some((p) => p.step === id) && touched, attention: attention.has(id) }));
  const props = { tenantId, draft, set, bad, lookups, previews, addPreview };

  async function savedRequest() {
    if (issues.length) throw new Error("NOT_SAVED");
    writeLocal(tenantId, draft);
    await persist(draft);
    const current = requestRef.current;
    if (!current) throw new Error("NOT_SAVED");
    return current;
  }
  async function check() {
    setTouched(true); setError(""); setServerProblems([]);
    if (issues.length) { setStep(issues[0].step); return; }
    setStage("checking");
    try {
      let current = await savedRequest();
      current = (await api.validate(current.id)).request; requestRef.current = current;
      if (current.validation?.ok) setStage("checked"); else { setServerProblems(current.validation?.problems ?? []); setStage("failed"); }
    } catch (cause) { setError(explain(cause)); setStage("editing"); }
  }
  async function launch() {
    setError(""); setStage("launching");
    try {
      let current = await savedRequest();
      if (current.status === "draft") current = (await api.review(current.id, current.version)).request;
      requestRef.current = current;
      key.current ??= newKey();
      const result = await api.launch(current.id, key.current);
      requestRef.current = result.request;
      if (result.request.status === "launched") { writeLocal(tenantId, null); setStage("launched"); }
      else if (result.request.status === "ambiguous") setStage("ambiguous");
      else { setError(t("errors.launchFailed")); setStage("failed"); }
    } catch (cause) { setError(explain(cause)); setStage("failed"); }
  }
  const startOver = () => { writeLocal(tenantId, null); if (requestRef.current) void api.cancelRequest(requestRef.current.id).catch(() => undefined); requestRef.current = null; setDraft(emptyDraft(draft.mode, draft.adAccountId)); setStep("goal"); setTouched(false); setSave("idle"); setNotice(""); };

  const base = `/workspaces/${tenantId}/social/ads`;
  const title = draft.name.trim() || t(draft.mode === "boost" ? "titleBoost" : "title");
  const breadcrumb = <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><Link href={base}>{l("title")}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{title}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>;
  const status = <StatusBadge tone={phase === "launched" ? "success" : "pending"} dot label={phase === "launched" ? t("state.launched") : save === "saving" ? t("state.saving") : save === "saved" ? t("state.saved") : save === "local" ? t("state.local") : save === "error" ? t("state.error") : t("state.draft")} />;
  const sidebar = { typeLabel: t("typeLabel"), status: { kind: phase === "launched" ? "live" as const : "draft" as const, label: phase === "launched" ? t("state.launched") : t("state.draft") }, back: { href: base, label: l("title") }, dirty };
  const preview = <AdPreview draft={draft} name={account?.name ?? ""} caption={post?.caption ?? null} previews={previews} />;
  const actions = <Button type="button" variant="outline" className="min-h-11" onClick={startOver} disabled={phase === "launching" || phase === "launched"}>{t("startOver")}</Button>;

  if (lookups.status === "unavailable") return <Alert role="status"><AlertDescription>{l("states.unavailable")}</AlertDescription></Alert>;
  return <EditorShell breadcrumb={breadcrumb} title={title} status={status} actions={actions} steps={steps} current={step} onStep={(id) => { setTouched(true); setStep(id as CreateStep); }} stepsLabel={t("stepsLabel")} previewLabel={t("preview.label")} sidebar={sidebar}
    preview={preview}>
    {notice && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {phase === "launched" ? <Launched base={base} mode={draft.mode} status={draft.status} onAnother={startOver} /> :
    <WizardLayout steps={steps} current={step} onStepChange={(id) => { setTouched(true); setStep(id as CreateStep); }} stepsLabel={t("stepsLabel")} stepper={false} focusOnStepChange={hosted}
      validate={(id) => { setTouched(true); return !issues.some((p) => p.step === id); }} backLabel={t("back")} nextLabel={t("next")}>
      {step === "goal" && <GoalStep {...props} changeMode={changeMode} />}
      {step === "adset" && <AdSetStep {...props} />}
      {step === "ad" && <AdStep {...props} tenantHref={base} />}
      {step === "review" && <FormSection title={<span className="sr-only">{t("steps.review")}</span>}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 rounded-lg border p-4 text-sm" data-ads-review>
          <dt className="text-muted-foreground">{t("review.account")}</dt><dd>{account?.name ?? ""}</dd>
          <dt className="text-muted-foreground">{t("review.kind")}</dt><dd>{t(`mode.${draft.mode}`)}</dd>
          <dt className="text-muted-foreground">{t("name")}</dt><dd className="break-words">{draft.name}</dd>
          <dt className="text-muted-foreground">{t("goal")}</dt><dd>{draft.goal ? l(`goals.${draft.goal}`) : ""}</dd>
          <dt className="text-muted-foreground">{t("review.audience")}</dt><dd>{draft.ageMin && draft.ageMax ? t("review.audienceAges", { countries: draft.countries.join(", "), min: draft.ageMin, max: draft.ageMax }) : t("review.audienceOnly", { countries: draft.countries.join(", ") })}</dd>
          <dt className="text-muted-foreground">{t("review.budget")}</dt><dd>{draft.budgetAmount} {account?.currency ?? ""} {t(draft.budgetType === "lifetime" ? "budgetLifetime" : "budgetDaily").toLowerCase()}</dd>
          {draft.mode === "campaign" && <><dt className="text-muted-foreground">{t("format")}</dt><dd>{l(`formats.${draft.format}`)}</dd></>}
        </dl>
        {issues.length > 0 && touched && <Alert variant="destructive" role="alert"><AlertDescription><p>{t("review.fix")}</p><ul className="mt-1 list-disc ps-5">{[...new Set(issues.map((p) => p.step))].map((s) =>
          <li key={s}><button type="button" className="min-h-11 font-medium underline underline-offset-4" onClick={() => setStep(s)}>{t(`steps.${s}`)}</button></li>)}</ul></AlertDescription></Alert>}
        <div className="flex flex-col gap-2"><span id="ads-start-label" className="text-sm font-medium">{t("review.start")}</span>
          <ToggleGroup type="single" variant="outline" value={draft.status} aria-labelledby="ads-start-label" onValueChange={(v) => { if (v) set("status", v as Draft["status"]); }} className="w-full sm:w-auto">
            <ToggleGroupItem value="paused" className="min-h-11 flex-1 px-4 sm:flex-none">{t("review.paused")}</ToggleGroupItem>
            <ToggleGroupItem value="active" className="min-h-11 flex-1 px-4 sm:flex-none">{t("review.active")}</ToggleGroupItem></ToggleGroup></div>
        {phase === "checked" && <Alert role="status"><CheckCircle2 aria-hidden="true" /><AlertDescription>{t("review.checked")}</AlertDescription></Alert>}
        {problemsFromServer.length > 0 && <Alert variant="destructive" role="alert"><AlertDescription><p>{t("review.refused")}</p><ul className="mt-1 list-disc ps-5">{problemsFromServer.map((code) => <li key={code}>{t.has(`problems.${code}`) ? t(`problems.${code}`) : t("problems.other")}</li>)}</ul></AlertDescription></Alert>}
        {phase === "ambiguous" && <Alert role="status"><AlertDescription>{t("review.ambiguous")}</AlertDescription></Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="responsive" disabled={phase === "checking" || phase === "launching"} onClick={() => void check()} data-ads-check>{phase === "checking" ? t("review.checking") : t("review.check")}</Button>
          {phase === "ambiguous"
            ? <Button type="button" size="responsive" onClick={() => void launch()} data-ads-retry>{t("review.retry")}</Button>
            : <Button type="button" size="responsive" disabled={phase !== "checked"} onClick={() => setConfirming(true)} data-ads-launch><Rocket aria-hidden="true" />{t("review.launch")}</Button>}
        </div>
      </FormSection>}
    </WizardLayout>}
    <ConfirmDialog open={confirming} onOpenChange={setConfirming} tone="neutral" title={t("confirm.title", { name: draft.name })} description={t(draft.status === "active" ? "confirm.bodyActive" : "confirm.bodyPaused")} confirmLabel={t("confirm.confirm")} cancelLabel={t("confirm.cancel")}
      onConfirm={async () => { setConfirming(false); await launch(); }} />
    <ConfirmDialog tone="neutral" open={destination !== null} onOpenChange={(open) => { if (!open) setDestination(null); }} title={t("leaveTitle")} description={t("leaveBody")} cancelLabel={t("stay")} confirmLabel={t("leave")} onConfirm={leave} />
  </EditorShell>;
}

function Launched({ base, mode, status, onAnother }: { base: string; mode: Mode; status: Draft["status"]; onAnother: () => void }) {
  const t = useTranslations("Ads.wizard");
  return <FormSection title={<span className="sr-only">{t("steps.review")}</span>}>
    <Alert role="status" data-ads-launched><CheckCircle2 aria-hidden="true" /><AlertDescription>{t(status === "active" ? "launched.active" : "launched.paused", { kind: t(`mode.${mode}`) })}</AlertDescription></Alert>
    <div className="flex flex-wrap gap-2"><Button asChild size="responsive"><Link href={base}>{t("launched.view")}</Link></Button><Button type="button" variant="outline" size="responsive" onClick={onAnother}>{t("launched.another")}</Button></div>
  </FormSection>;
}
