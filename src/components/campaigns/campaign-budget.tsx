"use client";
import { useId, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { PiggyBank, Plus, Receipt } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { useRequest } from "@/hooks/use-request";
import { budgetCategories, spentPercent, type BudgetCategory, type BudgetExpense, type BudgetLine, type CampaignBudgetView } from "@/lib/campaign-budget";
import { centsText, formatCents, parseCents } from "@/lib/fundraising";

const today = () => new Date().toISOString().slice(0, 10);
const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim() || null;
/** Planned amounts may be zero; everything else goes through the fundraising cents parser. */
const plannedCents = (value: string) => /^0+(?:\.0{1,2})?$/.test(value.trim()) ? "0" : parseCents(value);

/** One form in a Dialog on the shared Field primitives. Returns an error message to keep the dialog open. */
function BudgetDialog({ trigger, title, submitLabel, onSubmit, children }: {
  trigger: React.ReactNode; title: string; submitLabel: string; onSubmit: (form: FormData) => Promise<string | null>; children: React.ReactNode;
}) {
  const t = useTranslations("CampaignBudget"), id = useId();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(form: FormData) {
    setBusy(true); setError("");
    const failed = await onSubmit(form);
    setBusy(false);
    if (failed) { setError(failed); return; }
    setOpen(false);
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) { setOpen(value); setError(""); } }}>
    <DialogTrigger asChild>{trigger}</DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-[520px]">
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <form id={id} action={(form) => void submit(form)}>
        <FieldGroup>{error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}{children}</FieldGroup>
      </form>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="ghost" className="min-h-11" disabled={busy}>{t("cancel")}</Button></DialogClose>
        <Button type="submit" form={id} className="min-h-11" disabled={busy}>{busy ? t("saving") : submitLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function InputField({ name, label, type = "text", max, defaultValue, required, money }: { name: string; label: string; type?: string; max?: number; defaultValue?: string | null; required?: boolean; money?: boolean }) {
  const t = useTranslations("CampaignBudget"), id = useId();
  return <Field><FieldLabel htmlFor={id}>{label}{!required && <span className="font-normal text-muted-foreground"> {t("optional")}</span>}</FieldLabel>
    <Input id={id} name={name} type={type} maxLength={max} defaultValue={defaultValue ?? undefined} required={required} autoComplete="off"
      {...(money ? { inputMode: "decimal" as const, placeholder: t("amountPlaceholder") } : {})} className={money ? "min-h-11 tabular-nums" : "min-h-11"} /></Field>;
}
function CategoryField({ options, defaultValue }: { options: readonly BudgetCategory[]; defaultValue?: BudgetCategory }) {
  const t = useTranslations("CampaignBudget"), id = useId();
  return <Field><FieldLabel htmlFor={id}>{t("category")}</FieldLabel>
    <NativeSelect id={id} name="category" defaultValue={defaultValue ?? options[0]} className="min-h-11">
      {options.map((key) => <NativeSelectOption key={key} value={key}>{t(`categories.${key}`)}</NativeSelectOption>)}
    </NativeSelect></Field>;
}

/**
 * The campaign budget screen: planned, spent and remaining overall with a progress bar; planned vs spent per category (DataTable); and, for owners
 * and admins, the expenses list with add, edit and remove. Everyone else sees the totals only. Records only: no money moves through Harvest.
 * Shared components only (Card, DataTable, Dialog, Field, Progress, EmptyState, StatusBadge, ConfirmDialog); theme tokens; 44px targets on phones.
 */
export function CampaignBudget({ tenantId, campaignId, initial }: { tenantId: string; campaignId: string; initial: CampaignBudgetView }) {
  const t = useTranslations("CampaignBudget"), locale = useLocale(), format = useFormatter(), request = useRequest();
  const [view, setView] = useState(initial), [error, setError] = useState("");
  const endpoint = `/api/workspaces/${tenantId}/campaigns/${campaignId}/budget`;
  const currency = view.currency, money = (cents: string) => currency ? formatCents(cents, currency, locale) : centsText(cents);
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });

  async function send(path: string, method: string, body: unknown): Promise<string | null> {
    const result = await request<CampaignBudgetView>(`${endpoint}${path}`, { method, body });
    if (!result.ok) return result.error;
    setView(result.data); setError(""); return null;
  }
  async function remove(path: string, version: number) {
    const failed = await send(path, "DELETE", { version });
    if (failed) setError(failed);
    return failed ?? undefined;
  }

  const { totals } = view, percent = spentPercent(totals.spentCents, totals.plannedCents);
  const lineOf = new Map(view.lines.map((line) => [line.category, line]));
  const unplanned = budgetCategories.filter((key) => !lineOf.has(key));

  const lineDialog = (line?: BudgetLine) => <BudgetDialog title={t(line ? "editLine" : "addLine")} submitLabel={t(line ? "save" : "add")}
    trigger={line ? <Button type="button" variant="outline" size="sm">{t("edit")}<span className="sr-only"> {t(`categories.${line.category}`)}</span></Button>
      : <Button type="button" variant="outline" className="min-h-11 lg:min-h-9" disabled={!unplanned.length}><Plus aria-hidden="true" />{t("addLine")}</Button>}
    onSubmit={async (form) => {
      const cents = plannedCents(String(form.get("planned") ?? ""));
      if (!cents) return t("invalidAmount");
      return line ? send(`/lines/${line.id}`, "PATCH", { version: line.version, plannedCents: cents }) : send("/lines", "POST", { category: form.get("category"), plannedCents: cents });
    }}>
    {!line && <CategoryField options={unplanned} />}
    <InputField name="planned" label={t("plannedAmount")} defaultValue={line ? centsText(line.plannedCents) : undefined} required money />
  </BudgetDialog>;

  const expenseDialog = (expense?: BudgetExpense) => <BudgetDialog title={t(expense ? "editExpense" : "addExpense")} submitLabel={t(expense ? "save" : "add")}
    trigger={expense ? <Button type="button" variant="outline" size="sm">{t("edit")}<span className="sr-only"> {expense.description}</span></Button>
      : <Button type="button" className="min-h-11 lg:min-h-9"><Plus aria-hidden="true" />{t("addExpense")}</Button>}
    onSubmit={async (form) => {
      const amountCents = parseCents(String(form.get("amount") ?? ""));
      if (!amountCents) return t("invalidAmount");
      const body = { spentOn: text(form, "spentOn"), amountCents, category: form.get("category"), description: text(form, "description"), payee: text(form, "payee"), reference: text(form, "reference") };
      return expense ? send(`/expenses/${expense.id}`, "PATCH", { version: expense.version, ...body }) : send("/expenses", "POST", body);
    }}>
    <div className="grid gap-4 sm:grid-cols-2">
      <InputField name="amount" label={t("amount")} defaultValue={expense ? centsText(expense.amountCents) : undefined} required money />
      <InputField name="spentOn" type="date" label={t("date")} defaultValue={expense?.spentOn ?? today()} required />
    </div>
    <CategoryField options={budgetCategories} defaultValue={expense?.category} />
    <InputField name="description" label={t("description")} max={200} defaultValue={expense?.description} required />
    <InputField name="payee" label={t("payee")} max={120} defaultValue={expense?.payee} />
    <InputField name="reference" label={t("reference")} max={120} defaultValue={expense?.reference} />
  </BudgetDialog>;

  const categoryColumns: DataTableColumn[] = [
    { id: "category", header: t("category"), card: "title" },
    { id: "planned", header: t("planned"), align: "end" },
    { id: "spent", header: t("spent"), align: "end" },
    { id: "remaining", header: t("remaining"), align: "end", showFrom: "@md" },
    ...(view.manage ? [{ id: "actions", header: t("actions"), srOnlyHeader: true, align: "end", card: "actions" } satisfies DataTableColumn] : []),
  ];
  const categoryRows: DataTableRow[] = view.categories.map((entry) => {
    const line = lineOf.get(entry.category), name = t(`categories.${entry.category}`), share = spentPercent(entry.spentCents, entry.plannedCents);
    return { id: entry.category, label: name, cells: {
      category: <span className="flex flex-wrap items-center gap-2"><span>{name}</span>{!entry.planned && <StatusBadge tone="warning" label={t("notPlanned")} />}</span>,
      planned: <span className="tabular-nums">{money(entry.plannedCents)}</span>,
      spent: <span className="inline-flex min-w-28 flex-col items-end gap-1"><span className="tabular-nums">{money(entry.spentCents)}</span>
        {share !== null && <Progress value={Math.min(share, 100)} aria-label={t("spentPercent", { percent: share })} className="h-1.5 w-24" />}</span>,
      remaining: <span className={BigInt(entry.remainingCents) < 0n ? "tabular-nums text-destructive" : "tabular-nums"}>{money(entry.remainingCents)}</span>,
      actions: view.manage && line ? <>{lineDialog(line)}
        <ConfirmDialog tone="destructive" title={t("removeLine")} description={t("removeLineConfirm")} confirmLabel={t("remove")} cancelLabel={t("cancel")}
          onConfirm={() => remove(`/lines/${line.id}`, line.version)}
          trigger={<Button type="button" variant="ghost" size="sm">{t("remove")}<span className="sr-only"> {name}</span></Button>} /></> : null,
    } };
  });

  const expenseColumns: DataTableColumn[] = [
    { id: "description", header: t("description"), card: "title" },
    { id: "amount", header: t("amount"), align: "end" },
    { id: "date", header: t("date") },
    { id: "category", header: t("category"), showFrom: "@lg" },
    { id: "reference", header: t("reference"), showFrom: "@3xl" },
    { id: "actions", header: t("actions"), srOnlyHeader: true, align: "end", card: "actions" },
  ];
  const expenseRows: DataTableRow[] = (view.expenses ?? []).map((expense) => ({
    id: expense.id, label: expense.description, cells: {
      description: <span className="min-w-0"><span className="block break-words">{expense.description}</span>
        <span className="block text-xs text-muted-foreground">{[expense.payee, t("recordedBy", { name: expense.recordedByName || "—" })].filter(Boolean).join(" · ")}</span></span>,
      amount: <span className="font-medium tabular-nums">{money(expense.amountCents)}</span>,
      date: date(expense.spentOn),
      category: t(`categories.${expense.category}`),
      reference: expense.reference ?? "",
      actions: view.manage ? <>{expenseDialog(expense)}
        <ConfirmDialog tone="destructive" title={t("removeExpense")} description={t("removeExpenseConfirm")} confirmLabel={t("remove")} cancelLabel={t("cancel")}
          onConfirm={() => remove(`/expenses/${expense.id}`, expense.version)}
          trigger={<Button type="button" variant="ghost" size="sm">{t("remove")}<span className="sr-only"> {expense.description}</span></Button>} /></> : null,
    },
  }));

  return <div className="min-w-0 space-y-4">
    {!currency && <Alert role="status"><AlertDescription>{t("currencyUnsupported")}</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <Card><CardContent className="space-y-3">
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label={t("pageTitle")}>
        {([[t("planned"), totals.plannedCents], [t("spent"), totals.spentCents], [t("remaining"), totals.remainingCents]] as const).map(([label, cents]) => <li key={label} className="min-w-0 rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={BigInt(cents) < 0n ? "truncate text-2xl font-semibold tabular-nums text-destructive" : "truncate text-2xl font-semibold tabular-nums"}>{money(cents)}</p>
        </li>)}
      </ul>
      {percent !== null ? <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">{t("spent")}</span><span className="font-medium tabular-nums">{t("spentPercent", { percent })}</span></div>
        <Progress value={Math.min(percent, 100)} aria-label={t("spentPercent", { percent })} />
      </div> : <p className="text-sm text-muted-foreground">{t("noPlan")}</p>}
      <p className="text-xs text-muted-foreground">{[currency ? t("currencyNote", { currency }) : "", t("recordOnly")].filter(Boolean).join(" ")}</p>
    </CardContent></Card>
    <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3"><CardTitle><h2 className="text-base font-semibold">{t("byCategory")}</h2></CardTitle>
      {view.manage && categoryRows.length > 0 && lineDialog()}</CardHeader>
      <CardContent>{categoryRows.length ? <DataTable label={t("categoriesLabel")} columns={categoryColumns} rows={categoryRows} />
        : <EmptyState icon={PiggyBank} title={t("categoriesEmpty")} size="compact" action={view.manage ? lineDialog() : undefined} />}</CardContent></Card>
    <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3"><div className="space-y-1"><CardTitle><h2 className="text-base font-semibold">{t("expenses")}</h2></CardTitle>
      {!view.expenses && <CardDescription>{t("expensesHidden")}</CardDescription>}</div>
      {view.manage && expenseRows.length > 0 && expenseDialog()}</CardHeader>
      {view.expenses && <CardContent>{expenseRows.length ? <DataTable label={t("expensesLabel")} columns={expenseColumns} rows={expenseRows} />
        : <EmptyState icon={Receipt} title={t("expensesEmpty")} size="compact" action={view.manage ? expenseDialog() : undefined} />}</CardContent>}</Card>
  </div>;
}
