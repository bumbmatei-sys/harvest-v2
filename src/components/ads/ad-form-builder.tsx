"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { BuildCanvas } from "@/components/crm/forms/build-canvas";
import { PublicForm } from "@/components/forms/public-form";
import { StatusBadge } from "@/components/status-badge";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { useAdsError } from "@/components/ads/ads-error";
import { useAdAccounts } from "@/components/ads/use-ad-accounts";
import { AdsApiError, type AdFormDraft } from "@/lib/ads/api";
import { adFieldKeys, adFormIssues, adConsentKinds, type AdFieldKey, type AdFormIssue } from "@/lib/ads/lead-form";
import { adStandardBlock, hasAdConsent, setAdConsent } from "@/lib/ads/lead-form-builder";
import { AD_CONSENT_IDS } from "@/lib/ads/lead-form";
import type { FormBlock, FormDefinition } from "@/lib/crm-forms";
import { notify } from "@/lib/toast";

/**
 * The lead form builder: the shared forms question builder with the ad preset beside it (privacy link, which question collects which standard answer, the optional consent questions, and
 * publishing to an ad account). Saving is explicit; a form published once is frozen, and editing it afterwards starts a new version. Publishing is hard-off outside the test provider.
 */
export function AdFormBuilder({ tenantId, formId }: { tenantId: string; formId: string }) {
  const t = useTranslations("Ads.builder"), l = useTranslations("Ads"), explain = useAdsError();
  const { api, accounts } = useAdAccounts(tenantId);
  const [loaded, setLoaded] = useState<AdFormDraft | null>(null), [form, setForm] = useState<FormDefinition | null>(null), [saved, setSaved] = useState(""), [revision, setRevision] = useState(1);
  const [selected, setSelected] = useState<string | null>(null), [busy, setBusy] = useState<"save" | "publish" | null>(null), [error, setError] = useState(""), [account, setAccount] = useState(""), [published, setPublished] = useState(false), [missing, setMissing] = useState(false);
  const base = `/workspaces/${tenantId}/social/ads/leads`;

  useEffect(() => {
    let cancelled = false;
    api.formDraft(formId).then((draft) => { if (cancelled) return; setLoaded(draft); setForm(draft.definition); setSaved(JSON.stringify(draft.definition)); setRevision(draft.definition.revision); })
      .catch((cause: unknown) => { if (!cancelled) { if (cause instanceof AdsApiError && cause.unavailable) setMissing(true); else setError(explain(cause)); } });
    return () => { cancelled = true; };
  }, [api, formId, explain]);

  const issues = useMemo<AdFormIssue[]>(() => form ? adFormIssues(form) : [], [form]);
  const dirty = form !== null && JSON.stringify(form) !== saved;
  const network = form?.ads?.network ?? "";
  const eligible = accounts.filter((item) => item.network === network);
  const mapTo = (block: FormBlock, key: string) => setForm((current) => {
    if (!current?.ads) return current;
    const fields = Object.fromEntries(Object.entries(current.ads.fields).filter(([id, value]) => id !== block.id && value !== key));
    return { ...current, ads: { ...current.ads, fields: key ? { ...fields, [block.id]: key as AdFieldKey } : fields } };
  });

  async function save(): Promise<boolean> {
    if (!form) return false;
    setBusy("save"); setError("");
    try {
      const result = await api.saveFormDraft(formId, form, revision);
      setForm(result.definition); setSaved(JSON.stringify(result.definition)); setRevision(result.revision); return true;
    } catch (cause) { setError(explain(cause)); return false; } finally { setBusy(null); }
  }
  async function publish() {
    const target = account || eligible[0]?.id;
    if (!target) return;
    if (dirty && !(await save())) return;
    setBusy("publish"); setError("");
    try { await api.publishForm(formId, target, revision); setPublished(true); notify.success(t("publishedToast")); }
    catch (cause) { setError(cause instanceof AdsApiError && cause.unavailable ? t("publishOff") : explain(cause)); } finally { setBusy(null); }
  }

  if (missing) return <Alert role="status"><AlertDescription>{t("missing")}</AlertDescription></Alert>;
  if (!form || !loaded) return <p role="status" className="text-sm text-muted-foreground">{error || t("loading")}</p>;
  const questions = form.blocks.filter((block) => block.type === "short" || block.type === "email" || block.type === "phone").filter((block) => !adConsentKinds.some((kind) => AD_CONSENT_IDS[kind] === block.id));
  return <div className="flex min-w-0 flex-col gap-6" data-testid="ads-form-builder" data-ads-builder-ready="true">
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="min-w-0"><Button asChild variant="ghost" size="sm" className="-ms-2 mb-1"><Link href={`${base}`}><ArrowLeft aria-hidden="true" />{t("back")}</Link></Button>
        <div className="flex flex-wrap items-center gap-3"><h1 className="text-[28px] font-semibold tracking-tight">{form.title || t("untitled")}</h1>
          <StatusBadge tone={published || loaded.publications.length ? "success" : "pending"} dot label={published || loaded.publications.length ? t("state.published") : t("state.draft")} /></div></div>
    </header>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {loaded.frozen && <Alert role="status"><AlertDescription>{t("frozen")}</AlertDescription></Alert>}
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="flex min-w-0 flex-col gap-4" aria-label={t("questions")}>
        <Field><FieldLabel htmlFor="ads-form-title">{t("formName")}</FieldLabel>
          <Input id="ads-form-title" className="min-h-11" value={form.title} maxLength={120} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field>
        <BuildCanvas form={form} change={(fn) => setForm((current) => current && fn(current))} selected={selected} setSelected={setSelected} notify={(message) => notify.info(message)} />
      </section>
      <aside className="flex min-w-0 flex-col gap-4" aria-label={t("settings")}>
        <Card><CardHeader><CardTitle>{t("privacy")}</CardTitle></CardHeader><CardContent className="flex flex-col gap-4">
          <Field data-invalid={issues.includes("noPrivacy") || undefined}><FieldLabel htmlFor="ads-form-privacy">{t("privacyUrl")}</FieldLabel>
            <Input id="ads-form-privacy" type="url" inputMode="url" className="min-h-11" value={form.ads?.privacyUrl ?? ""} aria-invalid={issues.includes("noPrivacy") || undefined}
              onChange={(event) => setForm((current) => current?.ads ? { ...current, ads: { ...current.ads, privacyUrl: event.target.value } } : current)} />
            {issues.includes("noPrivacy") && <FieldError>{t("issue.noPrivacy")}</FieldError>}</Field>
          <p className="text-sm text-muted-foreground" data-ads-notice>{form.ads?.texts.notice}</p>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>{t("answers")}</CardTitle></CardHeader><CardContent className="flex flex-col gap-3">
          {questions.length === 0 ? <p className="text-sm text-muted-foreground">{t("noQuestions")}</p> : questions.map((block) => {
            const current = form.ads?.fields[block.id] ?? "";
            return <Field key={block.id}><FieldLabel htmlFor={`ads-map-${block.id}`}>{block.label || t("untitled")}</FieldLabel>
              <NativeSelect id={`ads-map-${block.id}`} className="min-h-11 w-full" value={current} onChange={(event) => mapTo(block, event.target.value)}>
                <option value="">{t("customQuestion")}</option>{adFieldKeys.filter((key) => adStandardBlock[key] === block.type).map((key) => <option key={key} value={key}>{t(`standard.${key}`)}</option>)}</NativeSelect></Field>;
          })}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>{t("consent")}</CardTitle></CardHeader><CardContent className="flex flex-col gap-3">
          {adConsentKinds.map((kind) => <label key={kind} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border p-3 text-sm"><span>{t(`consentKind.${kind}`)}</span>
            <Switch checked={hasAdConsent(form, kind)} onCheckedChange={(on) => setForm((current) => current && setAdConsent(current, kind, on, ""))} /></label>)}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>{t("publish")}</CardTitle></CardHeader><CardContent className="flex flex-col gap-3">
          {issues.length > 0 && <Alert variant="destructive" role="status"><AlertDescription><ul className="list-disc ps-5">{issues.map((issue) => <li key={issue}>{t(`issue.${issue}`)}</li>)}</ul></AlertDescription></Alert>}
          {eligible.length === 0 ? <p className="text-sm text-muted-foreground">{t("noAccount", { network: l.has(`networks.${network}`) ? l(`networks.${network}`) : l("networks.other") })}</p>
            : <Field><FieldLabel htmlFor="ads-form-account">{t("account")}</FieldLabel><NativeSelect id="ads-form-account" className="min-h-11 w-full" value={account || eligible[0].id} onChange={(event) => setAccount(event.target.value)}>
              {eligible.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></Field>}
          {published && <Alert role="status" data-ads-published><CheckCircle2 aria-hidden="true" /><AlertDescription>{t("published")}</AlertDescription></Alert>}
          <Button type="button" size="responsive" disabled={issues.length > 0 || eligible.length === 0 || busy !== null} onClick={() => void publish()} data-ads-publish><Send aria-hidden="true" />{busy === "publish" ? t("publishing") : t("publishButton")}</Button>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>{t("preview")}</CardTitle></CardHeader><CardContent><PublicForm form={form} idPrefix="adpf" preview /></CardContent></Card>
      </aside>
    </div>
    <StickySaveBar dirty={dirty} busy={busy === "save"} onSave={() => void save()} onDiscard={() => setForm(JSON.parse(saved) as FormDefinition)} saveLabel={t("save")} savingLabel={t("saving")} />
  </div>;
}
