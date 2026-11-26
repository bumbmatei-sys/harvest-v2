"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, AtSign, HandCoins, Landmark, Link2, Pencil, Plus, Trash2, type LucideIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormSection } from "@/components/form-section";
import { SearchableSelect } from "@/components/searchable-select";
import { StatusBadge } from "@/components/status-badge";
import { WaysToGive } from "@/components/giving/ways-to-give";
import { useRequest } from "@/hooks/use-request";
import { formatIban, givingFieldIssues, givingKindRules, givingKinds, givingLimits, type GivingFieldIssue, type GivingKind, type GivingMethodInput } from "@/lib/ways-to-give";
import type { GivingMethod } from "@/server/ways-to-give";

const kindIcons: Record<GivingKind, LucideIcon> = { paypal: Link2, wise: Link2, venmo: AtSign, zelle: AtSign, revolut: AtSign, cash_app: AtSign, bank_transfer: Landmark, other: Link2 };
type Draft = { kind: GivingKind; label: string; url: string; handle: string; iban: string; bic: string; accountHolder: string; note: string; enabled: boolean };
const blank = (kind: GivingKind = "paypal"): Draft => ({ kind, label: "", url: "", handle: "", iban: "", bic: "", accountHolder: "", note: "", enabled: true });
const fromMethod = (m: GivingMethod): Draft => ({ kind: m.kind, label: m.label, url: m.url ?? "", handle: m.handle ?? "", iban: m.iban ? formatIban(m.iban) : "", bic: m.bic ?? "", accountHolder: m.accountHolder ?? "", note: m.note ?? "", enabled: m.enabled });
/** Only the fields the kind takes are sent, so switching kind in the form never leaves stray values behind. */
function toInput(draft: Draft): GivingMethodInput {
  const rule = givingKindRules[draft.kind];
  return { kind: draft.kind, label: draft.label, enabled: draft.enabled, note: draft.note || null,
    url: rule.url !== "none" ? draft.url || null : null, handle: rule.handle !== "none" ? draft.handle || null : null,
    iban: rule.bank ? draft.iban || null : null, bic: rule.bank ? draft.bic || null : null, accountHolder: rule.bank ? draft.accountHolder || null : null };
}
const summary = (m: GivingMethod) => m.iban ? `${m.iban.slice(0, 4)} •••• ${m.iban.slice(-4)}` : m.handle ?? (m.url ? new URL(m.url).hostname : "");

