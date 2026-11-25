"use client";
import { useCallback, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CircleAlert, CircleCheck, Globe, MoreHorizontal, Plus, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/copy-button";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FormSection } from "@/components/form-section";
import { StatusBadge } from "@/components/status-badge";
import { useCrmRequest } from "@/components/crm/request";
import { defineStatusTones } from "@/lib/status-tone";

type Identity = SenderSetupData["identities"][number];
type Domain = SenderSetupData["domains"][number];
type Purpose = "ownership" | "dkim" | "spf" | "bounce" | "dmarc";
export type SenderSetupData = {
  identities: { id: string; address: string; purpose: "sender" | "reply-to"; enabled: boolean; ownershipVerified: boolean; displayName: string | null; inUse: boolean; version: number; confirmationPending: boolean; domain: string | null; status: "unverified" | "pending" | "verified" | "failed" }[];
  domains: { id: string; domain: string; version: number; senderCount: number; status: "pending" | "verified" | "failed"; checkedAt: string | null;
    records: { purpose: Purpose; type: string; name: string; value: string }[]; checks: Record<Purpose, boolean> }[];
  mailingAddress: { address: string; version: number };
  readiness: { domain: boolean; sender: boolean; replyTo: boolean; mailingAddress: boolean; unsubscribe: boolean; ready: boolean };
};
const tone = defineStatusTones({ verified: "success", pending: "pending", unverified: "neutral", failed: "danger" });
const purposes: Purpose[] = ["ownership", "dkim", "spf", "bounce", "dmarc"];

/** Sender setup: sender addresses, sending-domain verification, mailing address and a readiness summary. Sending itself is off. */
export function SenderSetup({ tenantId, initial }: { tenantId: string; initial: SenderSetupData }) {
  const t = useTranslations("NewsletterSender"), format = useFormatter(), request = useCrmRequest();
  const [data, setData] = useState(initial), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const [adding, setAdding] = useState(false), [address, setAddress] = useState(""), [purpose, setPurpose] = useState<"sender" | "reply-to">("sender"), [formError, setFormError] = useState("");
  const [confirming, setConfirming] = useState<SenderSetupData["identities"][number] | null>(null), [code, setCode] = useState(""), [testCode, setTestCode] = useState<string | null>(null), [codeError, setCodeError] = useState("");
  const [naming, setNaming] = useState<Identity | null>(null), [nameValue, setNameValue] = useState(""), [nameError, setNameError] = useState("");
  const [deleting, setDeleting] = useState<Identity | null>(null), [removing, setRemoving] = useState<Domain | null>(null), [reissuing, setReissuing] = useState<Domain | null>(null);
  const [domain, setDomain] = useState(""), [domainError, setDomainError] = useState("");
  const [mailing, setMailing] = useState(initial.mailingAddress.address), [mailingState, setMailingState] = useState<"idle" | "saved" | "error">("idle");
  const base = `/api/workspaces/${tenantId}/newsletter`;

  const reload = useCallback(async () => {
    const result = await request<SenderSetupData>(`${base}/sender-setup`, { method: "GET" });
    if (result.ok) setData(result.data);
  }, [base, request]);

  async function run(key: string, call: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key); setError("");
    const result = await call();
    if (!result.ok) setError(result.error ?? t("failed"));
    await reload(); setBusy("");
    return result.ok;
  }

  async function addIdentity() {
    setFormError("");
    const result = await request<{ identity: { id: string } }>(`${base}/sender-identities`, { method: "POST", body: { address, purpose } });
    if (!result.ok) { setFormError(result.status === 409 ? t("exists") : t("invalidAddress")); return; }
    setAdding(false); setAddress(""); await reload();
  }
  async function openConfirm(row: SenderSetupData["identities"][number]) {
    setConfirming(row); setCode(""); setCodeError(""); setTestCode(null);
    const result = await request<{ code: string | null }>(`${base}/sender-identities/${row.id}/test-code`, { method: "GET" });
    if (result.ok) setTestCode(result.data.code);
  }
  async function requestCode(row: SenderSetupData["identities"][number]) {
    const ok = await run("code-" + row.id, () => request(`${base}/sender-identities/${row.id}`, { method: "PATCH", body: { version: row.version, action: "request-code" } }));
    if (ok) { const fresh = await request<SenderSetupData>(`${base}/sender-setup`, { method: "GET" }); const next = fresh.ok ? fresh.data.identities.find((i) => i.id === row.id) : null; if (next) void openConfirm(next); }
  }
  async function confirm() {
    if (!confirming) return;
    setCodeError("");
    const result = await request(`${base}/sender-identities/${confirming.id}`, { method: "PATCH", body: { version: confirming.version, action: "confirm", code: code.trim() } });
    if (!result.ok) { setCodeError(t("codeInvalid")); return; }
    setConfirming(null); await reload();
  }
  async function saveName() {
    if (!naming) return;
    setNameError("");
    const result = await request(`${base}/sender-identities/${naming.id}`, { method: "PATCH", body: { version: naming.version, displayName: nameValue.trim() || null } });
    if (!result.ok) { setNameError(result.status === 400 ? t("displayNameInvalid") : result.error); return; }
    setNaming(null); await reload();
  }
  /** Runs a confirmed mutation for a ConfirmDialog: the server's message stays in the dialog on failure, a success reloads the page data. */
  async function confirmed(call: () => Promise<{ ok: boolean; error?: string }>) {
    const result = await call();
    if (!result.ok) return result.error ?? t("failed");
    await reload();
  }
  async function addDomain() {
    setDomainError("");
    const result = await request(`${base}/sender-domains`, { method: "POST", body: { domain } });
    if (!result.ok) { setDomainError(result.status === 409 ? t("domainExists") : t("domainInvalid")); return; }
    setDomain(""); await reload();
  }
  async function saveMailing() {
    setMailingState("idle");
    const result = await request(`${base}/mailing-address`, { method: "PUT", body: { address: mailing, ...(data.mailingAddress.version ? { version: data.mailingAddress.version } : {}) } });
    setMailingState(result.ok ? "saved" : "error"); await reload();
  }

  const readyItems: { key: keyof Omit<SenderSetupData["readiness"], "ready">; href: string }[] = [
    { key: "domain", href: "#sender-domains" }, { key: "sender", href: "#sender-addresses" }, { key: "replyTo", href: "#sender-addresses" },
    { key: "mailingAddress", href: "#sender-mailing" }, { key: "unsubscribe", href: "#sender-readiness" }];
  const columns: DataTableColumn[] = [
    { id: "address", header: t("columns.address"), card: "title" }, { id: "kind", header: t("columns.kind") }, { id: "status", header: t("columns.status") },
    { id: "actions", header: t("columns.actions"), srOnlyHeader: true, align: "end", card: "actions", className: "w-16" }];
  const rows: DataTableRow[] = data.identities.map((row) => ({ id: row.id, label: row.address, cells: {
    address: <span className="flex min-h-11 min-w-0 flex-col justify-center"><span className="truncate font-medium">{row.displayName ?? row.address}</span>
      {row.displayName && <span className="truncate text-xs text-muted-foreground">{row.address}</span>}</span>,
    kind: t(row.purpose === "sender" ? "kindSender" : "kindReplyTo"),
    status: <span className="flex flex-wrap items-center gap-2"><StatusBadge tone={row.enabled ? tone(row.status) : "neutral"} label={row.enabled ? t(`status.${row.status}`) : t("status.off")} />
      {row.status === "failed" && row.enabled && <span className="text-xs text-muted-foreground">{t("domainNotVerified")}</span>}</span>,
    actions: <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("menu", { address: row.address })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {row.enabled && !row.ownershipVerified && <DropdownMenuItem className="min-h-11" onSelect={() => (row.confirmationPending ? void openConfirm(row) : void requestCode(row))}>{row.confirmationPending ? t("enterCode") : t("sendCode")}</DropdownMenuItem>}
        {row.enabled && !row.ownershipVerified && row.confirmationPending && <DropdownMenuItem className="min-h-11" onSelect={() => void requestCode(row)}>{t("newCode")}</DropdownMenuItem>}
        {row.purpose === "sender" && <DropdownMenuItem className="min-h-11" onSelect={() => { setNaming(row); setNameValue(row.displayName ?? ""); setNameError(""); }}>{t("editName")}</DropdownMenuItem>}
        <DropdownMenuItem className="min-h-11" onSelect={() => void run("toggle-" + row.id, () => request(`${base}/sender-identities/${row.id}`, { method: "PATCH", body: { version: row.version, enabled: !row.enabled } }))}>{row.enabled ? t("turnOff") : t("turnOn")}</DropdownMenuItem>
        <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onSelect={() => setDeleting(row)}>{t("delete")}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>,
  } }));
  const checked = (value: string | null) => value ? t("lastChecked", { when: format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" }) }) : t("neverChecked");

  return <div className="min-w-0 space-y-8" data-sender-setup>
    <header className="space-y-1"><h1 className="text-[28px] font-semibold tracking-tight">{t("heading")}</h1></header>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

    <section id="sender-readiness" aria-labelledby="sender-readiness-title" className="space-y-3 rounded-lg border bg-card p-4 sm:p-6" data-readiness={data.readiness.ready ? "ready" : "missing"}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="sender-readiness-title" className="text-base font-semibold">{data.readiness.ready ? t("ready") : t("notReady")}</h2>
        <p className="text-sm text-muted-foreground">{t("sendingOff")}</p></div>
      <ul className="grid gap-1 sm:grid-cols-2">{readyItems.map(({ key, href }) => { const ok = data.readiness[key];
        return <li key={key} data-ready-item={key} data-ok={ok}>{ok
          ? <span className="flex min-h-11 items-center gap-2 text-sm"><CircleCheck className="size-4 text-primary" aria-hidden="true" />{t(`readiness.${key}.ok`)}</span>
          : <a href={href} className="flex min-h-11 items-center gap-2 text-sm underline-offset-4 hover:underline"><CircleAlert className="size-4 text-destructive" aria-hidden="true" />{t(`readiness.${key}.missing`)}</a>}</li>; })}</ul>
    </section>

    <section id="sender-addresses" aria-labelledby="sender-addresses-title" className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="sender-addresses-title" className="text-lg font-semibold">{t("addresses")}</h2>
        <Button type="button" className="min-h-11" onClick={() => { setAdding(true); setFormError(""); }}><Plus aria-hidden="true" />{t("addAddress")}</Button></div>
      {data.identities.length === 0 ? <EmptyState icon={ShieldCheck} size="compact" title={t("addressesEmpty")} />
        : <DataTable label={t("addresses")} columns={columns} rows={rows} />}
    </section>

    <section id="sender-domains" aria-labelledby="sender-domains-title" className="scroll-mt-20 space-y-4">
      <h2 id="sender-domains-title" className="text-lg font-semibold">{t("domains")}</h2>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void addDomain(); }}>
        <div className="min-w-52 flex-1 space-y-2 sm:max-w-sm"><Label htmlFor="sender-domain">{t("domain")}</Label>
          <Input id="sender-domain" className="min-h-11" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder={t("domainPlaceholder")} autoComplete="off" aria-invalid={domainError ? true : undefined} aria-describedby={domainError ? "sender-domain-error" : undefined} /></div>
        <Button type="submit" className="min-h-11" disabled={!domain.trim()}><Plus aria-hidden="true" />{t("addDomain")}</Button>
        {domainError && <p id="sender-domain-error" role="alert" className="w-full text-sm text-destructive">{domainError}</p>}
      </form>
      {data.domains.length === 0 ? <EmptyState icon={Globe} size="compact" title={t("domainsEmpty")} />
        : <div className="space-y-6">{data.domains.map((d) => <FormSection key={d.id} title={d.domain} as="section" actions={<><StatusBadge tone={tone(d.status)} label={t(`domainStatus.${d.status}`)} />
          <Button type="button" variant="outline" className="min-h-11" disabled={busy === "verify-" + d.id} onClick={() => void run("verify-" + d.id, () => request(`${base}/sender-domains/${d.id}/verify`, { method: "POST", body: {} }))}>{t("verify")}</Button>
          <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("domainMenu", { domain: d.domain })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuItem className="min-h-11" onSelect={() => setReissuing(d)}>{t("reissue")}</DropdownMenuItem>
              <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onSelect={() => setRemoving(d)}>{t("removeDomain")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></>}>
          <p className="text-sm text-muted-foreground" data-last-checked>{checked(d.checkedAt)}</p>
          {purposes.map((p) => { const records = d.records.filter((r) => r.purpose === p); if (!records.length) return null;
            return <div key={p} className="space-y-2" data-record-group={p}>
              <h4 className="flex items-center gap-2 text-sm font-medium">{t(`purpose.${p}`)}{d.checkedAt && (d.checks[p]
                ? <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground"><CircleCheck className="size-3.5 text-primary" aria-hidden="true" />{t("found")}</span>
                : <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground"><CircleAlert className="size-3.5 text-destructive" aria-hidden="true" />{t("notFound")}</span>)}</h4>
              <DataTable label={t(`purpose.${p}`)} columns={[{ id: "type", header: t("columns.type"), className: "w-24" }, { id: "host", header: t("columns.host") }, { id: "value", header: t("columns.value") }]}
                rows={records.map((r, i) => ({ id: p + i, label: r.name, cells: {
                  type: r.type,
                  host: <span className="flex items-center gap-1"><code className="min-w-0 break-all text-xs">{r.name}</code><CopyButton value={r.name} label={t("copyHost", { host: r.name })} /></span>,
                  value: <span className="flex items-center gap-1"><code className="min-w-0 break-all text-xs">{r.value}</code><CopyButton value={r.value} label={t("copyValue", { host: r.name })} /></span> } }))} /></div>; })}
        </FormSection>)}</div>}
    </section>

    <section id="sender-mailing" aria-labelledby="sender-mailing-title" className="scroll-mt-20 space-y-3">
      <h2 id="sender-mailing-title" className="text-lg font-semibold">{t("mailing")}</h2>
      <form className="max-w-xl space-y-3" onSubmit={(e) => { e.preventDefault(); void saveMailing(); }}>
        <div className="space-y-2"><Label htmlFor="sender-mailing-address" className="sr-only">{t("mailingLabel")}</Label>
          <Textarea id="sender-mailing-address" rows={3} maxLength={300} value={mailing} onChange={(e) => { setMailing(e.target.value); setMailingState("idle"); }} /></div>
        <div className="flex flex-wrap items-center gap-3"><Button type="submit" className="min-h-11">{t("save")}</Button>
          <span role="status" aria-live="polite" className="text-sm text-muted-foreground">{mailingState === "saved" ? t("saved") : mailingState === "error" ? t("failed") : ""}</span></div>
      </form>
    </section>

    <Dialog open={adding} onOpenChange={setAdding}><DialogContent><DialogHeader><DialogTitle>{t("addAddress")}</DialogTitle><DialogDescription className="sr-only">{t("addAddress")}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void addIdentity(); }}>
        <div className="space-y-2"><Label htmlFor="sender-address">{t("columns.address")}</Label><Input id="sender-address" type="email" className="min-h-11" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" /></div>
        <div className="space-y-2"><Label htmlFor="sender-kind">{t("columns.kind")}</Label><NativeSelect id="sender-kind" className="w-full" value={purpose} onChange={(e) => setPurpose(e.target.value as "sender" | "reply-to")}>
          <NativeSelectOption value="sender">{t("kindSender")}</NativeSelectOption><NativeSelectOption value="reply-to">{t("kindReplyTo")}</NativeSelectOption></NativeSelect></div>
        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
        <DialogFooter><Button type="button" variant="outline" className="min-h-11" onClick={() => setAdding(false)}>{t("cancel")}</Button><Button type="submit" className="min-h-11" disabled={!address.trim()}>{t("add")}</Button></DialogFooter>
      </form></DialogContent></Dialog>

    <Dialog open={!!naming} onOpenChange={(open) => { if (!open) setNaming(null); }}><DialogContent><DialogHeader><DialogTitle>{t("editName")}</DialogTitle><DialogDescription>{naming?.address}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void saveName(); }}>
        <div className="space-y-2"><Label htmlFor="sender-display-name">{t("displayName")}</Label><Input id="sender-display-name" className="min-h-11" maxLength={80} value={nameValue} onChange={(e) => setNameValue(e.target.value)} autoComplete="off" aria-invalid={nameError ? true : undefined} /></div>
        {nameError && <p role="alert" className="text-sm text-destructive">{nameError}</p>}
        <DialogFooter><Button type="button" variant="outline" className="min-h-11" onClick={() => setNaming(null)}>{t("cancel")}</Button><Button type="submit" className="min-h-11">{t("save")}</Button></DialogFooter>
      </form></DialogContent></Dialog>

    <ConfirmDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }} title={t("deleteTitle", { address: deleting?.address ?? "" })} description={t("deleteBody")}
      confirmLabel={t("delete")} cancelLabel={t("cancel")} onConfirm={() => deleting ? confirmed(() => request(`${base}/sender-identities/${deleting.id}`, { method: "DELETE", body: { version: deleting.version } })) : undefined} />
    <ConfirmDialog open={!!removing} onOpenChange={(open) => { if (!open) setRemoving(null); }} title={t("removeDomainTitle", { domain: removing?.domain ?? "" })} description={t("removeDomainBody")}
      confirmLabel={t("removeDomain")} cancelLabel={t("cancel")} onConfirm={() => removing ? confirmed(() => request(`${base}/sender-domains/${removing.id}`, { method: "DELETE", body: { version: removing.version } })) : undefined} />
    <ConfirmDialog tone="neutral" open={!!reissuing} onOpenChange={(open) => { if (!open) setReissuing(null); }} title={t("reissueTitle", { domain: reissuing?.domain ?? "" })} description={t("reissueBody")}
      confirmLabel={t("reissue")} cancelLabel={t("cancel")} onConfirm={() => reissuing ? confirmed(() => request(`${base}/sender-domains/${reissuing.id}/reissue`, { method: "POST", body: { version: reissuing.version } })) : undefined} />

    <Dialog open={!!confirming} onOpenChange={(open) => { if (!open) setConfirming(null); }}><DialogContent><DialogHeader><DialogTitle>{t("confirmTitle")}</DialogTitle><DialogDescription>{confirming?.address}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
        <div className="space-y-2"><Label htmlFor="sender-code">{t("code")}</Label><Input id="sender-code" className="min-h-11" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></div>
        {testCode && <p className="flex flex-wrap items-center gap-2 text-sm" data-test-code><span className="text-muted-foreground">{t("testCode")}</span><Button type="button" variant="outline" className="min-h-11" onClick={() => setCode(testCode)}>{t("useCode")}</Button></p>}
        {codeError && <p role="alert" className="text-sm text-destructive">{codeError}</p>}
        <DialogFooter><Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirming(null)}>{t("cancel")}</Button><Button type="submit" className="min-h-11" disabled={!code.trim()}>{t("confirm")}</Button></DialogFooter>
      </form></DialogContent></Dialog>
  </div>;
}
