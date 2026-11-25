"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Check, ChevronRight, Clock, Flag, Loader2, Mail, Pause, Play, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EditorShell } from "@/components/editor/editor-shell";
import { EmptyState } from "@/components/empty-state";
import { FormSection } from "@/components/form-section";
import { StatusBadge } from "@/components/status-badge";
import { BlockCanvas } from "@/components/newsletter/block-canvas";
import { EmailPreview } from "@/components/newsletter/email-preview";
import { useCrmRequest } from "@/components/crm/request";
import { commit, redo, startHistory, undo } from "@/lib/crm-forms";
import { newId, type BrandKit, type EmailBlock } from "@/lib/email/blocks";
import { templateDocument } from "@/lib/email/templates";
import { maxSteps, stepsSchema, type AutomationStep, type AutomationTrigger, type EmailStep } from "@/lib/newsletter-automations";
import type { StatusTone } from "@/lib/status-tone";

export type AutomationData = { id: string; name: string; state: string; version: number; trigger: AutomationTrigger; steps: AutomationStep[] };
type Draft = { name: string; steps: AutomationStep[] };
type Save = "saved" | "saving" | "error" | "conflict";
const AUTOSAVE_MS = 1200;
const copyKeys = ["title", "heading", "text", "button", "cite", "date", "time", "location", "caption", "leftHeading", "leftText", "rightHeading", "rightText", "linkOne", "linkTwo", "note"] as const;
const icons = { email: Mail, wait: Clock, end: Flag } as const;
const runTones: Record<string, StatusTone> = { active: "pending", completed: "success", stopped: "neutral" };
type RunRow = { id: string; name: string; state: string; stopReason: string | null; stepIndex: number; startedAt: string };
type LogRow = { id: string; stepType: string; outcome: string; reason: string | null; at: string };

