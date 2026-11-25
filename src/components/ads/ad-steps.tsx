/** Layout and behaviour modelled on Shadcn UI Kit items stepper1 and form-layout1 (inside the shared EditorShell), approved by the founder 25 Nov 2026; code written for Harvest, no kit code copied. Notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { RadioCards } from "@/components/forms/kit-radio-cards";
import { FormSection } from "@/components/form-section";
import { AdMediaPicker, type MediaChange } from "@/components/ads/ad-media";
import type { AdLookups } from "@/components/ads/use-ad-lookups";
import { adsApi } from "@/lib/ads/api";
import { messagingDestinations } from "@/lib/ads/ads";
import { bidStrategies, categoryOptions, commonCountries, ctas, formatsOffered, placementOptions, type Draft, type Mode } from "@/lib/ads/create";

export type StepProps = { tenantId: string; draft: Draft; set: <K extends keyof Draft>(key: K, value: Draft[K]) => void; bad: (field: string) => boolean; lookups: AdLookups; previews: Record<string, string>; addPreview: (ref: string, url: string) => void };
const countryName = (code: string) => { try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code; } catch { return code; } };
const toggle = <T,>(list: readonly T[], item: T) => list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

function InterestSearch({ tenantId, draft, set }: { tenantId: string; draft: Draft; set: StepProps["set"] }) {
  const t = useTranslations("Ads.wizard");
  const [query, setQuery] = useState(""), [hits, setHits] = useState<{ id: string; name: string }[]>([]), [state, setState] = useState<"idle" | "searching" | "failed">("idle");
  async function search() {
    if (!query.trim() || !draft.adAccountId) return;
    setState("searching");
    try { setHits((await adsApi(tenantId).searchTargeting(draft.adAccountId, "interest", query.trim())).hits); setState("idle"); } catch { setState("failed"); }
  }
  return <Field><FieldLabel htmlFor="ads-interest">{t("interests")}</FieldLabel>
    <div className="flex gap-2"><Input id="ads-interest" className="min-h-11" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} />
      <Button type="button" variant="outline" size="responsive" disabled={!query.trim() || !draft.adAccountId || state === "searching"} onClick={() => void search()}><Search aria-hidden="true" />{t("search")}</Button></div>
    {state === "failed" && <FieldError>{t("errors.search")}</FieldError>}
    {hits.length > 0 && <ul className="flex list-none flex-wrap gap-2 p-0" aria-label={t("interestResults")}>{hits.filter((hit) => !draft.interests.some((i) => i.id === hit.id)).map((hit) => <li key={hit.id}>
      <Button type="button" variant="secondary" size="responsive" onClick={() => set("interests", [...draft.interests, { id: hit.id, name: hit.name }])}><Plus aria-hidden="true" />{hit.name}</Button></li>)}</ul>}
    {draft.interests.length > 0 && <ul className="flex list-none flex-wrap gap-2 p-0" aria-label={t("chosenInterests")}>{draft.interests.map((interest) => <li key={interest.id}>
      <Button type="button" variant="outline" size="responsive" aria-label={t("removeItem", { name: interest.name })} onClick={() => set("interests", draft.interests.filter((i) => i.id !== interest.id))}>{interest.name}<X aria-hidden="true" /></Button></li>)}</ul>}
  </Field>;
}


/** Step 01, Create: a new campaign, an ad added to an ad set that exists, or a boosted post; then the ad account and what the flow needs to start. */
export function CreateStep({ draft, set, bad, lookups, changeMode }: StepProps & { changeMode: (mode: Mode) => void }) {
  const t = useTranslations("Ads.wizard"), format = useFormatter();
  const adSets = lookups.tree.flatMap((campaign) => campaign.adSets.filter((s) => s.status === "active" || s.status === "paused").map((s) => ({ id: s.id, label: `${campaign.name} / ${s.name}` })));
  const posts = lookups.posts, postLabel = (post: { platform: string; publishedAt: string | null }) => `${post.platform}${post.publishedAt ? ` \u00b7 ${format.dateTime(new Date(post.publishedAt), { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}` : ""}`;
  return <FormSection title={<span className="sr-only">{t("steps.create")}</span>}>
    <Field><FieldLabel id="ads-mode-label">{t("mode.label")}</FieldLabel>
      <ToggleGroup type="single" variant="outline" value={draft.mode} aria-labelledby="ads-mode-label" onValueChange={(value) => { if (value) changeMode(value as Mode); }} className="w-full flex-wrap sm:w-auto">
        <ToggleGroupItem value="campaign" className="min-h-11 flex-1 px-4 sm:flex-none">{t("mode.campaign")}</ToggleGroupItem>
        <ToggleGroupItem value="add_ad" className="min-h-11 flex-1 px-4 sm:flex-none">{t("mode.add_ad")}</ToggleGroupItem>
        <ToggleGroupItem value="boost" className="min-h-11 flex-1 px-4 sm:flex-none">{t("mode.boost")}</ToggleGroupItem>
      </ToggleGroup></Field>
    <Field data-invalid={bad("adAccountId") || undefined}><FieldLabel htmlFor="ads-account">{t("account")}</FieldLabel>
      <NativeSelect id="ads-account" className="min-h-11 w-full" value={draft.adAccountId} aria-invalid={bad("adAccountId") || undefined} onChange={(event) => set("adAccountId", event.target.value)}>
        <option value="">{t("chooseAccount")}</option>
        {lookups.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</NativeSelect>
      {bad("adAccountId") && <FieldError>{t("errors.account")}</FieldError>}</Field>
    {draft.mode !== "add_ad" && <Field data-invalid={bad("name") || undefined}><FieldLabel htmlFor="ads-name">{t("name")}</FieldLabel>
      <Input id="ads-name" className="min-h-11" value={draft.name} maxLength={200} aria-invalid={bad("name") || undefined} onChange={(event) => set("name", event.target.value)} />
      {bad("name") && <FieldError>{t("errors.name")}</FieldError>}</Field>}
    {draft.mode === "add_ad" && <Field data-invalid={bad("existingAdSetId") || undefined}><FieldLabel htmlFor="ads-existing">{t("existingAdSet")}</FieldLabel>
      {adSets.length === 0 ? <Alert role="status"><AlertDescription>{draft.adAccountId ? t("noAdSets") : t("chooseAccountFirst")}</AlertDescription></Alert>
        : <NativeSelect id="ads-existing" className="min-h-11 w-full" value={draft.existingAdSetId} aria-invalid={bad("existingAdSetId") || undefined} onChange={(e) => set("existingAdSetId", e.target.value)}>
          <option value="">{t("chooseAdSet")}</option>{adSets.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</NativeSelect>}
      {bad("existingAdSetId") && <FieldError>{t("errors.adSet")}</FieldError>}</Field>}
    {draft.mode === "boost" && <Field data-invalid={bad("postRef") || undefined}><FieldLabel id="ads-post-label">{t("post")}</FieldLabel>
      {posts.length === 0 ? <Alert role="status"><AlertDescription>{draft.adAccountId ? t("noPosts") : t("chooseAccountFirst")}</AlertDescription></Alert>
        : <RadioCards name="ads-post" labelledBy="ads-post-label" invalid={bad("postRef")} options={posts.map(postLabel)} value={(() => { const picked = posts.find((post) => post.ref === draft.postRef); return picked ? postLabel(picked) : ""; })()}
          onChange={(label) => set("postRef", posts.find((post) => postLabel(post) === label)?.ref ?? "")} />}
      {bad("postRef") && <FieldError>{t("errors.post")}</FieldError>}</Field>}
    {draft.mode === "boost" && adSets.length > 0 && <Field><FieldLabel htmlFor="ads-boost-existing">{t("existingAdSetBoost")}</FieldLabel><NativeSelect id="ads-boost-existing" className="min-h-11 w-full" value={draft.existingAdSetId} onChange={(e) => set("existingAdSetId", e.target.value)}>
      <option value="">{t("newAdSet")}</option>{adSets.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</NativeSelect></Field>}
  </FormSection>;
}

/** Step 03, Budget: daily or lifetime and the amount, plus the special ad categories (the campaign-level choices). */
export function BudgetStep({ draft, set, bad }: StepProps) {
  const t = useTranslations("Ads.wizard"), l = useTranslations("Ads");
  const political = draft.categories.includes("social_issues_elections_politics");
  return <>
    <FormSection title={t("sections.budget")} as="fieldset">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="ads-budget-type">{t("budgetType")}</FieldLabel><NativeSelect id="ads-budget-type" className="min-h-11 w-full" value={draft.budgetType} onChange={(e) => set("budgetType", e.target.value as Draft["budgetType"])}>
          <option value="daily">{t("budgetDaily")}</option><option value="lifetime">{t("budgetLifetime")}</option></NativeSelect></Field>
        <Field data-invalid={bad("budgetAmount") || undefined}><FieldLabel htmlFor="ads-budget">{t("budget")}</FieldLabel><Input id="ads-budget" inputMode="decimal" className="min-h-11" value={draft.budgetAmount} aria-invalid={bad("budgetAmount") || undefined}
          onChange={(e) => set("budgetAmount", e.target.value.replace(/[^0-9.]/g, "").slice(0, 10))} />{bad("budgetAmount") && <FieldError>{t("errors.budget")}</FieldError>}</Field>
      </div>
    </FormSection>
    <FormSection title={t("sections.categories")} as="fieldset">
      <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-1 p-0">{categoryOptions.map((c) => <li key={c}><label className="flex min-h-11 items-center gap-3 text-sm">
        <Checkbox checked={draft.categories.includes(c)} onCheckedChange={() => set("categories", toggle(draft.categories, c))} />{t(`categories.${c}`)}</label></li>)}</ul>
      {political && <Alert variant="destructive" role="alert"><AlertDescription>{l("errors.policy")}</AlertDescription></Alert>}
    </FormSection>
  </>;
}

/** Step 04, Ad set: its name and how it bids. */
export function AdSetStep({ draft, set, bad }: StepProps) {
  const t = useTranslations("Ads.wizard");
  return <FormSection title={<span className="sr-only">{t("steps.adset")}</span>}>
    <Field><FieldLabel htmlFor="ads-adset-name">{t("adSetName")}</FieldLabel><Input id="ads-adset-name" className="min-h-11" value={draft.adSetName} maxLength={200} placeholder={draft.name} onChange={(e) => set("adSetName", e.target.value)} /></Field>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field><FieldLabel htmlFor="ads-bid">{t("bidStrategy")}</FieldLabel><NativeSelect id="ads-bid" className="min-h-11 w-full" value={draft.bidStrategy} onChange={(e) => set("bidStrategy", e.target.value as Draft["bidStrategy"])}>
        {bidStrategies.map((b) => <option key={b} value={b}>{t(`bid.${b}`)}</option>)}</NativeSelect></Field>
      {draft.bidStrategy !== "lowest_cost" && <Field data-invalid={bad("bidding") || undefined}><FieldLabel htmlFor="ads-bid-amount">{t("bidAmount")}</FieldLabel>
        <Input id="ads-bid-amount" inputMode="decimal" className="min-h-11" value={draft.bidAmount} aria-invalid={bad("bidding") || undefined} onChange={(e) => set("bidAmount", e.target.value.replace(/[^0-9.]/g, "").slice(0, 10))} />
        {bad("bidding") && <FieldError>{t("errors.bid")}</FieldError>}</Field>}
    </div>
  </FormSection>;
}

/** Step 05, Audience. */
export function AudienceStep({ tenantId, draft, set, bad, lookups }: StepProps) {
  const t = useTranslations("Ads.wizard");
  return <FormSection title={t("sections.audience")} as="fieldset">
      <Field data-invalid={bad("targeting.countries") || undefined}><FieldLabel htmlFor="ads-country">{t("countries")}</FieldLabel>
        <NativeSelect id="ads-country" className="min-h-11 w-full sm:w-72" value="" onChange={(event) => { if (event.target.value) set("countries", [...new Set([...draft.countries, event.target.value])]); }}>
          <option value="">{t("addCountry")}</option>{commonCountries.filter((c) => !draft.countries.includes(c)).map((c) => <option key={c} value={c}>{countryName(c)}</option>)}</NativeSelect>
        {draft.countries.length > 0 && <ul className="flex list-none flex-wrap gap-2 p-0" aria-label={t("chosenCountries")}>{draft.countries.map((c) => <li key={c}>
          <Button type="button" variant="outline" size="responsive" aria-label={t("removeItem", { name: countryName(c) })} onClick={() => set("countries", draft.countries.filter((x) => x !== c))}>{countryName(c)}<X aria-hidden="true" /></Button></li>)}</ul>}</Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field data-invalid={bad("targeting.ageMin") || undefined}><FieldLabel htmlFor="ads-age-min">{t("ageMin")}</FieldLabel><Input id="ads-age-min" inputMode="numeric" className="min-h-11" value={draft.ageMin} aria-invalid={bad("targeting.ageMin") || undefined} onChange={(e) => set("ageMin", e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field>
        <Field data-invalid={bad("targeting.ageMax") || undefined}><FieldLabel htmlFor="ads-age-max">{t("ageMax")}</FieldLabel><Input id="ads-age-max" inputMode="numeric" className="min-h-11" value={draft.ageMax} aria-invalid={bad("targeting.ageMax") || undefined} onChange={(e) => set("ageMax", e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field>
        <Field><FieldLabel htmlFor="ads-gender">{t("gender")}</FieldLabel><NativeSelect id="ads-gender" className="min-h-11 w-full" value={draft.gender} onChange={(e) => set("gender", e.target.value as Draft["gender"])}>
          {(["all", "female", "male"] as const).map((g) => <option key={g} value={g}>{t(`genders.${g}`)}</option>)}</NativeSelect></Field>
      </div>
      {bad("targeting") && <FieldError>{t("errors.age")}</FieldError>}
      <InterestSearch tenantId={tenantId} draft={draft} set={set} />
      {lookups.audiences.length > 0 && <Field><FieldLabel id="ads-audiences-label">{t("savedAudiences")}</FieldLabel>
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-labelledby="ads-audiences-label">{lookups.audiences.map((a) => <li key={a.id}><label className="flex min-h-11 items-center gap-3 text-sm">
          <Checkbox checked={draft.includeAudiences.includes(a.id)} onCheckedChange={() => set("includeAudiences", toggle(draft.includeAudiences, a.id))} />{a.name}</label></li>)}</ul></Field>}
      <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border p-3 text-sm"><span>{t("advantage")}</span><Switch checked={draft.advantage} onCheckedChange={(on) => set("advantage", on)} /></label>
    </FormSection>;
}

/** Step 06, Placements. */
export function PlacementsStep({ draft, set }: StepProps) {
  const t = useTranslations("Ads.wizard");
  return <FormSection title={t("sections.placements")} as="fieldset">
      <ToggleGroup type="single" variant="outline" value={draft.placementsMode} aria-label={t("sections.placements")} onValueChange={(v) => { if (v) set("placementsMode", v as Draft["placementsMode"]); }} className="w-full sm:w-auto">
        <ToggleGroupItem value="automatic" className="min-h-11 flex-1 px-4 sm:flex-none">{t("placements.automatic")}</ToggleGroupItem>
        <ToggleGroupItem value="manual" className="min-h-11 flex-1 px-4 sm:flex-none">{t("placements.manual")}</ToggleGroupItem></ToggleGroup>
      {draft.placementsMode === "manual" && <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-1 p-0">{placementOptions.map((p) => <li key={p}><label className="flex min-h-11 items-center gap-3 text-sm">
        <Checkbox checked={draft.placements.includes(p)} onCheckedChange={() => set("placements", toggle(draft.placements, p))} />{t(`placements.${p}`)}</label></li>)}</ul>}
      {draft.placementsMode === "manual" && draft.placements.length === 0 && <FieldError>{t("errors.placements")}</FieldError>}
    </FormSection>;
}

/** Step 07, Schedule. */
export function ScheduleStep({ draft, set, bad }: StepProps) {
  const t = useTranslations("Ads.wizard");
  return <FormSection title={t("sections.schedule")} as="fieldset">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="ads-start">{t("startDate")}</FieldLabel><Input id="ads-start" type="date" className="min-h-11" value={draft.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
        <Field data-invalid={bad("endDate") || undefined}><FieldLabel htmlFor="ads-end">{t("endDate")}</FieldLabel><Input id="ads-end" type="date" className="min-h-11" value={draft.endDate} min={draft.startDate || undefined} aria-invalid={bad("endDate") || undefined} onChange={(e) => set("endDate", e.target.value)} />
          {bad("endDate") && <FieldError>{t(draft.budgetType === "lifetime" && !draft.endDate ? "errors.endRequired" : "errors.endBefore")}</FieldError>}</Field>
      </div>
    </FormSection>;
}

export function AdStep({ tenantId, draft, set, bad, lookups, previews, addPreview, tenantHref }: StepProps & { tenantHref: string }) {
  const t = useTranslations("Ads.wizard"), l = useTranslations("Ads");
  const onAdd = (m: MediaChange) => { addPreview(m.ref, m.previewUrl); set("mediaRefs", [...draft.mediaRefs, { ref: m.ref, name: m.name }]); };
  const setCard = (index: number, patch: Partial<Draft["cards"][number]>) => set("cards", draft.cards.map((c, i) => i === index ? { ...c, ...patch } : c));
  return <FormSection title={<span className="sr-only">{t("steps.ad")}</span>}>
    {draft.mode === "add_ad" && <Field data-invalid={bad("name") || undefined}><FieldLabel htmlFor="ads-ad-name">{t("adName")}</FieldLabel>
      <Input id="ads-ad-name" className="min-h-11" value={draft.name} maxLength={200} aria-invalid={bad("name") || undefined} onChange={(event) => set("name", event.target.value)} />
      {bad("name") && <FieldError>{t("errors.name")}</FieldError>}</Field>}
    <Field data-invalid={bad("creative.format") || undefined}><FieldLabel id="ads-format-label">{t("format")}</FieldLabel>
      <RadioCards name="ads-format" labelledBy="ads-format-label" invalid={bad("creative.format")} options={formatsOffered.map((f) => l(`formats.${f}`))} value={l(`formats.${draft.format}`)}
        onChange={(label) => set("format", formatsOffered.find((f) => l(`formats.${f}`) === label) ?? "image")} />
      {bad("creative.format") && <FieldError>{t("errors.format")}</FieldError>}</Field>
    {(draft.format === "image" || draft.format === "video") && <Field data-invalid={bad("creative.mediaRefs") || undefined}><FieldLabel>{t(draft.format === "video" ? "videoLabel" : "imageLabel")}</FieldLabel>
      <AdMediaPicker tenantId={tenantId} kind={draft.format} max={draft.format === "video" ? 1 : 10} value={draft.mediaRefs} previews={previews} onAdd={onAdd} onRemove={(ref) => set("mediaRefs", draft.mediaRefs.filter((m) => m.ref !== ref))}
        label={t(draft.format === "video" ? "addVideo" : "addImage")} />{bad("creative.mediaRefs") && <FieldError>{t("errors.media")}</FieldError>}</Field>}
    {draft.format === "carousel" && <Field data-invalid={bad("creative.cards") || undefined}><FieldLabel>{t("cards")}</FieldLabel>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">{draft.cards.map((card, index) => <li key={card.mediaRef} className="flex flex-col gap-3 rounded-lg border p-3">
        <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{t("cardN", { n: index + 1 })}</span>
          <Button type="button" variant="ghost" size="responsive" onClick={() => set("cards", draft.cards.filter((_, i) => i !== index))}><X aria-hidden="true" />{t("removeCard")}</Button></div>
        <Field><FieldLabel htmlFor={`ads-card-h-${index}`}>{t("headline")}</FieldLabel><Input id={`ads-card-h-${index}`} className="min-h-11" value={card.headline} maxLength={80} onChange={(e) => setCard(index, { headline: e.target.value })} /></Field>
        <Field><FieldLabel htmlFor={`ads-card-l-${index}`}>{t("link")}</FieldLabel><Input id={`ads-card-l-${index}`} type="url" inputMode="url" className="min-h-11" value={card.linkUrl} maxLength={2048} onChange={(e) => setCard(index, { linkUrl: e.target.value })} /></Field>
      </li>)}</ul>
      {draft.cards.length < 10 && <AdMediaPicker tenantId={tenantId} kind="image" max={1} value={[]} previews={previews} label={t("addCard")}
        onAdd={(m) => { addPreview(m.ref, m.previewUrl); set("cards", [...draft.cards, { mediaRef: m.ref, mediaName: m.name, headline: "", linkUrl: "" }]); }} onRemove={() => undefined} />}
      {bad("creative.cards") && <FieldError>{t("errors.cards")}</FieldError>}</Field>}
    {draft.format === "messaging" && <Field data-invalid={bad("creative.messagingDestination") || undefined}><FieldLabel htmlFor="ads-destination">{t("destination")}</FieldLabel>
      <NativeSelect id="ads-destination" className="min-h-11 w-full" value={draft.messagingDestination} aria-invalid={bad("creative.messagingDestination") || undefined} onChange={(e) => set("messagingDestination", e.target.value)}>
        <option value="">{t("chooseDestination")}</option>{messagingDestinations.map((d) => <option key={d} value={d}>{t(`destinations.${d}`)}</option>)}</NativeSelect>
      {bad("creative.messagingDestination") && <FieldError>{t("errors.destination")}</FieldError>}</Field>}
    {draft.format === "call" && <Field data-invalid={bad("creative.phoneNumber") || undefined}><FieldLabel htmlFor="ads-phone">{t("phone")}</FieldLabel>
      <Input id="ads-phone" type="tel" inputMode="tel" className="min-h-11" value={draft.phoneNumber} placeholder={t("phonePlaceholder")} aria-invalid={bad("creative.phoneNumber") || undefined} onChange={(e) => set("phoneNumber", e.target.value)} />
      {bad("creative.phoneNumber") && <FieldError>{t("errors.phone")}</FieldError>}</Field>}
    <Field><FieldLabel htmlFor="ads-body">{t("text")}</FieldLabel><Textarea id="ads-body" rows={4} value={draft.body} maxLength={2000} onChange={(e) => set("body", e.target.value)} /></Field>
    {draft.format !== "carousel" && <Field><FieldLabel htmlFor="ads-headline">{t("headline")}</FieldLabel><Input id="ads-headline" className="min-h-11" value={draft.headline} maxLength={80} onChange={(e) => set("headline", e.target.value)} /></Field>}
    {draft.format !== "messaging" && draft.format !== "call" && <div className="grid gap-4 sm:grid-cols-2">
      <Field data-invalid={bad("creative.linkUrl") || undefined}><FieldLabel htmlFor="ads-link">{t("link")}</FieldLabel><Input id="ads-link" type="url" inputMode="url" className="min-h-11" value={draft.linkUrl} maxLength={2048} placeholder={t("linkPlaceholder")} aria-invalid={bad("creative.linkUrl") || undefined} onChange={(e) => set("linkUrl", e.target.value)} />
        {bad("creative.linkUrl") && <FieldError>{t("errors.link")}</FieldError>}</Field>
      <Field><FieldLabel htmlFor="ads-cta">{t("cta")}</FieldLabel><NativeSelect id="ads-cta" className="min-h-11 w-full" value={draft.cta} onChange={(e) => set("cta", e.target.value)}>
        {ctas.map((c) => <option key={c} value={c}>{t(`ctas.${c}`)}</option>)}</NativeSelect></Field></div>}
    {draft.goal === "lead_generation" && <Field data-invalid={bad("creative.leadFormId") || undefined}><FieldLabel htmlFor="ads-form">{t("leadForm")}</FieldLabel>
      <NativeSelect id="ads-form" className="min-h-11 w-full" value={draft.leadFormId} aria-invalid={bad("creative.leadFormId") || undefined} onChange={(e) => set("leadFormId", e.target.value)}>
        <option value="">{t("chooseLeadForm")}</option>{lookups.forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</NativeSelect>
      {bad("creative.leadFormId") && <FieldError>{t("errors.leadForm")}</FieldError>}
      <p className="text-sm"><Link className="font-medium underline underline-offset-4" href={`${tenantHref}/leads`}>{t("manageForms")}</Link></p></Field>}
  </FormSection>;
}
