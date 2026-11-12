"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useRequest } from "@/hooks/use-request";
import { locales } from "@/i18n/locale";

export function CreateLinkDialog({ endpoint, formVersions }: { endpoint: string; formVersions: { id: string; version: number; formName: string }[] }) {
  const t = useTranslations("ConnectLinks");
  const router = useRouter(), request = useRequest(), id = useId();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(form: FormData) {
    setBusy(true); setError("");
    const result = await request(endpoint, { method: "POST", body: { label: form.get("label"), publicTitle: form.get("publicTitle"),
      locale: form.get("locale"), formVersionId: form.get("formVersionId") || null } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setOpen(false); router.refresh();
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) { setOpen(value); setError(""); } }}>
    <DialogTrigger asChild><Button type="button" className="min-h-11"><Plus aria-hidden="true" />{t("create")}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[520px]">
      <DialogHeader><DialogTitle>{t("createTitle")}</DialogTitle><DialogDescription>{t("createDescription")}</DialogDescription></DialogHeader>
      <form id={id} action={(form) => void submit(form)}>
        <FieldGroup>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <Field><FieldLabel htmlFor={`${id}-label`}>{t("label")}</FieldLabel>
            <Input id={`${id}-label`} name="label" maxLength={80} className="min-h-11" aria-describedby={`${id}-label-help`} />
            <FieldDescription id={`${id}-label-help`}>{t("labelHelp")}</FieldDescription></Field>
          <Field><FieldLabel htmlFor={`${id}-title`}>{t("publicTitle")}</FieldLabel>
            <Input id={`${id}-title`} name="publicTitle" maxLength={120} className="min-h-11" aria-describedby={`${id}-title-help`} />
            <FieldDescription id={`${id}-title-help`}>{t("publicTitleHelp")}</FieldDescription></Field>
          <Field><FieldLabel htmlFor={`${id}-locale`}>{t("locale")}</FieldLabel>
            <NativeSelect id={`${id}-locale`} name="locale" defaultValue="en" className="min-h-11" aria-describedby={`${id}-locale-help`}>
              {locales.map((locale) => <NativeSelectOption key={locale} value={locale}>{t(`locales.${locale}`)}</NativeSelectOption>)}
            </NativeSelect>
            <FieldDescription id={`${id}-locale-help`}>{t("localeHelp")}</FieldDescription></Field>
          <Field><FieldLabel htmlFor={`${id}-form`}>{t("form")}</FieldLabel>
            <NativeSelect id={`${id}-form`} name="formVersionId" defaultValue="" className="min-h-11" aria-describedby={`${id}-form-help`}>
              <NativeSelectOption value="">{t("resourcesOnly")}</NativeSelectOption>
              {formVersions.map((version) => <NativeSelectOption key={version.id} value={version.id}>{t("formOption", { name: version.formName, version: version.version })}</NativeSelectOption>)}
            </NativeSelect>
            <FieldDescription id={`${id}-form-help`}>{t("formHelp")}</FieldDescription></Field>
        </FieldGroup>
      </form>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="ghost" className="min-h-11" disabled={busy}>{t("cancel")}</Button></DialogClose>
        <Button type="submit" form={id} className="min-h-11" disabled={busy}>{busy ? t("creating") : t("createSubmit")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
