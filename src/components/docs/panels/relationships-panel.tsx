"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckSquare, FileText, Link2, Plus, Search, SearchX, UserRound, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocsCall } from "@/components/docs/docs-api";
import { PanelShell } from "@/components/docs/panels/panel-shell";
import { docHref } from "@/lib/docs-list";
import type { Backlink, LinkKind, LinkRow, Target } from "@/server/docs-links";

const kindIcon = { contact: UserRound, task: CheckSquare, doc: FileText } as const;
export const linkHref = (tenantId: string, l: { kind: LinkKind; targetId: string }) => l.kind === "doc" ? docHref(tenantId, l.targetId) : l.kind === "contact" ? `/workspaces/${tenantId}/contacts/${l.targetId}` : `/workspaces/${tenantId}/crm/tasks`;

/** Links from the page (or the whole doc) to people, tasks and other docs, with the docs that link here. Reads follow the viewer's own rights; nothing here changes a CRM record. */
export function RelationshipsPanel({ tenantId, docId, pageId, canEdit, onChanged, onClose }: { tenantId: string; docId: string; pageId: string; canEdit: boolean; onChanged: () => void; onClose: () => void }) {
  const t = useTranslations("Docs"), call = useDocsCall(tenantId, docId);
  const [scope, setScope] = useState<"page" | "doc">("page"), [links, setLinks] = useState<LinkRow[]>([]), [backlinks, setBacklinks] = useState<Backlink[]>([]), [error, setError] = useState("");
  const [open, setOpen] = useState(false), [kind, setKind] = useState<LinkKind>("task"), [q, setQ] = useState(""), [results, setResults] = useState<Target[] | null>(null);
  const load = useCallback(async () => { const r = await call<{ links: LinkRow[]; backlinks: Backlink[] }>("GET", `/links?scope=${scope}&pageId=${pageId}`); if (r.ok) { setLinks(r.data.links); setBacklinks(r.data.backlinks); } else setError(r.error); }, [call, scope, pageId]);
  useEffect(() => { let live = true; call<{ links: LinkRow[]; backlinks: Backlink[] }>("GET", `/links?scope=${scope}&pageId=${pageId}`).then((r) => { if (live) { if (r.ok) { setLinks(r.data.links); setBacklinks(r.data.backlinks); } else setError(r.error); } }); return () => { live = false; }; }, [call, scope, pageId]);
  useEffect(() => {
    if (!open) return;
    let live = true; const timer = setTimeout(() => { call<Target[]>("GET", `/links/search?kind=${kind}&q=${encodeURIComponent(q.trim())}`).then((r) => { if (live) setResults(r.ok ? r.data : []); }); }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [call, open, kind, q]);
  async function add(target: Target) {
    const r = await call("POST", "/links", { kind: target.kind, targetId: target.id, pageId });
    if (!r.ok) { setError(r.error); return; }
    setOpen(false); setQ(""); void load(); onChanged();
  }
  async function remove(id: string) { const r = await call("DELETE", `/links/${id}`); if (!r.ok) setError(r.error); void load(); onChanged(); }
  const list = (kinds: LinkKind[]) => results?.filter((r) => kinds.includes(r.kind)) ?? [];
  return <PanelShell name="relationships" title={t("relationships")} onClose={onClose}>
    <Tabs value={scope} onValueChange={(v) => setScope(v as "page" | "doc")} className="px-4 pt-3"><TabsList className="grid w-full grid-cols-2"><TabsTrigger value="page" aria-controls={undefined}>{t("thisPage")}</TabsTrigger><TabsTrigger value="doc" aria-controls={undefined}>{t("entireDoc")}</TabsTrigger></TabsList></Tabs>
    {error && <div className="px-4 pt-3"><Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert></div>}
    <section className="p-4" aria-label={scope === "page" ? t("pageLinks") : t("docLinks")}>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{scope === "page" ? t("pageLinks") : t("docLinks")}</h3>
      {canEdit && <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setResults(null); }}>
        <PopoverTrigger asChild><Button type="button" variant="ghost" className="min-h-11 w-full justify-start gap-2 text-muted-foreground"><Plus aria-hidden="true" />{t("linkSomething")}</Button></PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-2 p-2">
          <div className="relative"><Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input className="min-h-11 ps-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchLinkTargets")} autoFocus /></div>
          <Tabs value={kind} onValueChange={(v) => { setKind(v as LinkKind); setResults(null); }}><TabsList variant="line" className="w-full justify-start"><TabsTrigger value="task" aria-controls={undefined}>{t("tabTasks")}</TabsTrigger><TabsTrigger value="contact" aria-controls={undefined}>{t("tabPeople")}</TabsTrigger><TabsTrigger value="doc" aria-controls={undefined}>{t("tabDocs")}</TabsTrigger></TabsList></Tabs>
          {results === null ? <p className="p-3 text-sm text-muted-foreground">{t("loading")}</p> : list([kind]).length === 0
            ? <div className="flex flex-col items-center gap-2 p-4 text-center text-sm text-muted-foreground"><SearchX className="size-8" aria-hidden="true" />{t("noResults")}</div>
            : <ul className="max-h-60 overflow-y-auto" aria-label={q ? t("searchResults") : kind === "doc" ? t("recentDocs") : t("recentItems")}>{list([kind]).map((r) => { const Icon = kindIcon[r.kind]; return <li key={r.id}><button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-start text-sm hover:bg-accent" onClick={() => void add(r)}><Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 truncate">{r.label}</span></button></li>; })}</ul>}
        </PopoverContent></Popover>}
      {links.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">{t("noLinks")}</p>
        : <ul className="space-y-1" data-doc-links>{links.map((l) => { const Icon = kindIcon[l.kind]; return <li key={l.id} className="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-accent/60">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {l.label === null ? <span className="min-w-0 flex-1 truncate text-sm italic text-muted-foreground">{t("unavailable")}</span> : <Link href={linkHref(tenantId, l)} className="min-w-0 flex-1 truncate text-sm underline-offset-2 hover:underline">{l.label}</Link>}
          {scope === "doc" && l.pageTitle !== null && <span className="max-w-24 shrink-0 truncate text-xs text-muted-foreground">{l.pageTitle || t("untitled")}</span>}
          {canEdit && <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" aria-label={t("removeLink", { name: l.label ?? t("unavailable") })} onClick={() => void remove(l.id)}><X aria-hidden="true" /></Button>}</li>; })}</ul>}
    </section>
    {backlinks.length > 0 && <section className="border-t p-4" aria-label={t("linkedFrom")}><h3 className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Link2 className="size-3" aria-hidden="true" />{t("linkedFrom")}</h3>
      <ul>{backlinks.map((b, i) => <li key={`${b.docId}-${b.pageId}-${i}`}><Link href={docHref(tenantId, b.docId, b.pageId ?? undefined)} className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent"><FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 truncate">{b.pageTitle ? t("pageOf", { doc: b.docTitle || t("untitled"), page: b.pageTitle }) : b.docTitle || t("untitled")}</span></Link></li>)}</ul></section>}
  </PanelShell>;
}
