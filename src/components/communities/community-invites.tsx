"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Copy } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { defineStatusTones } from "@/lib/status-tone";
import { useCrmRequest } from "@/components/crm/request";

const inviteTone = defineStatusTones({ pending: "pending", redeemed: "success", revoked: "neutral", expired: "warning" });
export type CommunityInvite = { id: string; emailHint: string; expiresAt: string | Date; status: "pending" | "redeemed" | "revoked" | "expired" };

/** C08: personal invitation links. Harvest shows the link once; the owner copies and sends it. */
export function CommunityInvites({ endpoint, initial }: { endpoint: string; initial: CommunityInvite[] }) {
  const t = useTranslations("CommunityInvites"), format = useFormatter(), request = useCrmRequest();
  const [invites, setInvites] = useState(initial), [open, setOpen] = useState(false), [email, setEmail] = useState("");
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null), [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function refresh() { const result = await request<CommunityInvite[]>(`${endpoint}/invites`, { method: "GET" }); if (result.ok) setInvites(result.data); }
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const result = await request<{ url: string; expiresAt: string }>(`${endpoint}/invites`, { method: "POST", body: { email: email.trim() } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setCreated({ url: result.data.url, expiresAt: result.data.expiresAt }); setCopied(false); await refresh();
  }
  async function revoke(id: string) {
    setError("");
    const result = await request(`${endpoint}/invites/${id}`, { method: "DELETE", body: {} });
    if (!result.ok) setError(result.error); else await refresh();
  }
  const columns: DataTableColumn[] = [
    { id: "email", header: t("email"), card: "title" }, { id: "status", header: t("status") }, { id: "expires", header: t("expiresHeader") },
    { id: "actions", header: t("actions"), srOnlyHeader: true, align: "end", card: "actions" },
  ];
  const rows: DataTableRow[] = invites.map((invite) => ({ id: invite.id, label: invite.emailHint, cells: {
    email: invite.emailHint,
    status: <StatusBadge tone={inviteTone(invite.status)} label={t(`statuses.${invite.status}`)} />,
    expires: format.dateTime(new Date(invite.expiresAt), { dateStyle: "medium" }),
    actions: invite.status === "pending" ? <Button variant="ghost" className="min-h-11" onClick={() => void revoke(invite.id)} aria-label={t("revokeNamed", { email: invite.emailHint })}>{t("revoke")}</Button> : null,
  } }));
  return <div className="space-y-4">
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setCreated(null); setEmail(""); setError(""); } }}>
      <DialogTrigger asChild><Button variant="outline" className="min-h-11">{t("invite")}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("title")}</DialogTitle></DialogHeader>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {created
          ? <div className="space-y-3">
            <Field><FieldLabel htmlFor="invite-link">{t("link")}</FieldLabel>
              <div className="flex gap-2"><Input id="invite-link" className="min-h-11" value={created.url} readOnly onFocus={(event) => event.currentTarget.select()} />
                <Button type="button" variant="outline" className="min-h-11" onClick={() => void navigator.clipboard.writeText(created.url).then(() => setCopied(true))}>
                  <Copy aria-hidden="true" />{t(copied ? "copied" : "copy")}</Button></div></Field>
            <p className="text-sm">{t("expires", { date: format.dateTime(new Date(created.expiresAt), { dateStyle: "medium" }) })}</p>
          </div>
          : <form id="invite-form" onSubmit={(event) => void create(event)}>
            <Field><FieldLabel htmlFor="invite-email">{t("email")}</FieldLabel>
              <Input id="invite-email" type="email" className="min-h-11" value={email} maxLength={320} required autoComplete="off" onChange={(event) => setEmail(event.target.value)} /></Field>
          </form>}
        <DialogFooter>{created
          ? <Button className="min-h-11" onClick={() => setOpen(false)}>{t("done")}</Button>
          : <Button type="submit" form="invite-form" className="min-h-11" disabled={busy || !email.trim()}>{t("create")}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
    {!open && error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {invites.length > 0 && <DataTable label={t("tableLabel")} columns={columns} rows={rows} />}
  </div>;
}