/** The automation editor (shared EditorShell): Flow (trigger, ordered steps, email content with the campaign block editor) and Activity (who is in it, per-person log). */
export function AutomationEditor({ tenantId, ministryName, brand, suggestions, triggerName, automation }: {
  tenantId: string; ministryName: string; brand: BrandKit; suggestions: boolean; triggerName: string; automation: AutomationData;
}) {
  const t = useTranslations("NewsletterAutomations"), e = useTranslations("NewsletterAutomations.editor"), a = useTranslations("NewsletterAutomations.activity"), d = useTranslations("NewsletterCampaigns.defaults"), request = useCrmRequest();
  const [history, setHistory] = useState(() => startHistory<Draft>({ name: automation.name, steps: automation.steps }));
  const draft = history.present;
  const [blockSelected, setBlockSelected] = useState<string | null>(null);
  const [step, setStep] = useState("flow"), [selected, setSelected] = useState<string | null>(null), [state, setState] = useState(automation.state), [save, setSave] = useState<Save>("saved"), [announcement, setAnnouncement] = useState("");
  const [savedJson, setSavedJson] = useState(() => JSON.stringify({ name: automation.name, steps: automation.steps })), [addOpen, setAddOpen] = useState(false), [error, setError] = useState("");
  const version = useRef(automation.version), busy = useRef(false);
  const locked = state === "active";
  const dirty = JSON.stringify(draft) !== savedJson;
  const parsed = useMemo(() => stepsSchema.safeParse(draft.steps), [draft.steps]);
  const valid = parsed.success && draft.name.trim().length > 0;
  const hasEmail = draft.steps.some((s) => s.type === "email");
  const copy = useCallback(() => Object.fromEntries(copyKeys.map((k) => [k, d(k)])), [d]);

  const change = useCallback((fn: (x: Draft) => Draft, key?: string) => { setSave((s) => s === "error" ? "saved" : s); setHistory((h) => commit(h, fn(h.present), Date.now(), key ?? null)); }, []);
  const changeSteps = useCallback((fn: (steps: AutomationStep[]) => AutomationStep[], key?: string) => change((x) => ({ ...x, steps: fn(x.steps) }), key), [change]);
  const patchStep = (id: string, patch: Record<string, unknown>, key?: string) => changeSteps((list) => list.map((s) => s.id === id ? { ...s, ...patch } as AutomationStep : s), key);

  const flush = useCallback(async (value: Draft) => {
    if (busy.current) return true;
    busy.current = true; setSave("saving");
    const result = await request<{ version: number }>(`/api/workspaces/${tenantId}/newsletter/automations/${automation.id}`, { method: "PATCH", body: { version: version.current, name: value.name.trim(), steps: value.steps } });
    busy.current = false;
    if (result.ok) { version.current = result.data.version; setSavedJson(JSON.stringify(value)); setSave("saved"); return true; }
    setSave(result.status === 409 ? "conflict" : "error"); return false;
  }, [request, tenantId, automation.id]);

  useEffect(() => {
    if (!dirty || !valid || locked || save === "conflict") return;
    const timer = setTimeout(() => void flush(draft), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, dirty, valid, locked, save, flush]);

  async function transition(next: "active" | "paused") {
    setError("");
    if (next === "active" && dirty && valid && !(await flush(draft))) return;
    const result = await request<{ version: number; state: string }>(`/api/workspaces/${tenantId}/newsletter/automations/${automation.id}`, { method: "PATCH", body: { version: version.current, state: next } });
    if (!result.ok) { setError(result.status === 409 ? e("conflict") : e("saveFailed")); return; }
    version.current = result.data.version; setState(result.data.state);
  }
  function addStep(type: AutomationStep["type"]) {
    const next: AutomationStep = type === "wait" ? { id: newId(), type, amount: 1, unit: "days" } : type === "end" ? { id: newId(), type }
      : { id: newId(), type: "email", subject: e("defaultSubject"), preheader: "", content: templateDocument("welcome", brand) };
    changeSteps((list) => type === "end" ? [...list.filter((s) => s.type !== "end"), next] : [...list.filter((s) => s.type !== "end"), next, ...list.filter((s) => s.type === "end")]);
    setSelected(next.id); setAddOpen(false); setAnnouncement(e("editStep", { label: e(`stepTypes.${type}`) }));
  }
  const move = (index: number, by: number) => changeSteps((list) => { const next = [...list], [item] = next.splice(index, 1); next.splice(index + by, 0, item); return next.some((s, i) => s.type === "end" && i !== next.length - 1) ? list : next; });

  const label = (s: AutomationStep) => e(`stepTypes.${s.type}`);
  const summary = (s: AutomationStep) => s.type === "email" ? s.subject : s.type === "wait" ? e("waitSummary", { amount: s.amount, unit: e(s.unit) }) : "";
  const selectedStep = draft.steps.find((s) => s.id === selected) ?? null;
  const previewStep = (selectedStep?.type === "email" ? selectedStep : draft.steps.find((s): s is EmailStep => s.type === "email")) ?? null;
  const shown = save === "saved" && dirty ? (valid ? "saving" : "invalid") : save;
  const status = shown === "saving" ? e("saving") : shown === "saved" ? e("saved") : shown === "conflict" ? e("conflict") : shown === "invalid" ? e("fixFields") : e("saveFailed");
  const sidebar = { typeLabel: t("heading"), status: { kind: "draft" as const, label: t(`status.${state}` as "status.draft") }, back: { href: `/workspaces/${tenantId}/newsletter/automations`, label: e("back") }, dirty: shown !== "saved" };
  const base = `/workspaces/${tenantId}/newsletter/automations`;

  return <div data-automation-editor>
    <EditorShell
      breadcrumb={<nav aria-label={e("breadcrumb")} className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <Link href={base} className="inline-flex min-h-11 items-center hover:underline">{e("breadcrumb")}</Link><ChevronRight className="size-4" aria-hidden="true" /><span className="truncate font-medium text-foreground">{draft.name}</span></nav>}
      title={draft.name || t("heading")}
      status={<span role="status" className="inline-flex items-center gap-1 text-xs text-muted-foreground" data-save-status={shown}>
        {shown === "saving" ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : shown === "saved" ? <Check className="size-3" aria-hidden="true" /> : null}{status}</span>}
      actions={<>
        <Button type="button" variant="ghost" size="icon" className="size-11" disabled={locked || !history.past.length} aria-label={e("undo")} onClick={() => setHistory(undo)}><Undo2 aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="icon" className="size-11" disabled={locked || !history.future.length} aria-label={e("redo")} onClick={() => setHistory(redo)}><Redo2 aria-hidden="true" /></Button>
        {locked ? <Button type="button" variant="outline" className="min-h-11" onClick={() => void transition("paused")}><Pause aria-hidden="true" />{e("pause")}</Button>
          : <Button type="button" className="min-h-11" disabled={!hasEmail || !valid} onClick={() => void transition("active")}><Play aria-hidden="true" />{e("activate")}</Button>}
      </>}
      steps={[{ id: "flow", label: e("flow") }, { id: "activity", label: e("activity") }]} current={step} onStep={setStep} stepsLabel={e("steps")}
      preview={previewStep ? <EmailPreview tenantId={tenantId} doc={previewStep.content} preheader={previewStep.preheader} ministryName={ministryName} firstName="Ana" /> : undefined} previewLabel={e("preview")} sidebar={sidebar}>
      {save === "conflict" && <Alert variant="destructive"><AlertDescription>{e("conflict")}</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {step === "flow" ? <>
        {locked && <Alert><AlertDescription>{e("activeNotice")}</AlertDescription></Alert>}
        <FormSection title={e("details")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="auto-name">{e("name")}</Label><Input id="auto-name" className="min-h-11" maxLength={100} disabled={locked} value={draft.name} aria-invalid={!draft.name.trim() || undefined} onChange={(ev) => change((x) => ({ ...x, name: ev.target.value }), "name")} /></div>
            <div className="space-y-2"><p className="text-sm font-medium">{e("trigger")}</p><p className="flex min-h-11 items-center text-sm" data-trigger>{automation.trigger.type === "form" ? t("triggerForm", { name: triggerName || t("triggerGone") }) : t("triggerList", { name: triggerName || t("triggerGone") })}</p></div>
          </div>
        </FormSection>
        <section className="space-y-3" aria-label={e("stepList")}>
          {draft.steps.length === 0 ? <EmptyState icon={Mail} size="compact" title={e("noSteps")} /> : <ol className="space-y-3" aria-label={e("stepCount", { count: draft.steps.length })}>
            {draft.steps.map((s, index) => { const Icon = icons[s.type], open = selected === s.id, name = `${e("stepNumber", { number: index + 1 })} ${label(s)}`;
              return <li key={s.id} data-step={s.id} data-step-type={s.type} className={`rounded-xl border bg-card ${open ? "border-primary/50 ring-1 ring-primary/30" : ""}`}>
                <div className="flex min-h-11 flex-wrap items-center gap-1 px-2 py-1">
                  <button type="button" aria-expanded={open} aria-label={e("editStep", { label: name })} onClick={() => setSelected(open ? null : s.id)}
                    className="flex min-h-11 min-w-44 flex-1 items-center gap-2 overflow-hidden rounded-md px-2 text-left outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><Badge variant="secondary" className="shrink-0">{label(s)}</Badge><span className="truncate text-sm text-muted-foreground">{summary(s)}</span></button>
                  <Button type="button" variant="ghost" size="icon" className="size-11" disabled={locked || index === 0 || s.type === "end"} aria-label={e("moveUp", { label: name })} onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="size-11" disabled={locked || index === draft.steps.length - 1 || s.type === "end"} aria-label={e("moveDown", { label: name })} onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="size-11" disabled={locked} aria-label={e("remove", { label: name })} onClick={() => { changeSteps((list) => list.filter((x) => x.id !== s.id)); if (selected === s.id) setSelected(null); }}><Trash2 aria-hidden="true" /></Button>
                </div>
                {open && s.type === "wait" && <div className="grid gap-4 border-t p-4 sm:grid-cols-2" data-step-editor>
                  <div className="space-y-2"><Label htmlFor={`wait-${s.id}`}>{e("waitFor")}</Label><Input id={`wait-${s.id}`} className="min-h-11" type="number" min={1} max={s.unit === "hours" ? 720 : 60} disabled={locked} value={s.amount}
                    aria-invalid={!(s.amount >= 1 && s.amount <= (s.unit === "hours" ? 720 : 60)) || undefined} onChange={(ev) => patchStep(s.id, { amount: Math.trunc(Number(ev.target.value)) || 0 }, `${s.id}-amount`)} /></div>
                  <div className="space-y-2"><Label htmlFor={`unit-${s.id}`}>{e("unit")}</Label><NativeSelect id={`unit-${s.id}`} className="w-full" disabled={locked} value={s.unit} onChange={(ev) => patchStep(s.id, { unit: ev.target.value })}>
                    <NativeSelectOption value="hours">{e("hours")}</NativeSelectOption><NativeSelectOption value="days">{e("days")}</NativeSelectOption></NativeSelect></div></div>}
                {open && s.type === "email" && <div className="space-y-4 border-t p-4" data-step-editor>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2"><Label htmlFor={`subject-${s.id}`}>{e("subject")}</Label><Input id={`subject-${s.id}`} className="min-h-11" maxLength={150} disabled={locked} aria-invalid={!s.subject.trim() || undefined} value={s.subject} onChange={(ev) => patchStep(s.id, { subject: ev.target.value }, `${s.id}-subject`)} /></div>
                    <div className="space-y-2"><Label htmlFor={`pre-${s.id}`}>{e("previewText")}</Label><Input id={`pre-${s.id}`} className="min-h-11" maxLength={200} disabled={locked} value={s.preheader} onChange={(ev) => patchStep(s.id, { preheader: ev.target.value }, `${s.id}-pre`)} /></div>
                  </div>
                  <fieldset disabled={locked} className="min-w-0 space-y-3"><BlockCanvas tenantId={tenantId} suggestions={suggestions} blocks={s.content.blocks} selected={blockSelected} setSelected={setBlockSelected} notify={setAnnouncement} copy={copy}
                    change={(fn: (blocks: EmailBlock[]) => EmailBlock[], key?: string) => patchStep(s.id, { content: { ...s.content, blocks: fn(s.content.blocks) } }, key ? `${s.id}-${key}` : undefined)} /></fieldset>
                </div>}
              </li>; })}
          </ol>}
          <div className="flex flex-wrap items-center gap-3">
            <Popover open={addOpen} onOpenChange={setAddOpen}><PopoverTrigger asChild><Button type="button" variant="outline" className="min-h-11 border-dashed" disabled={locked || draft.steps.length >= maxSteps}><Plus aria-hidden="true" />{e("addStep")}</Button></PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-1">{(["email", "wait", "end"] as const).map((type) => { const Icon = icons[type];
                return <Button key={type} type="button" variant="ghost" className="min-h-11 w-full justify-start" disabled={type === "end" && draft.steps.some((s) => s.type === "end")} onClick={() => addStep(type)}><Icon aria-hidden="true" />{e(`stepTypes.${type}`)}</Button>; })}</PopoverContent></Popover>
            {!hasEmail && <span className="text-sm text-muted-foreground">{e("needsEmail")}</span>}
          </div>
          <p className="text-sm text-muted-foreground">{e("consentNote")}</p>
        </section>
      </> : <Activity tenantId={tenantId} automationId={automation.id} a={a} />}
    </EditorShell>
    <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
  </div>;
}

