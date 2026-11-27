"use client";
import "@/components/docs/docs-prose.css";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { DocEditorSurface, type SurfaceHandle } from "@/components/docs/doc-editor-surface";
import { FormSection } from "@/components/form-section";
import { StatusBadge } from "@/components/status-badge";
import { Stars } from "@/components/catalog/landing/landing-review-card";
import { useRequest } from "@/hooks/use-request";
import { centsToInput, landingCurrencies, landingLimits, saleProblem, toCents, type LandingCurrency } from "@/lib/catalog-landing";
import { emptyContent, type DocContent } from "@/lib/docs";

export type SalesLanding = { version: number; subtitle: string; body: unknown; included: string[]; aboutHeading: string; aboutBody: string; aboutPhotoId: string | null;
  faq: { question: string; answer: string }[]; ctaQuote: string; ctaLabel: string; price: { cents: number; currency: LandingCurrency } | null;
  sale: { cents: number; startsAt: string; endsAt: string } | null };
export type SalesReview = { userId: string; name: string; rating: number; body: string; hidden: boolean; updatedAt: string };
const slashExclude = ["suggestSubpage", "suggestPage", "template", "mention", "toc", "stickyToc"];
/** A datetime-local value (the owner's own time) as an instant, or null. */
const iso = (local: string) => { const ms = local ? Date.parse(local) : NaN; return Number.isNaN(ms) ? null : new Date(ms).toISOString(); };
const localInput = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value), pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * The "Sales page" step of the course and product editor: the landing's subtitle, long description (the native blog's block editor), what's included, about the
 * creator (heading, bio and a ready image from Files), questions, the final call to action, and the shown-only price with an optional sale. Saved on its own with
 * the landing's version, so it can change while the item is published. Owners and admins also hide or show reviews here (audited by the server).
 */
