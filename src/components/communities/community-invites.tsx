"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Copy } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCrmRequest } from "@/components/crm/request";

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
    const result = await request<{ path: string; expiresAt: string }>(`${endpoint}/invites`, { method: "POST", body: { email: email.trim() } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setCreated({ url: `${location.origin}${result.data.path}`, expiresAt: result.data.expiresAt }); setCopied(false); await refresh();
  }
  async function revoke(id: string) {
    setError("");
    const result = await request(`${endpoint}/invites/${id}`, { method: "DELETE", body: {} });
    if (!result.ok) setError(result.error); else await refresh();
  }
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
    {invites.length > 0 && <div className="overflow-x-auto"><Table aria-label={t("tableLabel")}>
      <TableHeader><TableRow><TableHead>{t("email")}</TableHead><TableHead>{t("status")}</TableHead><TableHead>{t("expiresHeader")}</TableHead><TableHead><span className="sr-only">{t("actions")}</span></TableHead></TableRow></TableHeader>
      <TableBody>{invites.map((invite) => <TableRow key={invite.id}>
        <TableCell>{invite.emailHint}</TableCell>
        <TableCell><Badge variant={invite.status === "pending" ? "secondary" : "outline"}>{t(`statuses.${invite.status}`)}</Badge></TableCell>
        <TableCell>{format.dateTime(new Date(invite.expiresAt), { dateStyle: "medium" })}</TableCell>
        <TableCell className="text-right">{invite.status === "pending" && <Button variant="ghost" className="min-h-11" onClick={() => void revoke(invite.id)}
          aria-label={t("revokeNamed", { email: invite.emailHint })}>{t("revoke")}</Button>}</TableCell>
      </TableRow>)}</TableBody></Table></div>}
  </div>;
}
