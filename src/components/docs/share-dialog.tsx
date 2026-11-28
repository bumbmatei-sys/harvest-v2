"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Globe, Link2, Lock, Upload, Users, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { useDocsCall } from "@/components/docs/docs-api";
import { copyText } from "@/lib/copy-text";
import { docHref, publicDocHref } from "@/lib/docs-list";
import { shareRoles, type ShareRole } from "@/lib/docs";
import { notify } from "@/lib/toast";
import { exportHref, printHref } from "@/components/docs/panels/export-panel";
import type { Sharing } from "@/server/docs-sharing";

/** Sharing and permissions: invite members by name at view, comment or edit, share with every member of the ministry, the private link, export, protect, and (only where the deployment allows it, behind an explicit approval) the public link. */
export function ShareDialog({ origin, open, onOpenChange, tenantId, docId, pageId, docTitle, protectedDoc, onProtect, onChanged }: { origin: string; open: boolean; onOpenChange: (o: boolean) => void; tenantId: string; docId: string; pageId: string; docTitle: string; protectedDoc: boolean; onProtect: (on: boolean) => void; onChanged: () => void }) {
  const t = useTranslations("Docs"), call = useDocsCall(tenantId, docId);
  const [data, setData] = useState<Sharing | null>(null), [error, setError] = useState(""), [query, setQuery] = useState(""), [role, setRole] = useState<ShareRole>("view"), [approved, setApproved] = useState(false), [token, setToken] = useState("");
  const load = useCallback(async () => { const r = await call<Sharing>("GET", "/sharing"); if (r.ok) setData(r.data); else setError(r.error); }, [call]);
  useEffect(() => { if (!open) return; let live = true; call<Sharing>("GET", "/sharing").then((r) => { if (!live) return; if (r.ok) setData(r.data); else setError(r.error); }); return () => { live = false; }; }, [open, call]);
  async function act(method: string, path: string, body?: unknown) { setError(""); const r = await call<{ token?: string | null }>(method, path, body); if (!r.ok) { setError(r.error); return null; } await load(); onChanged(); return r.data; }
  const manage = data?.canManage ?? false;
  const matches = data && query.trim() ? data.people.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6) : [];
  const row = (Icon: typeof Globe, label: string, control: React.ReactNode, hint?: string) => <div className="flex min-h-11 items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><div className="min-w-0"><p className="text-sm">{label}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div></div>{control}</div>;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined} data-share-dialog>
    <DialogHeader><DialogTitle>{t("shareThisDoc")}</DialogTitle><p className="text-sm text-muted-foreground">{t("sharingAsSingleView", { name: docTitle || t("untitled") })}</p></DialogHeader>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {manage && <div className="space-y-2">
      <div className="flex gap-2"><Input className="min-h-11" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("inviteByName")} aria-label={t("inviteByName")} />
        <NativeSelect aria-label={t("inviteRole")} className="min-h-11 w-32" value={role} onChange={(e) => setRole(e.target.value as ShareRole)}>{shareRoles.map((r) => <NativeSelectOption key={r} value={r}>{t(`role.${r}`)}</NativeSelectOption>)}</NativeSelect></div>
      {matches.length > 0 && <ul className="rounded-md border" aria-label={t("people")}>{matches.map((p) => <li key={p.userId}><button type="button" className="flex min-h-11 w-full items-center px-3 text-start text-sm hover:bg-accent" onClick={async () => { if (await act("POST", "/shares", { userId: p.userId, role })) setQuery(""); }}>{p.name}</button></li>)}</ul>}
      {query.trim() && matches.length === 0 && <p className="text-xs text-muted-foreground">{t("noPeopleMatch")}</p>}
    </div>}
    <div className="space-y-1">
      {data && row(Globe, t("shareLinkWithAnyone"), <Switch aria-label={t("shareLinkWithAnyone")} checked={data.publicLink.enabled} disabled={!manage || !data.publicLink.available || (!data.publicLink.enabled && !approved)}
        onCheckedChange={async (on) => { const r = await act("POST", "/public-link", { enabled: on, approved: on }); if (r?.token) setToken(r.token); if (!on) setToken(""); }} />, data.publicLink.available ? t("publicLinkHint") : t("publicLinkOff"))}
      {data?.publicLink.available && manage && !data.publicLink.enabled && <label className="ms-7 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={approved} onChange={(e) => setApproved(e.target.checked)} />{t("publicLinkApprove")}</label>}
      {token && <p className="ms-7 break-all rounded-md bg-muted p-2 text-xs" data-public-url>{`${origin}${publicDocHref(token)}`}</p>}
      {row(Link2, t("privateLink"), <Button type="button" variant="outline" size="sm" className="min-h-11 lg:min-h-8" onClick={async () => { if (await copyText(`${origin}${docHref(tenantId, docId)}`)) notify.success(t("linkCopied")); }}>{t("copyLink")}</Button>, t("privateLinkHint"))}
      {row(Upload, t("exportDoc"), <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm" className="min-h-11 lg:min-h-8">{t("export")}</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuItem asChild className="min-h-11"><a href={printHref(tenantId, docId, "doc", pageId, true)} target="_blank" rel="noopener">{t("exportPdf")}</a></DropdownMenuItem><DropdownMenuItem asChild className="min-h-11"><a href={exportHref(tenantId, docId, "doc", pageId, "html")} download>{t("exportHtml")}</a></DropdownMenuItem>
          <DropdownMenuItem asChild className="min-h-11"><a href={exportHref(tenantId, docId, "doc", pageId, "markdown")} download>{t("exportMarkdown")}</a></DropdownMenuItem><DropdownMenuItem asChild className="min-h-11"><a href={printHref(tenantId, docId, "doc", pageId)} target="_blank" rel="noopener">{t("print")}</a></DropdownMenuItem></DropdownMenuContent></DropdownMenu>)}
      {row(Lock, t("protectDoc"), <Switch aria-label={t("protectDoc")} checked={protectedDoc} disabled={!manage} onCheckedChange={onProtect} />, t("protectDocHint"))}
    </div>
    {data && <section className="space-y-2" aria-label={t("shareWith")}><h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("shareWith")}</h3>
      {row(Users, t("ministryMembers"), <Switch aria-label={t("ministryMembers")} checked={data.visibility === "ministry"} disabled={!manage} onCheckedChange={(on) => void act("PUT", "/sharing", { visibility: on ? "ministry" : "private" })} />)}
      {data.visibility === "ministry" && <div className="ms-7"><NativeSelect aria-label={t("ministryAccess")} className="min-h-11 w-48" value={data.ministryAccess} disabled={!manage} onChange={(e) => void act("PUT", "/sharing", { visibility: "ministry", ministryAccess: e.target.value })}>{shareRoles.map((r) => <NativeSelectOption key={r} value={r}>{t(`role.${r}`)}</NativeSelectOption>)}</NativeSelect></div>}
      {data.shares.length > 0 && <ul className="space-y-1" aria-label={t("peopleWithAccess")}>{data.shares.map((s) => <li key={s.userId} className="flex min-h-11 items-center justify-between gap-2 rounded-md border px-3"><span className="min-w-0 truncate text-sm">{s.name}</span>
        <span className="flex items-center gap-1">{manage ? <NativeSelect aria-label={t("roleOf", { name: s.name })} className="h-9 w-28 text-xs" value={s.role} onChange={(e) => void act("POST", "/shares", { userId: s.userId, role: e.target.value })}>{shareRoles.map((r) => <NativeSelectOption key={r} value={r}>{t(`role.${r}`)}</NativeSelectOption>)}</NativeSelect> : <span className="text-xs text-muted-foreground">{t(`role.${s.role}`)}</span>}
          {manage && <Button type="button" variant="ghost" size="icon" className="size-9" aria-label={t("removeAccess", { name: s.name })} onClick={() => void act("DELETE", `/shares/${s.userId}`)}><X aria-hidden="true" /></Button>}</span></li>)}</ul>}
      <p className="text-xs text-muted-foreground">{t("leadershipCanSee")}</p></section>}
  </DialogContent></Dialog>;
}
