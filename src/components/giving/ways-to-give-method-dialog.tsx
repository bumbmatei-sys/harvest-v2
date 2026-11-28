/** Derived from Shadcn UI Kit item dashboard-modal22 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Giving screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/searchable-select";
import { GivingMark, givingKindMarks } from "@/components/giving/giving-logos";
import { useRequest } from "@/hooks/use-request";
import { formatIban, givingFieldIssues, givingKindRules, givingKinds, givingLimits, type GivingFieldIssue, type GivingKind, type GivingMethodInput } from "@/lib/ways-to-give";
import type { GivingMethod } from "@/server/ways-to-give";

type Draft = { kind: GivingKind; label: string; url: string; handle: string; iban: string; bic: string; accountHolder: string; note: string; enabled: boolean };
type TextKey = "label" | "url" | "handle" | "iban" | "bic" | "accountHolder" | "note";
const blank = (kind: GivingKind = "paypal"): Draft => ({ kind, label: "", url: "", handle: "", iban: "", bic: "", accountHolder: "", note: "", enabled: true });
export const fromMethod = (m: GivingMethod): Draft => ({ kind: m.kind, label: m.label, url: m.url ?? "", handle: m.handle ?? "", iban: m.iban ? formatIban(m.iban) : "", bic: m.bic ?? "", accountHolder: m.accountHolder ?? "", note: m.note ?? "", enabled: m.enabled });
/** Only the fields the kind takes are sent, so switching kind in the form never leaves stray values behind. */
export function toInput(draft: Draft): GivingMethodInput {
  const rule = givingKindRules[draft.kind];
  return { kind: draft.kind, label: draft.label, enabled: draft.enabled, note: draft.note || null,
    url: rule.url !== "none" ? draft.url || null : null, handle: rule.handle !== "none" ? draft.handle || null : null,
    iban: rule.bank ? draft.iban || null : null, bic: rule.bank ? draft.bic || null : null, accountHolder: rule.bank ? draft.accountHolder || null : null };
}

/** Add or edit one way to give, as the kit's set-up dialog: the type's mark next to the type picker, then the fields that type takes, then the show switch. */
export function MethodDialog({ endpoint, method, onClose, onSaved }: { endpoint: string; method: GivingMethod | null; onClose: () => void; onSaved: (method: GivingMethod) => void }) {
  const t = useTranslations("WaysToGive");
  const request = useRequest();
  const [draft, setDraft] = React.useState<Draft>(method ? fromMethod(method) : blank());
  const [touched, setTouched] = React.useState(false), [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
  const rule = givingKindRules[draft.kind];
  const issues = givingFieldIssues(toInput(draft));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const problem = (key: string): GivingFieldIssue | undefined => touched ? (issues as Record<string, GivingFieldIssue | undefined>)[key] : undefined;

  function field(key: TextKey, max: number, extra: React.ComponentProps<typeof Input> = {}) {
    const issue = key !== "note" ? problem(key) : undefined;
    return (
      <Field data-invalid={issue !== undefined}>
        <FieldLabel htmlFor={`giving-${key}`}>
          {t(key === "handle" ? `handleLabels.${draft.kind}` : `fields.${key}`)}
        </FieldLabel>
        <Input
          id={`giving-${key}`}
          className="min-h-11 lg:min-h-9"
          maxLength={max}
          value={draft[key]}
          aria-invalid={issue !== undefined}
          onChange={(event) => set({ [key]: event.target.value })}
          {...extra}
        />
        {issue && (
          <FieldError>{t(`issues.${issue}`)}</FieldError>
        )}
      </Field>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
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
  const kindOptions = givingKinds.map((kind) => ({ value: kind, label: t(`kinds.${kind}`), icon: givingKindMarks[kind] }));

  return (
        <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
            <form noValidate onSubmit={(event) => void handleSubmit(event)} className="contents">
              <DialogHeader>
                <DialogTitle>{t(method ? "editTitle" : "addTitle")}</DialogTitle>
                <DialogDescription>
                  {t("dialogDescription")}
                </DialogDescription>
              </DialogHeader>

              {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}

              <div className="flex items-center gap-4">
                <span className="bg-muted relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border">
                  <GivingMark kind={draft.kind} className="size-7" />
                </span>
                <Field className="min-w-0 flex-1">
                  <FieldLabel htmlFor="giving-kind">{t("fields.kind")}</FieldLabel>
                  <SearchableSelect id="giving-kind" className="min-h-11 w-full" value={draft.kind} onChange={(value) => value && set({ kind: value as GivingKind })} options={kindOptions}
                    placeholder={t("fields.kind")} searchLabel={t("searchKinds")} emptyLabel={t("noKinds")} />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {field("label", givingLimits.label)}
                {rule.url !== "none" && field("url", givingLimits.url, { type: "url", inputMode: "url", placeholder: "https://" })}
                {rule.handle !== "none" && field("handle", givingLimits.handle)}
              </div>

              {rule.bank && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">{field("iban", 50, { autoCapitalize: "characters", spellCheck: false, className: "min-h-11 font-mono lg:min-h-9" })}</div>
                {field("bic", 20, { autoCapitalize: "characters", spellCheck: false, className: "min-h-11 font-mono lg:min-h-9" })}
                {field("accountHolder", givingLimits.holder)}
              </div>}

              <Field>
                <FieldLabel htmlFor="giving-note">{t("fields.note")}</FieldLabel>
                <Textarea
                  id="giving-note"
                  rows={2}
                  maxLength={givingLimits.note}
                  value={draft.note}
                  onChange={(event) => set({ note: event.target.value })}
                />
              </Field>

              <Field orientation="horizontal" className="min-h-11">
                <Checkbox
                  id="giving-enabled"
                  checked={draft.enabled}
                  onCheckedChange={(checked) => set({ enabled: !!checked })}
                />
                <FieldLabel htmlFor="giving-enabled" className="font-normal">
                  {t("fields.enabled")}
                </FieldLabel>
              </Field>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 lg:min-h-9"
                  disabled={busy}
                  onClick={onClose}
                >
                  {t("cancel")}
                </Button>
                <Button type="submit" className="min-h-11 lg:min-h-9" disabled={busy}>
                  {busy ? t("saving") : t("save")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
  );
}
