"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/status-badge";
import { Stepper } from "@/components/stepper";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { DmPreview } from "@/components/social/auto-dm/dm-preview";
import { StepCard } from "@/components/social/auto-dm/editor-parts";
import { LimitsStep, MatchStep, ResponseStep, TriggerStep } from "@/components/social/auto-dm/editor-steps";
import { EnableReview } from "@/components/social/auto-dm/enable-review";
import { HoursSheet } from "@/components/social/auto-dm/hours-panel";
import { useRuleLabels } from "@/components/social/auto-dm/rule-labels";
import { TestMode } from "@/components/social/auto-dm/test-mode";
import { useAutoDmReason } from "@/components/social/auto-dm/use-auto-dm";
import { usePostChoices } from "@/components/social/auto-dm/use-post-choices";
import { autoDmRuleInput, type AutoDmRule } from "@/lib/social/auto-dm";
import { autoDmApi, type AutoDmAccountView, type AutoDmRuleView } from "@/lib/social/auto-dm-api";
import { blankRule, ruleFlags, steps, stepIssues, withTrigger, type StepId } from "@/lib/social/auto-dm-ui";
import { platformLabels } from "@/lib/social/labels";
import { acceptsMime, uploadMedia } from "@/lib/social/media-upload";
import { notify } from "@/lib/toast";

const ruleOf = (view: AutoDmRuleView): AutoDmRule => ({ name: view.name, trigger: view.trigger, postId: view.postId, postRef: view.postRef, entryKey: view.entryKey, match: view.match,
  response: view.response, purpose: view.purpose, serviceOnly: view.serviceOnly, cooldownMinutes: view.cooldownMinutes, recipientDaily: view.recipientDaily, ruleDaily: view.ruleDaily, hours: view.hours, handoffUserId: view.handoffUserId });
const templateKey = (rule: AutoDmRule) => JSON.stringify([rule.response.text, rule.response.publicReply, rule.response.followup?.text ?? null]);
const mediaTypes: Record<string, number> = { "image/jpeg": 8_000_000, "image/png": 8_000_000, "video/mp4": 16_000_000 };

/**
 * The single-page rule editor: Trigger, Match, Response, Limits and hours, Review, with the live preview and test mode beside it. A rule is saved off; turning it on
 * is its own step (the enable review). The service-only confirmation is stored with the rule and drops when a template changes.
 */
