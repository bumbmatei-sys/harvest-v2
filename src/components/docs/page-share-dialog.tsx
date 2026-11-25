"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useDocsCall } from "@/components/docs/docs-api";
import { shareRoles, type ShareRole } from "@/lib/docs";
import type { PageShareView } from "@/server/docs-page-shares";

/** "Share this page": invite a member to this one page at view, comment or edit. They see no other page of the doc. */
export function PageShareDialog({ open, onOpenChange, tenantId, docId, pageId }: { open: boolean; onOpenChange: (o: boolean) => void; tenantId: string; docId: string; pageId: string }) {
  const t = useTranslations("Docs"), call = useDocsCall(tenantId, docId);
  const [data, setData] = useState<PageShareView | null>(null), [error, setError] = useState(""), [query, setQuery] = useState(""), [role, setRole] = useState<ShareRole>("view");
  const load = useCallback(async () => { const r = await call<PageShareView>("GET", `/pages/${pageId}/shares`); if (r.ok) setData(r.data); else setError(r.error); }, [call, pageId]);
  useEffect(() => { if (!open) return; let live = true; call<PageShareView>("GET", `/pages/${pageId}/shares`).then((r) => { if (!live) return; if (r.ok) setData(r.data); else setError(r.error); }); return () => { live = false; }; }, [open, call, pageId]);
  async function act(method: string, path: string, body?: unknown) { setError(""); const r = await call(method, `/pages/${pageId}/shares${path}`, body); if (!r.ok) setError(r.error); else { setQuery(""); await load(); } }
  const manage = data?.canManage ?? false;
  const matches = data && query.trim() ? data.people.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6) : [];
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined} data-page-share-dialog>
    <DialogHeader><DialogTitle>{t("sharePage")}</DialogTitle></DialogHeader>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {manage && <div className="space-y-2">
      <div className="flex gap-2"><Input className="min-h-11" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("inviteByName")} aria-label={t("inviteByName")} />
        <NativeSelect aria-label={t("inviteRole")} className="min-h-11 w-32" value={role} onChange={(e) => setRole(e.target.value as ShareRole)}>{shareRoles.map((r) => <NativeSelectOption key={r} value={r}>{t(`role.${r}`)}</NativeSelectOption>)}</NativeSelect></div>
      {matches.length > 0 && <ul className="rounded-md border" aria-label={t("people")}>{matches.map((p) => <li key={p.userId}><button type="button" className="flex min-h-11 w-full items-center px-3 text-start text-sm hover:bg-accent" onClick={() => void act("POST", "", { userId: p.userId, role })}>{p.name}</button></li>)}</ul>}
      {query.trim() && matches.length === 0 && <p className="text-xs text-muted-foreground">{t("noPeopleMatch")}</p>}
    </div>}
    {data && (data.shares.length === 0 ? <p className="text-sm text-muted-foreground">{t("pageShareNone")}</p>
      : <ul className="space-y-1" aria-label={t("peopleWithAccess")}>{data.shares.map((s) => <li key={s.userId} className="flex min-h-11 items-center justify-between gap-2 rounded-md border px-3"><span className="min-w-0 truncate text-sm">{s.name}</span>
        <span className="flex items-center gap-1">{manage ? <NativeSelect aria-label={t("roleOf", { name: s.name })} className="h-9 w-28 text-xs" value={s.role} onChange={(e) => void act("POST", "", { userId: s.userId, role: e.target.value })}>{shareRoles.map((r) => <NativeSelectOption key={r} value={r}>{t(`role.${r}`)}</NativeSelectOption>)}</NativeSelect> : <span className="text-xs text-muted-foreground">{t(`role.${s.role}`)}</span>}
          {manage && <Button type="button" variant="ghost" size="icon" className="size-9" aria-label={t("removeAccess", { name: s.name })} onClick={() => void act("DELETE", `/${s.userId}`)}><X aria-hidden="true" /></Button>}</span></li>)}</ul>)}
  </DialogContent></Dialog>;
}
