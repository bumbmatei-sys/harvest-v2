"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, Plus, UserRound, X } from "lucide-react";
import { AMOUNT } from "@/lib/crm-deals";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RecordPicker, type PickerItem } from "../record-picker";
import { useCrmRequest } from "../request";

type Relation = { id: string; label: string } | null;

/** New deal: name, stage, amount, expected close, owner, and a company and/or a person. */
export function DealForm({ tenantId, pipelineId, stages, members, company = null, person = null, variant = "default" }: {
  tenantId: string; pipelineId?: string; stages?: { id: string; name: string }[]; members: { id: string; name: string }[];
  company?: Relation; person?: Relation; variant?: "default" | "outline";
}) {
  const t = useTranslations("Deals");
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [companyValue, setCompany] = useState<Relation>(company), [personValue, setPerson] = useState<Relation>(person);
  function reset(value: boolean) { setOpen(value); if (value) { setError(""); setCompany(company); setPerson(person); } }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget), amount = String(form.get("amount") ?? "").trim();
    if (amount && !AMOUNT.test(amount)) { setError(t("enterAnAmount")); return; }
    if (!companyValue && !personValue) { setError(t("linkACompanyOrPerson")); return; }
    setBusy(true);
    const result = await crmRequest<{ id: string }>(`/api/workspaces/${tenantId}/crm/deals`, { method: "POST", body: {
      name: String(form.get("name") ?? "").trim(), amount, expectedCloseDate: String(form.get("close") ?? ""), ownerUserId: String(form.get("owner") ?? ""),
      ...(pipelineId ? { pipelineId } : {}), ...(form.get("stage") ? { stageId: String(form.get("stage")) } : {}),
      companyId: companyValue?.id ?? null, contactId: personValue?.id ?? null,
    } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setOpen(false); router.refresh();
  }
  const picker = (kind: "company" | "person", value: Relation, set: (value: Relation) => void) => <div className="flex min-h-9 items-center gap-2 rounded-md border px-2">
    {kind === "company" ? <Building2 className="size-4 text-muted-foreground" aria-hidden="true" /> : <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />}
    <span className={value ? "min-w-0 flex-1 truncate text-sm" : "min-w-0 flex-1 truncate text-sm text-muted-foreground"}>{value?.label ?? (kind === "company" ? t("noCompany") : t("noPerson"))}</span>
    <RecordPicker endpoint={`/api/workspaces/${tenantId}/${kind === "company" ? "companies" : "contacts"}`} toItem={(row) => ({ id: String(row.id), label: String(row.name) })} exclude={value ? [value.id] : []}
      title={kind === "company" ? t("chooseCompany") : t("choosePerson")} placeholder={kind === "company" ? t("searchCompanies") : t("searchPeople")} emptyLabel={t("noRecordsFound")} align="end"
      trigger={<Button type="button" size="sm" variant="ghost" className="h-7 text-xs" aria-label={value ? (kind === "company" ? t("changeCompany") : t("changePerson")) : kind === "company" ? t("chooseCompany") : t("choosePerson")}>{value ? t("change") : t("choose")}</Button>}
      onSelect={(item: PickerItem) => { set({ id: item.id, label: item.label }); }} />
    {value && <Button type="button" size="icon-sm" variant="ghost" aria-label={kind === "company" ? t("clearCompany") : t("clearPerson")} onClick={() => set(null)}><X aria-hidden="true" /></Button>}
  </div>;
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) reset(value); }}>
    <DialogTrigger asChild><Button size="sm" variant={variant}><Plus aria-hidden="true" />{t("newDeal")}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[480px]">
      <DialogHeader><DialogTitle>{t("newDeal")}</DialogTitle><DialogDescription>{t("newDealDescription")}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Field className="gap-2"><FieldLabel htmlFor="deal-name">{t("dealName")}</FieldLabel><Input id="deal-name" name="name" required maxLength={200} autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {stages && stages.length > 0 && <Field className="gap-2"><FieldLabel htmlFor="deal-stage">{t("stage")}</FieldLabel>
            <NativeSelect id="deal-stage" name="stage" className="w-full">{stages.map((stage) => <NativeSelectOption key={stage.id} value={stage.id}>{stage.name}</NativeSelectOption>)}</NativeSelect></Field>}
          <Field className="gap-2"><FieldLabel htmlFor="deal-amount">{t("amountUsd")}</FieldLabel><Input id="deal-amount" name="amount" inputMode="decimal" maxLength={15} placeholder={t("amountPlaceholder")} /></Field>
          <Field className="gap-2"><FieldLabel htmlFor="deal-close">{t("expectedClose")}</FieldLabel><Input id="deal-close" name="close" type="date" /></Field>
          <Field className="gap-2"><FieldLabel htmlFor="deal-owner">{t("owner")}</FieldLabel>
            <NativeSelect id="deal-owner" name="owner" className="w-full"><NativeSelectOption value="">{t("noOwner")}</NativeSelectOption>{members.map((member) => <NativeSelectOption key={member.id} value={member.id}>{member.name}</NativeSelectOption>)}</NativeSelect></Field>
        </div>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">{t("linkedTo")}</legend>
          {picker("company", companyValue, setCompany)}{picker("person", personValue, setPerson)}
          <p className="text-xs text-muted-foreground">{t("linkedToHelp")}</p>
        </fieldset>
        <DialogFooter><DialogClose asChild><Button type="button" variant="ghost" disabled={busy}>{t("cancel")}</Button></DialogClose><Button disabled={busy}>{busy ? t("saving") : t("createDeal")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
