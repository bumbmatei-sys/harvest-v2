"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { locales, type Locale } from "@/i18n/locale";
import { useHydrated } from "@/hooks/use-hydrated";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ProfileForm({ current,personal=false }: { current: string | null;personal?:boolean }) {
  const t = useTranslations("Profile"), router = useRouter(), hydrated = useHydrated();
  const [locale, setLocale] = useState(current ?? "auto");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: locale === "auto" ? null : locale }) });
      if (response.status === 401) { router.replace(personal?"/sign-in?personal=1":"/sign-in"); return; }
      if (!response.ok) { setError(t("saveFailed")); return; }
      setSaved(true); router.refresh();
    } catch { setError(t("connectionFailed")); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-5">
    <Field><FieldLabel htmlFor="profile-locale">{t("language")}</FieldLabel>
      <Select value={locale} onValueChange={setLocale} disabled={!hydrated || busy}>
        <SelectTrigger className="min-h-11" id="profile-locale" aria-describedby="locale-help"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="auto">{t("automatic")}</SelectItem>{locales.map((code: Locale) => <SelectItem key={code} value={code}>{t(`languages.${code}`)}</SelectItem>)}</SelectContent>
      </Select>
      <FieldDescription id="locale-help">{t("help")}</FieldDescription>
    </Field>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {saved && <Alert role="status"><AlertDescription>{t("saved")}</AlertDescription></Alert>}
    <Button className="min-h-11" disabled={!hydrated || busy}>{t(busy ? "saving" : "save")}</Button>
  </form>;
}
