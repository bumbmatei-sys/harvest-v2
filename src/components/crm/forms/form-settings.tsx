"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Columns2, Moon, Rows3, Square, Sun, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { asksFor, setNameQuestion } from "@/lib/newsletter-signup";
import type { ListChoice } from "@/components/newsletter/signup-forms-list";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { backgroundClass, buttonClass } from "@/components/forms/public-form";
import { backgroundIds, buttonColorIds, formLimits, layouts, type FormDefinition, type FormLayout, type FormSettings } from "@/lib/crm-forms";

export type Destination = { value: string; label: string };
export type Member = { id: string; name: string };
type Update = (fn: (settings: FormSettings) => FormSettings, key?: string) => void;

function Section({ id, title, open, onOpen, children }: { id: string; title: string; open: boolean; onOpen: (open: boolean) => void; children: React.ReactNode }) {
  return <Collapsible open={open} onOpenChange={onOpen} className="rounded-xl border bg-card" data-settings-section={id}>
    <CollapsibleTrigger className="flex min-h-12 w-full items-center justify-between gap-2 px-4 text-left text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      {title}<ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" /></CollapsibleTrigger>
    <CollapsibleContent><div className="space-y-4 px-4 pb-4">{children}</div></CollapsibleContent>
  </Collapsible>;
}
const Row = ({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) =>
  <div className="grid gap-2 sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)] sm:items-center"><Label htmlFor={htmlFor} className="text-sm font-normal text-muted-foreground">{label}</Label><div className="min-w-0">{children}</div></div>;
const Toggle = ({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (value: boolean) => void }) =>
  <Label htmlFor={id} className="flex min-h-11 items-center justify-between gap-3 font-normal">{label}<Switch id={id} checked={checked} onCheckedChange={onChange} /></Label>;
/** Two or three options in a row, one chosen (a radio group drawn as a segmented control). */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; icon?: React.ReactNode }[]; onChange: (value: T) => void }) {
  return <div role="radiogroup" aria-label={label} className="grid w-full auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted p-1">
    {options.map((option) => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} onClick={() => onChange(option.value)}
      className={cn("inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", value === option.value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{option.icon}{option.label}</button>)}
  </div>;
}
const layoutIcon = { one: Rows3, two: Columns2, paged: Square } as const;

/** The Settings sidebar: collapsible sections for what happens after submitting, submission options, layout, colours and the default view. */
export function FormSettingsPanel({ form, destinations, members, onSettings, onDestination, newsletter }: {
  form: FormDefinition; destinations: Destination[]; members: Member[]; onSettings: Update; onDestination: (value: string) => void;
  /** A newsletter sign-up form: its lists, wording and name questions replace the CRM destination, owner, labels and hidden-field settings. */
  newsletter?: { lists: ListChoice[]; onChange: (fn: (form: FormDefinition) => FormDefinition, key?: string) => void };
}) {
  const t = useTranslations("CrmForms.settings"), s = form.settings;
  const [open, setOpen] = useState<Record<string, boolean>>({ after: true, submission: true, layout: true, colors: true, view: true, lists: true, names: true, consent: true });
  const tn = useTranslations("CrmForms.newsletter");
  const [label, setLabel] = useState("");
  const set = (id: string) => (value: boolean) => setOpen((current) => ({ ...current, [id]: value }));
  const addLabel = () => { const value = label.trim(); if (!value || s.labels.includes(value) || s.labels.length >= formLimits.labels) return; onSettings((x) => ({ ...x, labels: [...x.labels, value] })); setLabel(""); };
  const urlInvalid = s.redirectUrl !== "" && !/^https:\/\/\S+$/.test(s.redirectUrl);
  const destValue = form.destination ? (form.destination.type === "pipeline" ? `pipeline:${form.destination.pipelineId}` : form.destination.type) : "";
  const config = form.newsletter;
  const toggleList = (id: string, on: boolean) => newsletter?.onChange((f) => f.newsletter ? { ...f, newsletter: { ...f.newsletter, listIds: on ? [...f.newsletter.listIds, id] : f.newsletter.listIds.filter((x) => x !== id) } } : f);
  return <div className="space-y-3" data-form-settings>
    {newsletter && config && <>
      <Section id="lists" title={tn("lists")} open={open.lists} onOpen={set("lists")}>
        {newsletter.lists.length === 0 ? <p className="text-sm text-muted-foreground">{tn("noLists")}</p>
          : <fieldset className="space-y-1" data-signup-lists><legend className="sr-only">{tn("lists")}</legend>
            {newsletter.lists.map((list) => <Label key={list.id} htmlFor={`signup-list-${list.id}`} className="flex min-h-11 items-center gap-3 font-normal">
              <Checkbox id={`signup-list-${list.id}`} checked={config.listIds.includes(list.id)} onCheckedChange={(value) => toggleList(list.id, value === true)} />
              <span className="min-w-0 truncate">{list.name}</span><span className="ms-auto truncate text-xs text-muted-foreground">{list.audience}</span></Label>)}</fieldset>}
        {config.listIds.length === 0 && <p role="alert" className="text-sm text-destructive">{tn("pickOne")}</p>}
      </Section>
      <Section id="names" title={tn("names")} open={open.names} onOpen={set("names")}>
        <Toggle id="set-first" label={tn("first")} checked={asksFor(form, "first")} onChange={(on) => newsletter.onChange((f) => setNameQuestion(f, "first", on, tn("firstLabel")))} />
        <Toggle id="set-last" label={tn("last")} checked={asksFor(form, "last")} onChange={(on) => newsletter.onChange((f) => setNameQuestion(f, "last", on, tn("lastLabel")))} />
      </Section>
      <Section id="consent" title={tn("consent")} open={open.consent} onOpen={set("consent")}>
        <div className="space-y-2 text-sm" data-signup-wording><Badge variant="outline">{config.wordingVersion}</Badge>
          <p>{config.consentText}</p><p className="text-muted-foreground">{config.fixedNotice}</p></div>
      </Section></>}
    {!newsletter && <Section id="after" title={t("after.title")} open={open.after} onOpen={set("after")}>
      <Row label={t("after.saveTo")} htmlFor="set-destination">
        <NativeSelect id="set-destination" className="w-full" value={destValue} onChange={(e) => onDestination(e.target.value)}>
          <NativeSelectOption value="">{t("after.notSet")}</NativeSelectOption>{destinations.map((d) => <NativeSelectOption key={d.value} value={d.value}>{d.label}</NativeSelectOption>)}</NativeSelect></Row>
      <Row label={t("after.owner")} htmlFor="set-owner">
        <NativeSelect id="set-owner" className="w-full" value={s.ownerId ?? ""} onChange={(e) => onSettings((x) => ({ ...x, ownerId: e.target.value || null }))}>
          <NativeSelectOption value="">{t("after.noOwner")}</NativeSelectOption>{members.map((m) => <NativeSelectOption key={m.id} value={m.id}>{m.name}</NativeSelectOption>)}</NativeSelect></Row>
      <Row label={t("after.labels")} htmlFor="set-label">
        <div className="space-y-2"><div className="flex gap-2"><Input id="set-label" className="min-h-11" value={label} maxLength={formLimits.labelLength} placeholder={t("after.labelPlaceholder")} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLabel(); } }} />
          <Button type="button" variant="outline" className="min-h-11" onClick={addLabel}>{t("after.addLabel")}</Button></div>
          {s.labels.length > 0 && <ul className="flex flex-wrap gap-2" aria-label={t("after.labels")}>{s.labels.map((l) => <li key={l}><Badge variant="secondary" className="gap-1 ps-2 pe-0">{l}
            <button type="button" aria-label={t("after.removeLabel", { label: l })} className="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 -my-3" onClick={() => onSettings((x) => ({ ...x, labels: x.labels.filter((y) => y !== l) }))}><X className="size-3" aria-hidden="true" /></button></Badge></li>)}</ul>}</div></Row>
    </Section>}
    <Section id="submission" title={t("submission.title")} open={open.submission} onOpen={set("submission")}>
      <Row label={t("submission.redirect")} htmlFor="set-redirect">
        <Input id="set-redirect" className="min-h-11" inputMode="url" placeholder={t("submission.redirectPlaceholder")} value={s.redirectUrl} maxLength={formLimits.url} aria-invalid={urlInvalid || undefined}
          onChange={(e) => onSettings((x) => ({ ...x, redirectUrl: e.target.value.trim() }), "redirect")} />{urlInvalid && <p role="alert" className="mt-1 text-sm text-destructive">{t("submission.redirectInvalid")}</p>}</Row>
      <Row label={t("submission.button")} htmlFor="set-button"><Input id="set-button" className="min-h-11" value={s.buttonLabel} maxLength={formLimits.button} onChange={(e) => onSettings((x) => ({ ...x, buttonLabel: e.target.value }), "button")} /></Row>
      {!newsletter && <Toggle id="set-resubmit" label={t("submission.resubmit")} checked={s.showResubmit} onChange={(v) => onSettings((x) => ({ ...x, showResubmit: v }))} />}
      <Toggle id="set-spam" label={t("submission.spam")} checked={s.spamCheck} onChange={(v) => onSettings((x) => ({ ...x, spamCheck: v }))} />
      {!newsletter && <>
        <Toggle id="set-hidden-campaign" label={t("submission.hiddenCampaign")} checked={s.hiddenCampaign} onChange={(v) => onSettings((x) => ({ ...x, hiddenCampaign: v }))} />
        <Toggle id="set-hidden-source" label={t("submission.hiddenSource")} checked={s.hiddenSource} onChange={(v) => onSettings((x) => ({ ...x, hiddenSource: v }))} /></>}
    </Section>
    <Section id="layout" title={t("layout.title")} open={open.layout} onOpen={set("layout")}>
      <div role="radiogroup" aria-label={t("layout.title")} className="grid grid-cols-3 gap-2">
        {layouts.map((layout: FormLayout) => { const Icon = layoutIcon[layout]; return <button key={layout} type="button" role="radio" aria-checked={s.layout === layout} onClick={() => onSettings((x) => ({ ...x, layout }))}
          className={cn("flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border p-2 text-center text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", s.layout === layout ? "border-primary bg-accent" : "hover:bg-accent/50")}>
          <Icon className="size-5" aria-hidden="true" />{t(`layout.${layout}`)}</button>; })}</div>
      {s.layout === "paged" && <Row label={t("layout.startLabel")} htmlFor="set-start"><Input id="set-start" className="min-h-11" value={s.startLabel} maxLength={formLimits.button} onChange={(e) => onSettings((x) => ({ ...x, startLabel: e.target.value }), "start")} /></Row>}
    </Section>
    <Section id="colors" title={t("colors.title")} open={open.colors} onOpen={set("colors")}>
      <Segmented label={t("colors.title")} value={s.theme} onChange={(theme) => onSettings((x) => ({ ...x, theme }))}
        options={[{ value: "light", label: t("colors.light"), icon: <Sun className="size-4" aria-hidden="true" /> }, { value: "dark", label: t("colors.dark"), icon: <Moon className="size-4" aria-hidden="true" /> }]} />
      <div role="radiogroup" aria-label={t("colors.background")} className="space-y-2"><p className="text-sm text-muted-foreground">{t("colors.background")}</p>
        <div className="flex flex-wrap gap-1">{backgroundIds.map((id) => <button key={id} type="button" role="radio" aria-checked={s.background === id} aria-label={t(`colors.backgrounds.${id}`)} onClick={() => onSettings((x) => ({ ...x, background: id }))}
          className="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"><span className={cn("size-8 rounded-full border", backgroundClass[id], s.background === id && "ring-2 ring-primary ring-offset-2 ring-offset-card")} /></button>)}</div></div>
      <div role="radiogroup" aria-label={t("colors.button")} className="space-y-2"><p className="text-sm text-muted-foreground">{t("colors.button")}</p>
        <div className="flex flex-wrap gap-1">{buttonColorIds.map((id) => <button key={id} type="button" role="radio" aria-checked={s.buttonColor === id} aria-label={t(`colors.buttons.${id}`)} onClick={() => onSettings((x) => ({ ...x, buttonColor: id }))}
          className="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"><span className={cn("size-8 rounded-full border", buttonClass[id].split(" ")[0], s.buttonColor === id && "ring-2 ring-primary ring-offset-2 ring-offset-card")} /></button>)}</div></div>
    </Section>
    <Section id="view" title={t("view.title")} open={open.view} onOpen={set("view")}>
      <Row label={t("view.landing")}><Segmented label={t("view.landing")} value={s.landing} onChange={(landing) => onSettings((x) => ({ ...x, landing }))}
        options={[{ value: "preview", label: t("view.preview") }, { value: "build", label: t("view.build") }]} /></Row>
    </Section>
  </div>;
}
