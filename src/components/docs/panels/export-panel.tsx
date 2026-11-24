"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileCode2, FileDown, FileText, Printer, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useDocsCall } from "@/components/docs/docs-api";
import { PanelShell } from "@/components/docs/panels/panel-shell";

export type ExportScope = "page" | "doc";
export const exportHref = (tenantId: string, docId: string, scope: ExportScope, pageId: string, format: "markdown" | "html") => `/api/workspaces/${tenantId}/docs/${docId}/export?scope=${scope}&format=${format}${scope === "page" ? `&pageId=${pageId}` : ""}`;
export const printHref = (tenantId: string, docId: string, scope: ExportScope, pageId: string, pdf = false) => `/docs-print/${tenantId}/${docId}?scope=${scope}${scope === "page" ? `&page=${pageId}` : ""}${pdf ? "&pdf=1" : ""}`;
const MAX_IMPORT = 1_000_000;

/** Reads a text file chosen by the person and imports it (HTML, HTML split at top-level headings, or Markdown) as new pages or into the open page. */
export function useImport(tenantId: string, docId: string, pageId: string, pageVersion: () => number, onDone: (pageId: string) => void) {
  const t = useTranslations("Docs"), call = useDocsCall(tenantId, docId);
  const [error, setError] = useState("");
  async function run(file: File, format: "html" | "markdown", split: boolean, mode: "new_pages" | "replace_page") {
    setError("");
    if (file.size > MAX_IMPORT) { setError(t("importTooLarge")); return; }
    const text = await file.text();
    const r = await call<{ pageId: string }>("POST", "/import", { format, split, text, title: file.name.replace(/\.[^.]+$/, "").slice(0, 200), mode, ...(mode === "replace_page" ? { pageId, version: pageVersion() } : {}) });
    if (!r.ok) { setError(r.error); return; }
    onDone(r.data.pageId);
  }
  return { run, error, setError };
}

export function ExportPanel({ tenantId, docId, pageId, canEdit, pageVersion, onImported, onClose }: { tenantId: string; docId: string; pageId: string; canEdit: boolean; pageVersion: () => number; onImported: (pageId: string) => void; onClose: () => void }) {
  const t = useTranslations("Docs");
  const [scope, setScope] = useState<ExportScope>("page"), [mode, setMode] = useState<"new_pages" | "replace_page">("new_pages");
  const imp = useImport(tenantId, docId, pageId, pageVersion, onImported);
  const picker = useRef<HTMLInputElement>(null), [pending, setPending] = useState<{ format: "html" | "markdown"; split: boolean } | null>(null);
  const link = "flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-sm hover:bg-accent";
  return <PanelShell name="export" title={t("exportTitle")} onClose={onClose}>
    <section className="space-y-2 p-4" aria-label={t("export")}>
      <fieldset className="space-y-1"><legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("export")}</legend>
        {(["page", "doc"] as const).map((s) => <label key={s} className="flex min-h-11 items-center gap-2"><input type="radio" name="export-scope" className="size-4" checked={scope === s} onChange={() => setScope(s)} />{s === "page" ? t("thisPage") : t("entireDoc")}</label>)}</fieldset>
      <a className={link} href={printHref(tenantId, docId, scope, pageId, true)} target="_blank" rel="noopener"><FileDown className="size-4 text-muted-foreground" aria-hidden="true" />{t("exportPdf")}</a>
      <a className={link} href={exportHref(tenantId, docId, scope, pageId, "html")} download><FileCode2 className="size-4 text-muted-foreground" aria-hidden="true" />{t("exportHtml")}</a>
      <a className={link} href={exportHref(tenantId, docId, scope, pageId, "markdown")} download><FileText className="size-4 text-muted-foreground" aria-hidden="true" />{t("exportMarkdown")}</a>
      <a className={link} href={printHref(tenantId, docId, scope, pageId)} target="_blank" rel="noopener"><Printer className="size-4 text-muted-foreground" aria-hidden="true" />{t("print")}</a>
    </section>
    {canEdit && <section className="space-y-2 border-t p-4" aria-label={t("import")}>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("import")}</h3>
      <fieldset className="space-y-1"><legend className="sr-only">{t("importInto")}</legend>
        {(["new_pages", "replace_page"] as const).map((m) => <label key={m} className="flex min-h-11 items-center gap-2"><input type="radio" name="import-mode" className="size-4" checked={mode === m} onChange={() => setMode(m)} />{m === "new_pages" ? t("addAsNewPages") : t("replaceThisPage")}</label>)}</fieldset>
      {([["html", false, "importHtml"], ["html", true, "importHtmlSplit"], ["markdown", false, "importMarkdown"]] as const).map(([format, split, key]) => <Button key={key} type="button" variant="ghost" className="min-h-11 w-full justify-start gap-3 px-2 font-normal" onClick={() => { setPending({ format, split }); picker.current?.click(); }}><Upload className="size-4 text-muted-foreground" aria-hidden="true" />{t(key)}</Button>)}
      <input ref={picker} type="file" className="sr-only" tabIndex={-1} aria-label={t("chooseFile")} accept=".html,.htm,.md,.markdown,.txt,text/html,text/markdown,text/plain"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f && pending) void imp.run(f, pending.format, pending.split, mode); }} />
      {imp.error && <Alert variant="destructive" role="alert"><AlertDescription>{imp.error}</AlertDescription></Alert>}
    </section>}
  </PanelShell>;
}
