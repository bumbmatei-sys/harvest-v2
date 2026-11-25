"use client";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { History } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useDocsCall } from "@/components/docs/docs-api";
import { PanelShell } from "@/components/docs/panels/panel-shell";
import type { VersionRow } from "@/server/docs-history";

/** Earlier versions of the open page: list, view and restore. A restore keeps the text it replaces as a version. */
export function HistoryPanel({ tenantId, docId, pageId, canEdit, pageVersion, onRestored, onClose }: { tenantId: string; docId: string; pageId: string; canEdit: boolean; pageVersion: () => number; onRestored: () => void; onClose: () => void }) {
  const t = useTranslations("Docs"), format = useFormatter(), call = useDocsCall(tenantId, docId);
  const [rows, setRows] = useState<VersionRow[] | null>(null), [error, setError] = useState(""), [view, setView] = useState<{ row: VersionRow; html: string } | null>(null), [restore, setRestore] = useState<VersionRow | null>(null);
  useEffect(() => { let live = true; call<VersionRow[]>("GET", `/pages/${pageId}/versions`).then((r) => { if (!live) return; if (r.ok) setRows(r.data); else { setError(r.error); setRows([]); } }); return () => { live = false; }; }, [call, pageId]);
  async function open(row: VersionRow) { const r = await call<{ html: string }>("GET", `/pages/${pageId}/versions/${row.id}`); if (r.ok) setView({ row, html: r.data.html }); else setError(r.error); }
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  return <PanelShell name="history" title={t("pageHistory")} onClose={onClose}>
    {error && <div className="p-4"><Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert></div>}
    {rows !== null && rows.length === 0 && !error ? <div className="flex flex-col items-center gap-2 px-6 py-16 text-center"><History className="size-10 text-muted-foreground" aria-hidden="true" /><p className="font-medium">{t("historyEmpty")}</p><p className="text-sm text-muted-foreground">{t("historyHint")}</p></div>
      : <ul className="space-y-2 p-4" data-history>{rows?.map((v) => <li key={v.id} className="rounded-lg border p-3"><p className="text-sm font-medium">{when(v.createdAt)}</p>
        <p className="text-xs text-muted-foreground">{t("versionMeta", { reason: t(`versionReason.${v.reason}`), author: v.authorName, words: t("wordCount", { count: v.words }) })}</p>
        <div className="mt-2 flex gap-1"><Button type="button" variant="outline" size="sm" className="min-h-11 lg:min-h-8" onClick={() => void open(v)}>{t("viewVersion")}</Button>{canEdit && <Button type="button" variant="ghost" size="sm" className="min-h-11 lg:min-h-8" onClick={() => setRestore(v)}>{t("restoreVersion")}</Button>}</div></li>)}</ul>}
    <Dialog open={view !== null} onOpenChange={(o) => !o && setView(null)}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{view ? t("versionFrom", { when: when(view.row.createdAt) }) : ""}</DialogTitle></DialogHeader>
      {view && <div className="docs-prose rounded-md border p-4" data-version-view dangerouslySetInnerHTML={{ __html: view.html }} />}
      <DialogFooter><Button type="button" variant="outline" className="min-h-11" onClick={() => setView(null)}>{t("close")}</Button>{canEdit && view && <Button type="button" className="min-h-11" onClick={() => { setRestore(view.row); setView(null); }}>{t("restoreVersion")}</Button>}</DialogFooter></DialogContent></Dialog>
    <ConfirmDialog open={restore !== null} onOpenChange={(o) => !o && setRestore(null)} tone="neutral" title={t("restoreTitle")} description={t("restoreBody")} confirmLabel={t("restoreVersion")} cancelLabel={t("cancel")}
      onConfirm={async () => { if (!restore) return; const r = await call("POST", `/pages/${pageId}/versions/${restore.id}/restore`, { version: pageVersion() }); if (!r.ok) return r.error; onRestored(); }} />
  </PanelShell>;
}
