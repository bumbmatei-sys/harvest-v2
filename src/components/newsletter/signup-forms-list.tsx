"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Archive, ClipboardPen, Copy, Eye, Link2, MoreHorizontal, Pencil, Plus, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { useRequest } from "@/hooks/use-request";
import { copyText } from "@/lib/copy-text";
import { signupPath } from "@/lib/newsletter-signup";
import type { StatusTone } from "@/lib/status-tone";
import { notify } from "@/lib/toast";
import type { SignupFormSummary } from "@/server/newsletter-forms";

export type ListChoice = { id: string; name: string; audience: string };
const tones: Record<SignupFormSummary["status"], StatusTone> = { draft: "neutral", published: "success", unpublished: "warning" };

/** The Sign-up forms list. A new form starts from the newsletter preset of the shared forms builder; everything else about editing happens there. */
export function SignupFormsList({ tenantId, forms, lists, hostedAvailable }: { tenantId: string; forms: SignupFormSummary[]; lists: ListChoice[]; hostedAvailable: boolean }) {
  const t = useTranslations("NewsletterForms"), format = useFormatter(), router = useRouter(), request = useRequest();
  const [query, setQuery] = useState(""), [error, setError] = useState(""), [creating, setCreating] = useState(false), [picked, setPicked] = useState<string[]>([]), [busy, setBusy] = useState(false);
  const [archiving, setArchiving] = useState<SignupFormSummary | null>(null);
  const base = `/workspaces/${tenantId}/newsletter/forms`;
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return forms.filter((form) => !needle || form.title.toLowerCase().includes(needle) || form.lists.some((list) => list.name.toLowerCase().includes(needle)));
  }, [forms, query]);

  async function create() {
    setBusy(true); setError("");
    const result = await request<{ id: string }>(`/api/workspaces/${tenantId}/newsletter/forms`, { method: "POST", body: { listIds: picked } });
    setBusy(false);
    if (!result.ok) { setError(t("list.createFailed")); return; }
    router.push(`${base}/${result.data.id}`);
  }
  async function duplicate(form: SignupFormSummary) {
    setError("");
    const result = await request<{ id: string }>(`/api/workspaces/${tenantId}/crm/forms/${form.id}/duplicate`, { method: "POST" });
    if (!result.ok) { setError(result.error); return; }
    router.push(`${base}/${result.data.id}`);
  }
  async function archive() {
    if (!archiving) return;
    setBusy(true); setError("");
    const result = await request(`/api/workspaces/${tenantId}/newsletter/forms/${archiving.id}/archive`, { method: "POST" });
    setBusy(false); setArchiving(null);
    if (!result.ok) { setError(t("list.archiveFailed")); return; }
    router.refresh();
  }
  async function copyLink(form: SignupFormSummary) {
    if (!form.slug) return;
    const result = await copyText(`${location.origin}${signupPath(form.slug)}`);
    if (result === "copied") notify.success(t("list.linkCopied")); else notify.error(t("list.copyFailed"));
  }

  const columns: DataTableColumn[] = [
    { id: "name", header: t("columns.name"), card: "title" }, { id: "lists", header: t("columns.lists"), showFrom: "@md" }, { id: "status", header: t("columns.status") },
    { id: "signups", header: t("columns.signups"), showFrom: "@md", align: "end" }, { id: "last", header: t("columns.last"), showFrom: "@lg" },
    { id: "actions", header: t("columns.actions"), srOnlyHeader: true, align: "end", card: "actions", className: "w-16" },
  ];
  const tableRows: DataTableRow[] = rows.map((form) => ({ id: form.id, label: form.title, cells: {
    name: <Link href={`${base}/${form.id}`} className="flex min-h-11 min-w-0 items-center truncate font-medium hover:underline">{form.title}</Link>,
    lists: form.lists.length ? form.lists.map((list) => list.name).join(", ") : t("list.noLists"),
    status: <StatusBadge tone={tones[form.status]} label={t(`status.${form.status}`)} />,
    signups: <span className="tabular-nums">{form.signups}</span>,
    last: form.lastSignupAt ? format.dateTime(new Date(form.lastSignupAt), { dateStyle: "medium", timeStyle: "short" }) : t("list.never"),
    actions: <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("list.menu", { name: form.title })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="min-h-11" onSelect={() => router.push(`${base}/${form.id}`)}><Pencil aria-hidden="true" />{t("list.edit")}</DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" onSelect={() => router.push(`${base}/${form.id}?tab=preview`)}><Eye aria-hidden="true" />{t("list.preview")}</DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" disabled={form.status !== "published" || !hostedAvailable} onSelect={() => void copyLink(form)}><Link2 aria-hidden="true" />{t("list.copyLink")}</DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" onSelect={() => void duplicate(form)}><Copy aria-hidden="true" />{t("list.duplicate")}</DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" onSelect={() => setArchiving(form)}><Archive aria-hidden="true" />{t("list.archive")}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>,
  } }));
  const toggle = (id: string, on: boolean) => setPicked((current) => on ? [...current, id] : current.filter((x) => x !== id));
  const open = () => { setError(""); setPicked(lists.length === 1 ? [lists[0].id] : []); setCreating(true); };

  return <div className="min-w-0 space-y-6" data-signup-forms-list>
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("heading")}</h1>
      <Button type="button" className="min-h-11" onClick={open}><Plus aria-hidden="true" />{t("list.new")}</Button>
    </header>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {!hostedAvailable && <Alert data-hosted-unavailable><AlertDescription>{t("list.unavailable")}</AlertDescription></Alert>}
    {forms.length === 0
      ? <EmptyState icon={ClipboardPen} title={t("list.emptyTitle")} description={t("list.emptyBody")} action={<Button type="button" className="min-h-11" onClick={open}><Plus aria-hidden="true" />{t("list.new")}</Button>} />
      : <section className="space-y-3">
        <div className="relative min-w-52 max-w-sm"><Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="min-h-11 ps-9" type="search" aria-label={t("list.search")} placeholder={t("list.search")} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        {rows.length === 0 ? <EmptyState icon={Search} size="compact" title={t("list.noMatch")} /> : <DataTable label={t("heading")} columns={columns} rows={tableRows} />}
      </section>}

    <Dialog open={creating} onOpenChange={(value) => { if (!busy) setCreating(value); }}>
      <DialogContent><DialogHeader><DialogTitle>{t("new.title")}</DialogTitle></DialogHeader>
        {lists.length === 0
          ? <p className="text-sm text-muted-foreground" data-no-lists>{t("new.noLists")}</p>
          : <fieldset className="space-y-1"><legend className="mb-2 text-sm font-medium">{t("new.lists")}</legend>
            {lists.map((list) => <Label key={list.id} htmlFor={`new-list-${list.id}`} className="flex min-h-11 items-center gap-3 font-normal">
              <Checkbox id={`new-list-${list.id}`} checked={picked.includes(list.id)} onCheckedChange={(value) => toggle(list.id, value === true)} />
              <span className="min-w-0 truncate">{list.name}</span><span className="ms-auto truncate text-xs text-muted-foreground">{list.audience}</span></Label>)}</fieldset>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setCreating(false)}>{t("new.cancel")}</Button>
          {lists.length === 0
            ? <Button asChild className="min-h-11"><Link href={`/workspaces/${tenantId}/newsletter/audience`}>{t("new.goToAudience")}</Link></Button>
            : <Button type="button" className="min-h-11" disabled={busy || picked.length === 0} onClick={() => void create()} data-create-signup-form>{t("new.create")}</Button>}
        </DialogFooter></DialogContent></Dialog>

    <AlertDialog open={archiving !== null} onOpenChange={(value) => { if (!value && !busy) setArchiving(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("archive.title", { name: archiving?.title ?? "" })}</AlertDialogTitle><AlertDialogDescription>{t("archive.body")}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel className="min-h-11" disabled={busy}>{t("archive.cancel")}</AlertDialogCancel>
          <AlertDialogAction className="min-h-11" disabled={busy} onClick={(event) => { event.preventDefault(); void archive(); }} data-confirm-archive>{t("archive.confirm")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
