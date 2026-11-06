"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CSV_MAX_BYTES } from "@/lib/csv";
import { message } from "@/i18n/messages";
import { useCrmRequest } from "../request";

/**
 * Step 1: choose People or Companies and a CSV file. The file is read in the browser and sent
 * once; a key generated per chosen file makes a repeated submit return the same import.
 */
export function NewImportDialog({ tenantId, entity: initial = "person", defaultOpen = false }: { tenantId: string; entity?: "person" | "company"; defaultOpen?: boolean }) {
  const t = useTranslations("Imports");
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const [open, setOpen] = useState(defaultOpen), [entity, setEntity] = useState(initial), [file, setFile] = useState<{ file: File; key: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (!file) { setError(t("chooseAFile")); return; }
    if (file.file.size > CSV_MAX_BYTES) { setError(message("Errors.theFileIsLargerThan5Mb")); return; }
    setBusy(true);
    const csv = await file.file.text();
    const result = await crmRequest<{ id: string }>(`/api/workspaces/${tenantId}/crm/imports`, { method: "POST", body: { entity, clientKey: file.key, fileName: file.file.name.slice(0, 200) || "import.csv", csv } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    router.push(`/workspaces/${tenantId}/crm/imports/${result.data.id}`);
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) { setOpen(value); setError(""); } }}>
    <DialogTrigger asChild><Button className="min-h-11"><FileUp aria-hidden="true" />{t("newImport")}</Button></DialogTrigger>
    <DialogContent className="rounded-xl sm:max-w-[480px]">
      <DialogHeader><DialogTitle>{t("newImportTitle")}</DialogTitle><DialogDescription>{t("newImportDescription")}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <FieldSet><FieldLegend variant="label">{t("importInto")}</FieldLegend>
          <RadioGroup value={entity} onValueChange={(value) => setEntity(value as "person" | "company")} className="flex gap-6">
            {(["person", "company"] as const).map((value) => <Label key={value} htmlFor={`import-entity-${value}`} className="flex min-h-11 items-center gap-2"><RadioGroupItem id={`import-entity-${value}`} value={value} />{value === "person" ? t("people") : t("companies")}</Label>)}
          </RadioGroup>
        </FieldSet>
        <Field className="gap-2"><FieldLabel htmlFor="import-file">{t("file")}</FieldLabel>
          <Input className="min-h-11" id="import-file" type="file" accept=".csv,text/csv" aria-describedby="import-file-help"
            onChange={(event) => { const chosen = event.currentTarget.files?.[0]; setFile(chosen ? { file: chosen, key: crypto.randomUUID() } : null); setError(""); }} />
          <FieldDescription id="import-file-help" className="text-xs">{t("fileHelp")}</FieldDescription></Field>
        <DialogFooter><DialogClose asChild><Button className="min-h-11" type="button" variant="ghost" disabled={busy}>{t("cancel")}</Button></DialogClose>
          <Button className="min-h-11" disabled={busy}>{busy ? t("uploading") : t("upload")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
