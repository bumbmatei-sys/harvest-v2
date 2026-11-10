"use client";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { sourceKinds, sourceMatches, sourceRoutes, sourceRule, type SourceKind, type SourceRule } from "@/lib/crm-fields";
import type { SourceOptions } from "@/server/crm-sources";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useCrmRequest } from "./request";

/** Source choices are loaded once per open filter panel and shared by every rule edited in it. */
export function useSourceOptions(tenantId: string, enabled: boolean) {
  const crmRequest = useCrmRequest();
  const [options, setOptions] = useState<SourceOptions | null>(null), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || options) return;
    let live = true;
    void crmRequest<SourceOptions>(`/api/workspaces/${tenantId}/crm/sources/options`, { method: "GET" }).then((result) => {
      if (!live) return;
      if (result.ok) { setOptions(result.data); setError(""); } else setError(result.error);
    });
    return () => { live = false; };
  }, [enabled, options, tenantId, crmRequest, attempt]);
  return { options, error, retry: () => { setError(""); setAttempt((value) => value + 1); } };
}

const empty = (): SourceRule => sourceRule.parse({ mode: "include" });

function Checklist({ legend, items, selected, onChange }: { legend: string; items: { id: string; name: string }[]; selected: string[]; onChange: (next: string[]) => void }) {
  const t = useTranslations("Crm");
  return <fieldset className="space-y-1.5"><legend className="mb-1.5 text-xs font-medium">{legend}</legend>
    {items.length === 0 ? <p className="px-2 text-xs text-muted-foreground">{t("sourceFilters.none")}</p>
      : <div className="max-h-40 space-y-1 overflow-y-auto">{items.map((item) => <Label key={item.id} className="flex min-h-11 items-center gap-2 rounded-md px-2 py-1 text-sm font-normal hover:bg-muted lg:min-h-9">
        <Checkbox checked={selected.includes(item.id)} onCheckedChange={(checked) => onChange(checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} />
        <span className="min-w-0 truncate">{item.name}</span></Label>)}</div>}
  </fieldset>;
}

/**
 * One source rule: every condition must hold on the same recorded source event. Campaign, link,
 * form and route exist only on Connect events, and Unknown (no recorded source) stands alone, so
 * the editor offers only combinations the server accepts.
 */
export function SourceRuleEditor({ initial, options, error: loadError, onRetry, onBack, onStage, names, submitLabel }: {
  initial?: SourceRule; options: SourceOptions | null; error: string; onRetry: () => void; onBack: () => void; submitLabel: string;
  /** Returns an error message, or null when the rule was staged. */
  onStage: (rule: SourceRule, names: Record<string, string>) => string | null;
  names: Record<string, string>;
}) {
  const t = useTranslations("Crm"), id = useId();
  const [rule, setRule] = useState<SourceRule>(initial ?? empty()), [error, setError] = useState("");
  const connectOnly = rule.kinds.length === 1 && rule.kinds[0] === "connect", unknown = rule.kinds.includes("unknown");
  const update = (patch: Partial<SourceRule>) => { setRule((current) => ({ ...current, ...patch })); setError(""); };
  function toggleKind(kind: SourceKind, checked: boolean) {
    if (kind === "unknown") { update(checked ? { kinds: ["unknown"], match: "any", campaigns: [], links: [], forms: [], route: null, from: null, to: null } : { kinds: [] }); return; }
    const kinds = checked ? [...rule.kinds.filter((item) => item !== "unknown"), kind] : rule.kinds.filter((item) => item !== kind);
    const keepConnect = kinds.length === 1 && kinds[0] === "connect";
    update({ kinds, ...(keepConnect ? {} : { campaigns: [], links: [], forms: [], route: null }) });
  }
  const links = (options?.links ?? []).filter((link) => !rule.campaigns.length || rule.campaigns.includes(link.campaignId));
  function stage() {
    if (rule.from && rule.to && rule.from > rule.to) { setError(t("sourceFilters.dateOrder")); return; }
    const parsed = sourceRule.safeParse(rule);
    const conditions = rule.kinds.length || rule.from || rule.to;
    if (!parsed.success || !conditions) { setError(t("sourceFilters.complete")); return; }
    const picked: Record<string, string> = {};
    for (const item of [...(options?.campaigns ?? []), ...(options?.links ?? []), ...(options?.forms ?? [])]) if ([...parsed.data.campaigns, ...parsed.data.links, ...parsed.data.forms].includes(item.id)) picked[item.id] = item.name;
    const failure = onStage(parsed.data, picked);
    if (failure) setError(failure);
  }
  const label = (key: string) => t(`sourceFilters.${key}` as "sourceFilters.any");
  const named = (items: { id: string; name: string; archived?: boolean }[]) => items.map((item) => ({ id: item.id, name: item.archived ? t("sourceFilters.archivedName", { name: item.name }) : names[item.id] ?? item.name }));
  return <form className="space-y-3 p-3" onSubmit={(event) => { event.preventDefault(); stage(); }}>
    <div className="flex items-center gap-1.5"><Button type="button" variant="ghost" size="icon-responsive" aria-label={t("chooseAnotherField")} onClick={onBack}><ArrowLeft aria-hidden="true" /></Button><p className="truncate text-sm font-medium">{t("sourceFilters.rule")}</p></div>
    <fieldset className="space-y-1.5"><legend className="mb-1.5 text-xs font-medium">{t("sourceFilters.mode")}</legend>
      <ButtonGroup className="w-full">{(["include", "exclude"] as const).map((mode) => <Button key={mode} type="button" variant={rule.mode === mode ? "default" : "outline"} aria-pressed={rule.mode === mode}
        className="h-11 flex-1 lg:h-9" onClick={() => update({ mode })}>{label(mode)}</Button>)}</ButtonGroup>
    </fieldset>
    {!unknown && <Field className="gap-1.5"><FieldLabel htmlFor={`${id}-match`} className="text-xs">{t("sourceFilters.match")}</FieldLabel>
      <NativeSelect id={`${id}-match`} value={rule.match} onChange={(event) => update({ match: event.target.value as SourceRule["match"] })} className="h-11 w-full lg:h-9">
        {sourceMatches.map((match) => <NativeSelectOption key={match} value={match}>{label(match)}</NativeSelectOption>)}
      </NativeSelect></Field>}
    <fieldset className="space-y-1.5"><legend className="mb-1.5 text-xs font-medium">{t("sourceFilters.kinds")}</legend>
      <div className="grid grid-cols-2 gap-1">{sourceKinds.map((kind) => <Label key={kind} className="flex min-h-11 items-center gap-2 rounded-md px-2 py-1 text-sm font-normal hover:bg-muted lg:min-h-9">
        <Checkbox checked={rule.kinds.includes(kind)} onCheckedChange={(checked) => toggleKind(kind, checked === true)} />{t(`sourceHistory.${kind}`)}</Label>)}</div>
    </fieldset>
    {connectOnly && (loadError ? <div className="space-y-2"><p role="alert" className="text-xs text-destructive">{t("sourceFilters.loadFailed")}</p><Button type="button" variant="outline" size="responsive" onClick={onRetry}>{t("sourceFilters.retry")}</Button></div>
      : !options ? <p className="text-xs text-muted-foreground" aria-live="polite">{t("sourceFilters.loading")}</p>
        : <>
          <Checklist legend={t("sourceFilters.campaigns")} items={named(options.campaigns)} selected={rule.campaigns} onChange={(campaigns) => update({ campaigns, links: rule.links.filter((linkId) => !campaigns.length || options.links.some((link) => link.id === linkId && campaigns.includes(link.campaignId))) })} />
          <Checklist legend={t("sourceFilters.links")} items={named(links)} selected={rule.links} onChange={(next) => update({ links: next })} />
          <Checklist legend={t("sourceFilters.forms")} items={named(options.forms)} selected={rule.forms} onChange={(forms) => update({ forms })} />
          <Field className="gap-1.5"><FieldLabel htmlFor={`${id}-route`} className="text-xs">{t("sourceFilters.route")}</FieldLabel>
            <NativeSelect id={`${id}-route`} value={rule.route ?? ""} onChange={(event) => update({ route: (event.target.value || null) as SourceRule["route"] })} className="h-11 w-full lg:h-9">
              <NativeSelectOption value="">{t("sourceFilters.anyRoute")}</NativeSelectOption>
              {sourceRoutes.map((route) => <NativeSelectOption key={route} value={route}>{t(`sourceHistory.${route}`)}</NativeSelectOption>)}
            </NativeSelect></Field>
        </>)}
    {!unknown && <fieldset className="space-y-1.5"><legend className="mb-1.5 text-xs font-medium">{t("sourceFilters.dates")}</legend>
      <div className="grid grid-cols-2 gap-2">
        <Field className="gap-1"><FieldLabel htmlFor={`${id}-from`} className="text-xs font-normal text-muted-foreground">{t("sourceFilters.from")}</FieldLabel>
          <Input id={`${id}-from`} type="date" value={rule.from ?? ""} className="h-11 lg:h-9" onChange={(event) => update({ from: event.target.value || null })} /></Field>
        <Field className="gap-1"><FieldLabel htmlFor={`${id}-to`} className="text-xs font-normal text-muted-foreground">{t("sourceFilters.to")}</FieldLabel>
          <Input id={`${id}-to`} type="date" value={rule.to ?? ""} className="h-11 lg:h-9" onChange={(event) => update({ to: event.target.value || null })} /></Field>
      </div>
    </fieldset>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <Button type="submit" variant="outline" size="responsive" className="w-full">{submitLabel}</Button>
  </form>;
}
