"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, MoreHorizontal, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useDocsCall } from "@/components/docs/docs-api";
import { PanelShell } from "@/components/docs/panels/panel-shell";
import { templateCategories } from "@/lib/docs";
import { cn } from "@/lib/utils";
import type { TemplateRow } from "@/server/docs-templates";

type Scope = "page" | "doc";
/** Save the open page or the whole doc as a ministry template, or update an existing one from it. */
export function SaveTemplateDialog({ open, onOpenChange, tenantId, docId, pageId, mode, templates, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; tenantId: string; docId: string; pageId: string; mode: "save" | "update"; templates: readonly TemplateRow[]; onDone: () => void }) {
  const t = useTranslations("Docs"), call = useDocsCall(tenantId, docId);
  const mine = templates.filter((x) => x.canChange);
  const [name, setName] = useState(""), [category, setCategory] = useState("other"), [description, setDescription] = useState(""), [scope, setScope] = useState<Scope>("page"), [target, setTarget] = useState(mine[0]?.id ?? ""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const from = { docId, scope, ...(scope === "page" ? { pageId } : {}) };
    const r = mode === "save" ? await call("POST", "/../templates", { name, category, description, from }) : await call("PATCH", `/../templates/${target}`, { from });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onOpenChange(false); onDone();
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md" aria-describedby={undefined}>
    <DialogHeader><DialogTitle>{mode === "save" ? t("saveAsTemplate") : t("updateTemplate")}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="space-y-4">
      {mode === "save" ? <>
        <div className="space-y-2"><Label htmlFor="tpl-name">{t("templateName")}</Label><Input id="tpl-name" className="min-h-11" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus /></div>
        <div className="space-y-2"><Label htmlFor="tpl-cat">{t("category")}</Label><NativeSelect id="tpl-cat" className="min-h-11" value={category} onChange={(e) => setCategory(e.target.value)}>{templateCategories.map((c) => <NativeSelectOption key={c} value={c}>{t(`categories.${c}`)}</NativeSelectOption>)}</NativeSelect></div>
        <div className="space-y-2"><Label htmlFor="tpl-desc">{t("description")}</Label><Textarea id="tpl-desc" value={description} maxLength={200} rows={2} onChange={(e) => setDescription(e.target.value)} /></div></>
        : <div className="space-y-2"><Label htmlFor="tpl-target">{t("templateToUpdate")}</Label><NativeSelect id="tpl-target" className="min-h-11" value={target} onChange={(e) => setTarget(e.target.value)}>{mine.map((m) => <NativeSelectOption key={m.id} value={m.id}>{m.name}</NativeSelectOption>)}</NativeSelect></div>}
      <fieldset className="space-y-2"><legend className="text-sm font-medium">{t("templateFrom")}</legend>
        {(["page", "doc"] as const).map((s) => <label key={s} className="flex min-h-11 items-center gap-2"><input type="radio" name="tpl-scope" className="size-4" checked={scope === s} onChange={() => setScope(s)} />{s === "page" ? t("thisPage") : t("entireDoc")}</label>)}</fieldset>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter className="gap-2"><Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>{t("cancel")}</Button><Button type="submit" className="min-h-11" disabled={busy || (mode === "save" ? !name.trim() : !target)}>{t("save")}</Button></DialogFooter>
    </form></DialogContent></Dialog>;
}

/** Templates: ministry templates and the starter templates, searchable and filtered by category; apply to this page (replacing its text) or add as new pages. */
export function TemplatesPanel({ tenantId, docId, pageId, canEdit, pageVersion, onApplied, onSave, onClose, openSave }: {
  tenantId: string; docId: string; pageId: string; canEdit: boolean; pageVersion: () => number; onApplied: (pageId: string) => void; onSave: () => void; onClose: () => void; openSave: (mode: "save" | "update", templates: readonly TemplateRow[]) => void;
}) {
  const t = useTranslations("Docs"), call = useDocsCall(tenantId, docId);
  const [q, setQ] = useState(""), [category, setCategory] = useState<"all" | "mine" | (typeof templateCategories)[number]>("all"), [rows, setRows] = useState<TemplateRow[]>([]), [error, setError] = useState(""), [confirm, setConfirm] = useState<TemplateRow | null>(null);
  const load = useCallback(async () => {
    const r = await call<TemplateRow[]>("GET", `/../templates?q=${encodeURIComponent(q.trim())}${category !== "all" && category !== "mine" ? `&category=${category}` : ""}`);
    if (r.ok) setRows(r.data); else setError(r.error);
  }, [call, q, category]);
  useEffect(() => { const timer = setTimeout(() => void load(), 200); return () => clearTimeout(timer); }, [load]);
  async function apply(row: TemplateRow, mode: "replace_page" | "new_pages") {
    const r = await call<{ pageId: string }>("POST", "/apply-template", { template: row.id, mode, pageId, version: mode === "replace_page" ? pageVersion() : undefined });
    if (!r.ok) { setError(r.error); return; }
    onApplied(r.data.pageId);
  }
  async function remove(row: TemplateRow) { const r = await call("DELETE", `/../templates/${row.id}`); if (!r.ok) setError(r.error); void load(); }
  const mine = rows.filter((r) => !r.builtin), starters = rows.filter((r) => r.builtin);
  const section = (title: string, list: TemplateRow[], emptyText?: string) => <section className="px-4 py-3" aria-label={title}><h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
    {list.length === 0 ? (emptyText && <p className="py-2 text-center text-sm text-muted-foreground">{emptyText}</p>) : <ul className="space-y-2">{list.map((r) => <li key={r.id} className="flex items-center gap-3 rounded-lg border p-2" data-template={r.id}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><FileText className="size-4" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{r.name}</span><span className="block truncate text-xs text-muted-foreground">{r.pages > 1 ? t("templateMeta", { by: r.builtin ? t("byHarvest") : t("byPerson", { name: r.authorName ?? "" }), pages: t("pageCount", { count: r.pages }) }) : r.builtin ? t("byHarvest") : t("byPerson", { name: r.authorName ?? "" })}</span></span>
      {canEdit ? <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm" className="min-h-11 lg:min-h-8" aria-label={t("useTemplate", { name: r.name })}>{t("apply")}<MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuItem className="min-h-11" onSelect={() => setConfirm(r)}>{t("replaceThisPage")}</DropdownMenuItem><DropdownMenuItem className="min-h-11" onSelect={() => void apply(r, "new_pages")}>{t("addAsNewPages")}</DropdownMenuItem>
          {r.canChange && <><DropdownMenuSeparator /><DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => void remove(r)}>{t("deleteTemplate")}</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu> : null}</li>)}</ul>}</section>;
  return <PanelShell name="templates" title={t("templates")} onClose={onClose}
    footer={canEdit ? <><Button type="button" variant="ghost" className="min-h-11 w-full" disabled={!rows.some((r) => r.canChange)} onClick={() => openSave("update", rows)}>{t("updateTemplate")}</Button><Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => { onSave(); openSave("save", rows); }}>{t("saveAsTemplate")}</Button></> : undefined}>
    <div className="space-y-3 px-4 pt-3">
      <div className="relative"><Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input className="min-h-11 ps-9" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchTemplates")} aria-label={t("searchTemplates")} /></div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("category")}>{(["all", "mine", ...templateCategories] as const).map((c) => <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}
        className={cn("min-h-11 rounded-full border px-3 text-xs lg:min-h-7", category === c ? "border-foreground bg-accent font-medium" : "hover:bg-accent/60")}>{c === "all" ? t("all") : c === "mine" ? t("myMinistry") : t(`categories.${c}`)}</button>)}</div>
    </div>
    {error && <div className="px-4 pt-3"><Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert></div>}
    {category !== "mine" && section(t("starterTemplates"), starters)}
    {(category === "all" || category === "mine" || mine.length > 0) && section(t("myMinistry"), mine, t("noMinistryTemplates"))}
    <ConfirmDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)} tone="neutral" title={t("replaceTitle")} description={t("replaceBody")} confirmLabel={t("replaceThisPage")} cancelLabel={t("cancel")}
      onConfirm={async () => { if (confirm) await apply(confirm, "replace_page"); }} />
  </PanelShell>;
}