/** Operations > Giving > Ways to give: the ministry's own giving accounts, in order, with a live preview of what visitors see. Owners and admins. */
export function WaysToGiveManager({ tenantId, ministryName, initial }: { tenantId: string; ministryName: string; initial: GivingMethod[] }) {
  const t = useTranslations("WaysToGive");
  const request = useRequest();
  const endpoint = `/api/workspaces/${tenantId}/giving/methods`;
  const [methods, setMethods] = useState(initial);
  const [editing, setEditing] = useState<GivingMethod | "new" | null>(null);
  const [removing, setRemoving] = useState<GivingMethod | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const enabled = useMemo(() => methods.filter((m) => m.enabled), [methods]);
  const full = methods.length >= givingLimits.methods;

  async function toggle(method: GivingMethod, value: boolean) {
    setError(""); setBusy(true);
    const result = await request<GivingMethod>(`${endpoint}/${method.id}`, { method: "PATCH", body: { version: method.version, method: { ...toInput(fromMethod(method)), enabled: value } } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setMethods((list) => list.map((m) => m.id === method.id ? result.data : m));
  }
  async function move(index: number, by: number) {
    const next = [...methods], [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setError(""); setBusy(true);
    const result = await request<GivingMethod[]>(`${endpoint}/order`, { method: "PUT", body: { ids: next.map((m) => m.id) } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setMethods(result.data);
  }
  async function remove(method: GivingMethod) {
    const result = await request<{ id: string }>(`${endpoint}/${method.id}`, { method: "DELETE" });
    if (!result.ok) return result.error;
    setMethods((list) => list.filter((m) => m.id !== method.id));
  }

  const add = <Button type="button" className="min-h-11" disabled={full} onClick={() => setEditing("new")}><Plus aria-hidden="true" />{t("add")}</Button>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground"><HandCoins className="size-3.5" aria-hidden="true" />{t("group")}</div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("description")}</p></div>
      {methods.length > 0 && <div className="flex flex-wrap items-center gap-2">{full && <span className="text-sm text-muted-foreground">{t("limit", { max: givingLimits.methods })}</span>}{add}</div>}
    </div>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {methods.length === 0 ? <EmptyState icon={HandCoins} title={t("emptyTitle")} description={t("emptyDescription")} action={add} solid headingLevel={2} />
      : <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <ItemGroup aria-label={t("title")} className="gap-2" data-giving-list>
          {methods.map((method, index) => { const Icon = kindIcons[method.kind]; return <div key={method.id} role="listitem"><Item variant="outline" className="flex-wrap bg-card" data-giving-row={method.id}>
            <ItemMedia variant="icon"><Icon aria-hidden="true" /></ItemMedia>
            <ItemContent className="min-w-0"><ItemTitle className="max-w-full break-words">{method.label}</ItemTitle>
              <ItemDescription className="break-all">{t("rowSummary", { kind: t(`kinds.${method.kind}`), detail: summary(method) })}</ItemDescription></ItemContent>
            <ItemActions className="flex-wrap">
              <StatusBadge tone={method.enabled ? "success" : "neutral"} label={t(method.enabled ? "shown" : "hidden")} dot />
              <Switch checked={method.enabled} disabled={busy} aria-label={t("showLabel", { label: method.label })} onCheckedChange={(value) => void toggle(method, value)} />
              <Button type="button" variant="ghost" size="icon" className="size-11" disabled={busy || index === 0} aria-label={t("moveUp", { label: method.label })} onClick={() => void move(index, -1)}><ArrowUp aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" size="icon" className="size-11" disabled={busy || index === methods.length - 1} aria-label={t("moveDown", { label: method.label })} onClick={() => void move(index, 1)}><ArrowDown aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("edit", { label: method.label })} onClick={() => setEditing(method)}><Pencil aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("remove", { label: method.label })} onClick={() => setRemoving(method)}><Trash2 aria-hidden="true" /></Button>
            </ItemActions>
          </Item></div>; })}
        </ItemGroup>
        <FormSection title={t("preview")}>
          {enabled.length ? <WaysToGive methods={enabled} ministryName={ministryName} inert headingLevel={3} />
            : <EmptyState size="compact" title={t("previewEmpty")} />}
        </FormSection>
      </div>}
    {editing && <MethodDialog key={editing === "new" ? "new" : editing.id} endpoint={endpoint} method={editing === "new" ? null : editing}
      onClose={() => setEditing(null)} onSaved={(saved) => { setMethods((list) => list.some((m) => m.id === saved.id) ? list.map((m) => m.id === saved.id ? saved : m) : [...list, saved]); setEditing(null); }} />}
    <ConfirmDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }} title={t("removeTitle")} description={removing ? t("removeBody", { label: removing.label }) : undefined}
      cancelLabel={t("cancel")} confirmLabel={t("removeConfirm")} onConfirm={async () => { if (removing) { const problem = await remove(removing); if (problem) return problem; setRemoving(null); } }} />
  </div>;
}

function MethodDialog({ endpoint, method, onClose, onSaved }: { endpoint: string; method: GivingMethod | null; onClose: () => void; onSaved: (method: GivingMethod) => void }) {
  const t = useTranslations("WaysToGive");
  const request = useRequest();
  const [draft, setDraft] = useState<Draft>(method ? fromMethod(method) : blank());
  const [touched, setTouched] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const rule = givingKindRules[draft.kind];
  const issues = givingFieldIssues(toInput(draft));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const problem = (key: string): GivingFieldIssue | undefined => touched ? (issues as Record<string, GivingFieldIssue | undefined>)[key] : undefined;
  const fieldError = (key: string) => { const issue = problem(key); return issue ? <FieldError>{t(`issues.${issue}`)}</FieldError> : null; };
  const text = (key: "label" | "url" | "handle" | "iban" | "bic" | "accountHolder" | "note", max: number, extra: React.ComponentProps<typeof Input> = {}) =>
    <Field data-invalid={key !== "note" && problem(key) ? true : undefined}><FieldLabel htmlFor={`giving-${key}`}>{t(key === "handle" ? `handleLabels.${draft.kind}` : `fields.${key}`)}</FieldLabel>
      <Input id={`giving-${key}`} className="min-h-11" maxLength={max} value={draft[key]} aria-invalid={key !== "note" && problem(key) ? true : undefined} onChange={(e) => set({ [key]: e.target.value })} {...extra} />
      {key !== "note" && fieldError(key)}</Field>;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setTouched(true); setError("");
    if (Object.keys(issues).length) return;
    setBusy(true);
    const body = toInput(draft);
    const result = method ? await request<GivingMethod>(`${endpoint}/${method.id}`, { method: "PATCH", body: { version: method.version, method: body } })
      : await request<GivingMethod>(endpoint, { method: "POST", body });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onSaved(result.data);
  }
  const kindOptions = givingKinds.map((kind) => ({ value: kind, label: t(`kinds.${kind}`), icon: kindIcons[kind] }));
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{t(method ? "editTitle" : "addTitle")}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <Field><FieldLabel htmlFor="giving-kind">{t("fields.kind")}</FieldLabel>
          <SearchableSelect id="giving-kind" className="min-h-11 w-full" value={draft.kind} onChange={(value) => value && set({ kind: value as GivingKind })} options={kindOptions}
            placeholder={t("fields.kind")} searchLabel={t("searchKinds")} emptyLabel={t("noKinds")} /></Field>
        {text("label", givingLimits.label)}
        {rule.url !== "none" && text("url", givingLimits.url, { type: "url", inputMode: "url", placeholder: "https://" })}
        {rule.handle !== "none" && text("handle", givingLimits.handle)}
        {rule.bank && <>{text("iban", 50, { autoCapitalize: "characters", spellCheck: false, className: "min-h-11 font-mono" })}{text("bic", 20, { autoCapitalize: "characters", spellCheck: false, className: "min-h-11 font-mono" })}{text("accountHolder", givingLimits.holder)}</>}
        {text("note", givingLimits.note)}
        <div className="flex min-h-11 items-center justify-between gap-3"><label htmlFor="giving-enabled" className="text-sm font-medium">{t("fields.enabled")}</label>
          <Switch id="giving-enabled" checked={draft.enabled} onCheckedChange={(value) => set({ enabled: value })} /></div>
        <DialogFooter><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>{t("cancel")}</Button>
          <Button type="submit" className="min-h-11" disabled={busy}>{busy ? t("saving") : t("save")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