export function SalesPageEditor({ tenantId, itemId, initial, reviews: initialReviews, images, disabled }: { tenantId: string; itemId: string; initial: SalesLanding;
  reviews: SalesReview[]; images: { id: string; name: string }[]; disabled: boolean }) {
  const t = useTranslations("Catalog.editor.sales"), request = useRequest();
  const [landing, setLanding] = useState(initial), [reviews, setReviews] = useState(initialReviews);
  const [price, setPrice] = useState(centsToInput(initial.price?.cents)), [currency, setCurrency] = useState<LandingCurrency>(initial.price?.currency ?? "USD");
  const [sale, setSale] = useState(centsToInput(initial.sale?.cents)), [starts, setStarts] = useState(localInput(initial.sale?.startsAt)), [ends, setEnds] = useState(localInput(initial.sale?.endsAt));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [problem, setProblem] = useState("");
  const surface = useRef<SurfaceHandle | null>(null), readBody = useRef<(() => DocContent) | null>(null);
  const api = `/api/workspaces/${tenantId}/catalog/${itemId}/landing`;
  const set = <K extends keyof SalesLanding>(key: K, value: SalesLanding[K]) => { setNotice(""); setLanding((current) => ({ ...current, [key]: value })); };

  function payload() {
    const priceCents = price.trim() ? toCents(price) : null, saleCents = sale.trim() ? toCents(sale) : null;
    if ((price.trim() && priceCents === null) || (sale.trim() && saleCents === null)) return { problem: "amount" as const };
    const priced = priceCents ? { cents: priceCents, currency } : null;
    const saleValue = saleCents ? { cents: saleCents, startsAt: iso(starts) ?? new Date().toISOString(), endsAt: iso(ends) ?? "" } : null;
    const issue = saleProblem({ price: priced, sale: saleValue }, Date.now());
    if (issue) return { problem: issue };
    return { body: { ...landing, body: readBody.current ? readBody.current() : landing.body, price: priced, sale: saleValue,
      included: landing.included.map((item) => item.trim()).filter(Boolean), faq: landing.faq.filter((row) => row.question.trim() && row.answer.trim()) } };
  }
  async function save() {
    setError(""); setNotice(""); setProblem("");
    const next = payload();
    if ("problem" in next && next.problem) { setProblem(next.problem); return; }
    setBusy(true);
    const result = await request<{ version: number }>(api, { method: "PUT", body: next.body });
    setBusy(false);
    if (!result.ok) {
      const reason = String(result.details?.reason ?? "");
      if (reason.startsWith("sale_")) setProblem(reason.slice(5)); else if (reason === "photo") setError(t("photoInvalid")); else if (reason === "body") setError(t("bodyInvalid")); else setError(result.error);
      return;
    }
    setLanding((current) => ({ ...current, version: result.data.version })); setNotice(t("saved"));
  }
  async function toggle(review: SalesReview) {
    setError("");
    const result = await request<{ hidden: boolean }>(`${api}/reviews/${encodeURIComponent(review.userId)}`, { method: "PUT", body: { hidden: !review.hidden } });
    if (!result.ok) { setError(result.error); return; }
    setReviews((current) => current.map((row) => row.userId === review.userId ? { ...row, hidden: result.data.hidden } : row));
  }
  const list = (key: "included", index: number, value: string) => set(key, landing[key].map((item, i) => (i === index ? value : item)));
  const faq = (index: number, patch: Partial<{ question: string; answer: string }>) => set("faq", landing.faq.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return <div className="space-y-6" data-slot="sales-page-editor">
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
    <FormSection title={t("title")}>
      <Field><FieldLabel htmlFor="sales-subtitle">{t("subtitle")}</FieldLabel>
        <Input id="sales-subtitle" className="min-h-11" maxLength={landingLimits.subtitle} value={landing.subtitle} disabled={disabled} onChange={(e) => set("subtitle", e.target.value)} /></Field>
      <div className="space-y-2">
        <p className="text-sm font-medium" id="sales-body-label">{t("body")}</p>
        <div className="rounded-md border">
          <DocEditorSurface content={(landing.body as DocContent | null) ?? emptyContent()} readOnly={disabled} showToolbar={!disabled} handleRef={surface} label={t("body")}
            bodyClassName="min-h-48 w-full px-4 pb-6 pt-2" slashExclude={slashExclude} mentions={false}
            onChange={(read) => { readBody.current = read; setNotice(""); }} onNewPage={() => {}} onInsert={() => {}} mentionSource={async () => []} onOutline={() => {}} onStats={() => {}} />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("included")}</legend>
        <ol className="space-y-2">{landing.included.map((item, index) => <li key={index} className="flex items-center gap-2">
          <Input className="min-h-11" aria-label={t("includedItem", { number: index + 1 })} maxLength={landingLimits.includedItem} value={item} disabled={disabled} onChange={(e) => list("included", index, e.target.value)} />
          <Button type="button" variant="outline" size="icon" className="size-11 shrink-0" disabled={disabled} aria-label={t("removeItem", { number: index + 1 })}
            onClick={() => set("included", landing.included.filter((_, i) => i !== index))}><Trash2 aria-hidden="true" /></Button></li>)}</ol>
        <Button type="button" variant="outline" className="min-h-11" disabled={disabled || landing.included.length >= landingLimits.included} onClick={() => set("included", [...landing.included, ""])}>
          <Plus aria-hidden="true" />{t("addItem")}</Button>
      </fieldset>
    </FormSection>

    <FormSection title={t("aboutTitle")}>
      <Field><FieldLabel htmlFor="sales-about-heading">{t("aboutHeading")}</FieldLabel>
        <Input id="sales-about-heading" className="min-h-11" maxLength={landingLimits.aboutHeading} value={landing.aboutHeading} disabled={disabled} onChange={(e) => set("aboutHeading", e.target.value)} /></Field>
      <Field><FieldLabel htmlFor="sales-about-body">{t("aboutBody")}</FieldLabel>
        <Textarea id="sales-about-body" rows={4} maxLength={landingLimits.aboutBody} value={landing.aboutBody} disabled={disabled} onChange={(e) => set("aboutBody", e.target.value)} /></Field>
      <Field><FieldLabel htmlFor="sales-photo">{t("photo")}</FieldLabel>
        <NativeSelect id="sales-photo" className="min-h-11 w-full" value={landing.aboutPhotoId ?? ""} disabled={disabled} onChange={(e) => set("aboutPhotoId", e.target.value || null)} aria-describedby="sales-photo-hint">
          <NativeSelectOption value="">{t("noPhoto")}</NativeSelectOption>
          {images.map((image) => <NativeSelectOption key={image.id} value={image.id}>{image.name}</NativeSelectOption>)}
        </NativeSelect>
        <FieldDescription id="sales-photo-hint">{t("photoHint")}</FieldDescription></Field>
    </FormSection>

    <FormSection title={t("faqTitle")}>
      <ol className="space-y-4">{landing.faq.map((row, index) => <li key={index} className="space-y-2 rounded-md border p-3">
        <div className="flex items-center gap-2">
          <Input className="min-h-11" aria-label={t("question", { number: index + 1 })} maxLength={landingLimits.question} value={row.question} disabled={disabled} onChange={(e) => faq(index, { question: e.target.value })} />
          <Button type="button" variant="outline" size="icon" className="size-11 shrink-0" disabled={disabled} aria-label={t("removeQuestion", { number: index + 1 })}
            onClick={() => set("faq", landing.faq.filter((_, i) => i !== index))}><Trash2 aria-hidden="true" /></Button>
        </div>
        <Textarea rows={3} aria-label={t("answer", { number: index + 1 })} maxLength={landingLimits.answer} value={row.answer} disabled={disabled} onChange={(e) => faq(index, { answer: e.target.value })} />
      </li>)}</ol>
      <Button type="button" variant="outline" className="min-h-11" disabled={disabled || landing.faq.length >= landingLimits.faq} onClick={() => set("faq", [...landing.faq, { question: "", answer: "" }])}>
        <Plus aria-hidden="true" />{t("addQuestion")}</Button>
    </FormSection>

    <FormSection title={t("ctaTitle")}>
      <Field><FieldLabel htmlFor="sales-cta-quote">{t("ctaQuote")}</FieldLabel>
        <Textarea id="sales-cta-quote" rows={2} maxLength={landingLimits.ctaQuote} value={landing.ctaQuote} disabled={disabled} onChange={(e) => set("ctaQuote", e.target.value)} /></Field>
      <Field><FieldLabel htmlFor="sales-cta-label">{t("ctaLabel")}</FieldLabel>
        <Input id="sales-cta-label" className="min-h-11" maxLength={landingLimits.ctaLabel} value={landing.ctaLabel} disabled={disabled} onChange={(e) => set("ctaLabel", e.target.value)} /></Field>
    </FormSection>

    <FormSection title={t("priceTitle")}>
      <Alert><AlertDescription>{t("checkoutOff")}</AlertDescription></Alert>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field><FieldLabel htmlFor="sales-price">{t("price")}</FieldLabel>
          <Input id="sales-price" inputMode="decimal" className="min-h-11" value={price} disabled={disabled} aria-describedby="sales-price-free" onChange={(e) => { setProblem(""); setPrice(e.target.value); }} />
          <FieldDescription id="sales-price-free">{t("free")}</FieldDescription></Field>
        <Field><FieldLabel htmlFor="sales-currency">{t("currency")}</FieldLabel>
          <NativeSelect id="sales-currency" className="min-h-11 w-full" value={currency} disabled={disabled} onChange={(e) => setCurrency(e.target.value as LandingCurrency)}>
            {landingCurrencies.map((code) => <NativeSelectOption key={code} value={code}>{code}</NativeSelectOption>)}</NativeSelect></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field><FieldLabel htmlFor="sales-sale">{t("sale")}</FieldLabel>
          <Input id="sales-sale" inputMode="decimal" className="min-h-11" value={sale} disabled={disabled} aria-invalid={problem ? true : undefined} onChange={(e) => { setProblem(""); setSale(e.target.value); }} /></Field>
        <Field><FieldLabel htmlFor="sales-starts">{t("saleStarts")}</FieldLabel>
          <Input id="sales-starts" type="datetime-local" className="min-h-11" value={starts} disabled={disabled} onChange={(e) => { setProblem(""); setStarts(e.target.value); }} /></Field>
        <Field><FieldLabel htmlFor="sales-ends">{t("saleEnds")}</FieldLabel>
          <Input id="sales-ends" type="datetime-local" className="min-h-11" value={ends} disabled={disabled} onChange={(e) => { setProblem(""); setEnds(e.target.value); }} /></Field>
      </div>
      {problem && <FieldError>{t(`saleProblems.${problem as "amount"}`)}</FieldError>}
    </FormSection>

    {!disabled && <Button type="button" className="min-h-11" disabled={busy} onClick={() => void save()}>{busy && <Spinner decorative size="sm" />}{busy ? t("saving") : t("save")}</Button>}

    <FormSection title={t("reviewsTitle")}>
      {reviews.length === 0 ? <p className="text-sm text-muted-foreground">{t("noReviews")}</p>
        : <ul className="divide-y rounded-lg border" aria-label={t("reviewsTitle")}>{reviews.map((review) => <li key={review.userId} className="flex flex-wrap items-start gap-3 p-3">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{review.name || t("learner")}
              <StatusBadge tone={review.hidden ? "warning" : "success"} label={t(review.hidden ? "hidden" : "visible")} /></p>
            <Stars value={review.rating} />
            {review.body && <p className="text-sm break-words whitespace-pre-line">{review.body}</p>}
          </div>
          {!disabled && <Button type="button" variant="outline" className="min-h-11" aria-label={t(review.hidden ? "showNamed" : "hideNamed", { name: review.name || t("learner") })}
            onClick={() => void toggle(review)}>{t(review.hidden ? "show" : "hide")}</Button>}
        </li>)}</ul>}
    </FormSection>
  </div>;
}