/** Who is in the automation and where they are; a person opens to their own log. */
function Activity({ tenantId, automationId, a }: { tenantId: string; automationId: string; a: ReturnType<typeof useTranslations<"NewsletterAutomations.activity">> }) {
  const request = useCrmRequest(), e = useTranslations("NewsletterAutomations.editor");
  const [rows, setRows] = useState<RunRow[] | null>(null), [failed, setFailed] = useState(false), [open, setOpen] = useState<RunRow | null>(null), [log, setLog] = useState<LogRow[] | null>(null);
  useEffect(() => {
    let live = true;
    void request<{ items: RunRow[] }>(`/api/workspaces/${tenantId}/newsletter/automations/${automationId}/runs`, { method: "GET" }).then((result) => { if (!live) return; if (result.ok) setRows(result.data.items); else setFailed(true); });
    return () => { live = false; };
  }, [request, tenantId, automationId]);
  async function show(row: RunRow) {
    setOpen(row); setLog(null);
    const result = await request<{ items: LogRow[] }>(`/api/workspaces/${tenantId}/newsletter/automations/${automationId}/runs/${row.id}`, { method: "GET" });
    setLog(result.ok ? result.data.items : []);
  }
  const state = (row: RunRow) => row.state === "stopped" && row.stopReason ? `${a("state.stopped")}: ${a(`reasons.${row.stopReason}` as "reasons.suppressed")}` : a(`state.${row.state}` as "state.active");
  const reason = (item: LogRow) => {
    const wait = /^(\d+) (hours|days)$/.exec(item.reason ?? "");
    return wait ? e("waitSummary", { amount: Number(wait[1]), unit: e(wait[2] as "hours" | "days") }) : a(`reasons.${item.reason}` as "reasons.suppressed");
  };
  const columns: DataTableColumn[] = [{ id: "person", header: a("person"), card: "title" }, { id: "status", header: a("status") }, { id: "step", header: a("step"), showFrom: "@md" }, { id: "started", header: a("started"), showFrom: "@lg" }];
  const tableRows: DataTableRow[] = (rows ?? []).map((row) => ({ id: row.id, label: row.name, cells: {
    person: <button type="button" aria-label={a("view", { name: row.name })} onClick={() => void show(row)} className="flex min-h-11 min-w-0 items-center truncate text-left font-medium hover:underline">{row.name}</button>,
    status: <StatusBadge tone={runTones[row.state] ?? "neutral"} label={state(row)} />, step: String(row.stepIndex + 1), started: new Date(row.startedAt).toLocaleString() } }));
  return <section className="space-y-3" aria-label={a("title")} data-activity>
    <h2 className="text-lg font-semibold">{a("title")}</h2>
    {failed ? <Alert variant="destructive"><AlertDescription>{a("loadFailed")}</AlertDescription></Alert> : rows === null ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : rows.length === 0 ? <EmptyState icon={Mail} size="compact" title={a("empty")} /> : <DataTable label={a("title")} columns={columns} rows={tableRows} />}
    <Sheet open={open !== null} onOpenChange={(next) => !next && setOpen(null)}><SheetContent className="w-full overflow-y-auto sm:max-w-md" aria-describedby={undefined}>
      <SheetHeader><SheetTitle>{a("log", { name: open?.name ?? "" })}</SheetTitle></SheetHeader>
      <ol className="space-y-3 p-4" data-run-log>{log === null ? <li><Loader2 className="size-4 animate-spin" aria-hidden="true" /></li> : log.map((item) => <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border p-3 text-sm">
        <span className="font-medium">{item.reason ? a("withReason", { outcome: a(`outcome.${item.outcome}` as "outcome.sent"), reason: reason(item) }) : a(`outcome.${item.outcome}` as "outcome.sent")}</span>
        <time className="text-muted-foreground" dateTime={item.at}>{new Date(item.at).toLocaleString()}</time></li>)}</ol>
    </SheetContent></Sheet>
  </section>;
}