export function RuleEditor({ tenantId, you, existing, accounts, onChanged }: {
  tenantId: string; you: { id: string; name: string }; existing: AutoDmRuleView | null; accounts: readonly AutoDmAccountView[]; onChanged: (rule: AutoDmRuleView) => void;
}) {
  const t = useTranslations("SocialAutoDm"), labels = useRuleLabels(), reason = useAutoDmReason(), router = useRouter(), api = useMemo(() => autoDmApi(tenantId), [tenantId]);
  const [initial, setInitial] = useState<{ rule: AutoDmRule; connectionId: string }>(() => ({ rule: existing ? ruleOf(existing) : blankRule(), connectionId: existing?.connectionId ?? accounts[0]?.id ?? "" }));
  const [rule, setRule] = useState(initial.rule), [connectionId, setConnectionId] = useState(initial.connectionId);
  const [attestedFor, setAttestedFor] = useState<string | null>(initial.rule.serviceOnly ? templateKey(initial.rule) : null);
  const [current, setCurrent] = useState<StepId>("trigger"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [hoursOpen, setHoursOpen] = useState(false), [reviewing, setReviewing] = useState(false);
  const [mediaName, setMediaName] = useState<string | null>(null), [uploading, setUploading] = useState(false), [mediaError, setMediaError] = useState("");
  const account = accounts.find((item) => item.id === connectionId) ?? null;
  const posts = usePostChoices(tenantId, connectionId, rule.trigger === "comment");
  const effective: AutoDmRule = useMemo(() => ({ ...rule, serviceOnly: rule.purpose === "service" && attestedFor === templateKey(rule) }), [rule, attestedFor]);
  const issues = useMemo(() => stepIssues(effective), [effective]);
  const missing = steps.filter((step) => step !== "review" && issues[step].length > 0), complete = missing.length === 0;
  const dirty = JSON.stringify(effective) !== JSON.stringify(initial.rule) || connectionId !== initial.connectionId;
  const update = useCallback((change: (rule: AutoDmRule) => AutoDmRule) => setRule(change), []);
  const flagged = ruleFlags(effective);

  useEffect(() => { // Opening a step by its link (Templates tab) scrolls to it.
    const id = window.location.hash.slice(1);
    if (id && (steps as readonly string[]).includes(id)) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
  }, []);

  function changeConnection(id: string) {
    setConnectionId(id);
    const next = accounts.find((item) => item.id === id);
    setRule((value) => { const cleared = { ...value, postId: null, postRef: value.postRef === null ? null : "" }; return next && next.triggers[value.trigger] === "unavailable" ? withTrigger(cleared, "comment") : cleared; });
  }
  async function attach(file: File | null) {
    setMediaError("");
    if (!file) { setMediaName(null); setRule((value) => ({ ...value, response: { ...value.response, fileId: null } })); return; }
    if (!acceptsMime(file.type) || !(file.type in mediaTypes) || file.size > mediaTypes[file.type]) { setMediaError(t("response.mediaRefused")); return; }
    setUploading(true);
    try {
      const stored = await uploadMedia(tenantId, file, { signal: new AbortController().signal, phase: () => undefined, progress: () => undefined });
      if (stored.status !== "ready") throw new Error(stored.status);
      setMediaName(file.name); setRule((value) => ({ ...value, response: { ...value.response, fileId: stored.id } }));
    } catch { setMediaError(t("response.mediaFailed")); } finally { setUploading(false); }
  }
  async function save() {
    const parsed = autoDmRuleInput.safeParse(effective);
    if (!parsed.success) { setError(t("editor.fixFirst")); return; }
    setBusy(true); setError("");
    try {
      const wasOn = existing?.enabled ?? false;
      const done = existing ? await api.edit(existing.id, existing.version, parsed.data) : await api.create(connectionId, parsed.data);
      const nextRule = ruleOf(done.rule);
      setInitial({ rule: nextRule, connectionId }); setRule(nextRule); setAttestedFor(nextRule.serviceOnly ? templateKey(nextRule) : null);
      onChanged(done.rule);
      notify.success(existing ? (wasOn ? t("editor.savedOff") : t("editor.saved")) : t("editor.created"));
      if (!existing) router.push(`/workspaces/${tenantId}/social/auto-dm/${done.rule.id}`);
    } catch (cause) { setError(reason(cause)); } finally { setBusy(false); }
  }
  async function turnOff() {
    if (!existing) return; setBusy(true); setError("");
    try { const done = await api.disable(existing.id, existing.version); onChanged(done.rule); notify.success(t("list.disabledToast", { name: done.rule.name })); } catch (cause) { setError(reason(cause)); } finally { setBusy(false); }
  }
  const saveRef = useRef(save); useEffect(() => { saveRef.current = save; });

  const stepperSteps = steps.map((step) => ({ id: step, label: t(`steps.${step}`), done: step === "review" ? complete && !dirty && !!existing : issues[step].length === 0 }));
  const platform = account?.platform ?? "instagram", accountName = account ? account.name ?? platformLabels[account.platform] : "";
  const card = (id: StepId, index: number, body: React.ReactNode) => <StepCard id={id} index={index} title={t(`steps.${id}`)} issues={issues[id].length} active={current === id} onFocus={() => setCurrent(id)}>{body}</StepCard>;
  return <div className="min-w-0 space-y-4" data-testid="rule-editor">
    <Stepper steps={stepperSteps} current={current} label={t("steps.label")} linear={false} compact="phone" />
    {error && <Alert variant="destructive" role="alert" data-testid="editor-error"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        {card("trigger", 1, <TriggerStep rule={rule} update={update} accounts={accounts} connectionId={connectionId} onConnection={changeConnection} locked={!!existing} posts={posts} issues={issues.trigger} />)}
        {card("match", 2, <MatchStep rule={rule} update={update} issues={issues.match} />)}
        {card("response", 3, <ResponseStep rule={rule} update={update} issues={issues.response} attested={effective.serviceOnly} onAttest={(value) => setAttestedFor(value ? templateKey(rule) : null)}
          mediaName={mediaName} onMedia={(file) => void attach(file)} uploading={uploading} mediaError={mediaError} />)}
        {card("limits", 4, <LimitsStep rule={rule} update={update} account={account} you={you} onEditHours={() => setHoursOpen(true)} issues={issues.limits} />)}
        <StepCard id="review" index={5} title={t("steps.review")} issues={0} active={current === "review"} onFocus={() => setCurrent("review")}>
          {complete ? <p className="text-sm text-muted-foreground" data-testid="review-ready">{t("editor.ready")}</p>
            : <ul className="space-y-1 text-sm" data-testid="review-missing">{missing.map((step) => <li key={step}><a href={`#${step}`} className="underline-offset-2 hover:underline">{t("editor.missing", { step: t(`steps.${step}`), count: issues[step].length })}</a></li>)}</ul>}
          <dl className="divide-y rounded-lg border px-3 text-sm">
            {[[t("review.trigger"), `${labels.trigger(effective.trigger)} · ${labels.scope(effective)}`], [t("review.account"), accountName || "-"], [t("review.limits"), t("review.limitsValue", { cooldown: labels.cooldown(effective.cooldownMinutes), person: effective.recipientDaily, rule: effective.ruleDaily })],
              [t("review.hours"), labels.hours(effective.hours)], [t("review.purpose"), labels.purpose(effective.purpose)]].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-4 py-1.5"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}
          </dl>
          {flagged.length > 0 && effective.purpose === "service" && <p className="text-xs text-muted-foreground" data-testid="review-flagged">{t("response.flagged", { words: flagged.join(", ") })}</p>}
          <p className="text-xs text-muted-foreground">{existing ? t("editor.afterSaveExisting") : t("editor.afterSaveNew")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="responsive" aria-disabled={!complete || !dirty || busy || undefined} onClick={() => { if (complete && dirty && !busy) void save(); }} data-testid="save-rule">{busy && <Spinner />}{existing ? t("editor.save") : t("editor.create")}</Button>
            {existing && !existing.enabled && <Button type="button" variant="outline" size="responsive" aria-disabled={dirty || !complete || busy || undefined} onClick={() => { if (!dirty && complete && !busy) setReviewing(true); }} data-testid="start-review">{t("editor.review")}</Button>}
            {existing?.enabled && <><StatusBadge tone="success" dot label={t("list.on")} /><Button type="button" variant="outline" size="responsive" aria-disabled={busy || undefined} onClick={() => { if (!busy) void turnOff(); }}>{t("editor.turnOff")}</Button></>}
          </div>
          {existing && !existing.enabled && dirty && <p className="text-xs text-muted-foreground">{t("editor.saveFirst")}</p>}
        </StepCard>
      </div>
      <aside className="min-w-0 space-y-4 xl:sticky xl:top-4" aria-label={t("preview.title")}>
        <DmPreview platform={platform} accountName={accountName} rule={effective} mediaName={effective.response.fileId ? mediaName ?? t("response.mediaAttached") : null} />
        <TestMode tenantId={tenantId} platform={platform} rule={effective} ready={complete} />
      </aside>
    </div>
    <StickySaveBar dirty={dirty} busy={busy} saveDisabled={!complete} onSave={() => void saveRef.current()} onDiscard={() => { setRule(initial.rule); setConnectionId(initial.connectionId); setAttestedFor(initial.rule.serviceOnly ? templateKey(initial.rule) : null); setError(""); }}
      saveLabel={existing ? t("editor.save") : t("editor.create")} savingLabel={t("editor.saving")} />
    <HoursSheet tenantId={tenantId} account={account} open={hoursOpen} onOpenChange={setHoursOpen} />
    <EnableReview tenantId={tenantId} rule={existing} account={account} open={reviewing} onOpenChange={setReviewing} onEnabled={(done) => { onChanged(done); notify.success(t("list.enabledToast", { name: done.name })); }} />
  </div>;
}
