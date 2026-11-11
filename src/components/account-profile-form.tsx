"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { locales, type Locale } from "@/i18n/locale";
import { useHydrated } from "@/hooks/use-hydrated";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Initial = { name: string; locale: string | null; cityRegion: string | null };
// Only "Explore later" works until the community, course and church destinations exist.
const paths = [["explore_later", "exploreLater", true], ["find_community", "findCommunity", false], ["bible_course", "bibleCourse", false], ["find_church", "findChurch", false]] as const;

export function AccountProfileForm({ initial, mode, from }: { initial: Initial; mode: "onboarding" | "profile"; from?: string }) {
  const t = useTranslations("AccountProfile"), languages = useTranslations("Profile"), router = useRouter(), hydrated = useHydrated();
  const [name, setName] = useState(initial.name), [locale, setLocale] = useState(initial.locale ?? "auto"), [city, setCity] = useState(initial.cityRegion ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const welcome = `/account/welcome${from ? `?from=${encodeURIComponent(from)}` : ""}`;
  const values = () => ({ name: name.trim(), locale: locale === "auto" ? null : locale, cityRegion: city.trim() || null });

  async function send(url: string, method: string, body: unknown, next?: string) {
    setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (response.status === 401) { router.replace("/sign-in?personal=1"); return; }
      if (!response.ok) { setError(t("saveFailed")); return; }
      if (next) { router.replace(next); return; }
      setSaved(true); router.refresh();
    } catch { setError(t("connectionFailed")); }
    finally { setBusy(false); }
  }
  function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "onboarding") void send("/api/account/onboarding", "POST", { action: "save", ...values() }, welcome);
    else void send("/api/account/profile", "PUT", values());
  }
  return <form onSubmit={submit} className="space-y-5">
    <Field><FieldLabel htmlFor="account-name">{t("name")}</FieldLabel>
      <Input id="account-name" className="min-h-11" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" required disabled={!hydrated || busy} /></Field>
    <Field><FieldLabel htmlFor="account-locale">{t("language")}</FieldLabel>
      <Select value={locale} onValueChange={setLocale} disabled={!hydrated || busy}>
        <SelectTrigger className="min-h-11" id="account-locale"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="auto">{t("automatic")}</SelectItem>{locales.map((code: Locale) => <SelectItem key={code} value={code}>{languages(`languages.${code}`)}</SelectItem>)}</SelectContent>
      </Select></Field>
    <Field><FieldLabel htmlFor="account-city">{t("city")}</FieldLabel>
      <Input id="account-city" className="min-h-11" value={city} onChange={(e) => setCity(e.target.value)} maxLength={200} autoComplete="address-level2" disabled={!hydrated || busy} /></Field>
    {mode === "onboarding" && <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{t("firstStep")}</legend>
      <RadioGroup value="explore_later" aria-label={t("firstStep")}>
        {paths.map(([value, key, enabled]) => <label key={value} htmlFor={`path-${value}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 py-2">
          <RadioGroupItem id={`path-${value}`} value={value} disabled={!enabled} />
          <span className="flex-1">{t(key)}</span>
          {!enabled && <Badge variant="secondary">{t("comingSoon")}</Badge>}
        </label>)}
      </RadioGroup>
    </fieldset>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {saved && <Alert role="status"><AlertDescription>{t("saved")}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-3">
      <Button className="min-h-11" disabled={!hydrated || busy || !name.trim()}>{t(busy ? "saving" : mode === "onboarding" ? "saveContinue" : "save")}</Button>
      {mode === "onboarding" && <Button type="button" variant="outline" className="min-h-11" disabled={!hydrated || busy} onClick={() => void send("/api/account/onboarding", "POST", { action: "skip" }, welcome)}>{t("skip")}</Button>}
    </div>
  </form>;
}
