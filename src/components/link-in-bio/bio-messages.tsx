"use client";
import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Inbox, Mail, Trash2, User } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useCrmRequest } from "@/components/crm/request";
import { EmptyState } from "@/components/empty-state";
import type { BioMessageRow } from "@/server/link-in-bio";

/** Messages sent from the page: newest first, kept 90 days. Replying opens the owner's own mail program; Harvest sends nothing. */
export function BioMessages({ tenantId, initial, available }: { tenantId: string; initial: BioMessageRow[]; available: boolean }) {
  const t = useTranslations("LinkInBio.inbox"), format = useFormatter(), request = useCrmRequest();
  const [rows, setRows] = useState(initial), [error, setError] = useState(""), [removing, setRemoving] = useState<BioMessageRow | null>(null);
  const base = `/api/workspaces/${tenantId}/link-in-bio/messages`;
  async function toggle(row: BioMessageRow) {
    const status = row.status === "new" ? "handled" : "new";
    const result = await request<{ id: string }>(`${base}/${row.id}`, { method: "PATCH", body: { status } });
    if (result.ok) setRows((list) => list.map((r) => r.id === row.id ? { ...r, status } : r)); else setError(result.error);
  }
  async function remove(row: BioMessageRow) {
    const result = await request<{ id: string }>(`${base}/${row.id}`, { method: "DELETE" });
    if (result.ok) setRows((list) => list.filter((r) => r.id !== row.id)); else setError(result.error);
    setRemoving(null);
  }
  return <div className="space-y-6" data-bio-messages>
    <header className="space-y-2"><Button asChild variant="ghost" className="-ms-3 min-h-11"><Link href={`/workspaces/${tenantId}/link-in-bio`}>{t("back")}</Link></Button>
      <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1><p className="text-sm text-muted-foreground">{t("retention")}</p></header>
    {!available && <Alert role="status"><AlertDescription>{t("off")}</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {rows.length === 0 ? <EmptyState icon={Inbox} title={t("empty")} description={t("emptyBody")} />
      : <ul className="space-y-3">{rows.map((row) => <li key={row.id} data-bio-message={row.id}><Card><CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center gap-2"><span className="font-medium break-words">{t("from", { name: row.name })}</span>
          <Badge variant={row.status === "new" ? "default" : "secondary"}>{t(row.status)}</Badge><Badge variant="outline">{t(row.createdContact ? "newPerson" : "knownPerson")}</Badge></div>
        <p className="whitespace-pre-line break-words text-sm">{row.body}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{row.email}</span><span>{t("received", { when: format.dateTime(new Date(row.createdAt), { dateStyle: "medium", timeStyle: "short" }) })}</span><span>{t("expires", { when: format.dateTime(new Date(row.expiresAt), { dateStyle: "medium" }) })}</span></p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="min-h-11"><a href={`mailto:${row.email}`}><Mail aria-hidden="true" />{t("reply")}</a></Button>
          <Button asChild variant="outline" className="min-h-11"><Link href={`/workspaces/${tenantId}/contacts/${row.contactId}`}><User aria-hidden="true" />{t("person")}</Link></Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void toggle(row)}>{t(row.status === "new" ? "markHandled" : "markNew")}</Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => setRemoving(row)}><Trash2 aria-hidden="true" />{t("delete")}</Button>
        </div></CardContent></Card></li>)}</ul>}
    <ConfirmDialog tone="destructive" open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }} title={t("deleteTitle")} description={t("deleteBody")} cancelLabel={t("keep")} confirmLabel={t("delete")} onConfirm={() => removing ? remove(removing) : undefined} />
  </div>;
}
