"use client";
import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Flag } from "lucide-react";
import { request } from "@/hooks/use-request";
import { authClient } from "@/lib/auth-client";
import type { StaffGivingReport } from "@/server/platform/giving";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

type Status = "open" | "reviewed" | "dismissed";
type Load = "loading" | "ready" | "error" | "reauth";
const statuses: Status[] = ["open", "reviewed", "dismissed"];

/**
 * Harvest staff: Ways to give reports on the shared DataTable, with the open count on the Open tab. Reviewers and admins resolve reports; admins only hide a
 * ministry's giving details at once and restore them (not rendered for a reviewer; the server and database refuse it too).
 */
export function StaffGivingReview({ role, initialOpen }: { role: "reviewer" | "admin"; initialOpen: number }) {
  const t = useTranslations("WaysToGive.staff"), tr = useTranslations("WaysToGive.report"), format = useFormatter();
  const [status, setStatus] = useState<Status>("open"), [reports, setReports] = useState<StaffGivingReport[]>([]), [openCount, setOpenCount] = useState(initialOpen), [load, setLoad] = useState<Load>("loading"), [banner, setBanner] = useState("");
  const [hiding, setHiding] = useState<StaffGivingReport | null>(null), [restoring, setRestoring] = useState<StaffGivingReport | null>(null);
  const refresh = useCallback(async (which: Status) => {
    setLoad("loading");
    const result = await request<{ reports: StaffGivingReport[]; openCount: number }>(`/api/platform/giving/reports?status=${which}`, { method: "GET" });
    if (!result.ok) { setLoad(result.status === 401 ? "reauth" : "error"); return; }
    setReports(result.data.reports); setOpenCount(result.data.openCount); setLoad("ready");
  }, []);
  useEffect(() => { const timer = setTimeout(() => void refresh(status), 0); return () => clearTimeout(timer); }, [refresh, status]);
  async function act(path: string, body: unknown, done: string) {
    const result = await request(path, { method: "POST", body });
    if (!result.ok) return result.status === 401 ? t("reauth") : result.error;
    setBanner(done); await refresh(status);
  }
  async function signInAgain() { await authClient.signOut().catch(() => undefined); window.location.replace("/sign-in?next=%2Fplatform%2Fgiving"); }

  const columns: DataTableColumn[] = [
    { id: "ministry", header: t("ministry"), card: "title" }, { id: "reason", header: t("reason") }, { id: "note", header: t("note"), showFrom: "@lg" },
    { id: "page", header: t("page"), showFrom: "@md" }, { id: "reported", header: t("reported"), showFrom: "@md" }, { id: "giving", header: t("giving") },
    { id: "actions", header: t("actions"), srOnlyHeader: true, align: "end", card: "actions" },
  ];
  const rows: DataTableRow[] = reports.map((r) => ({ id: r.id, label: r.ministry, cells: {
    ministry: <span className="break-words font-medium">{r.ministry}</span>, reason: tr(`reasons.${r.reason as "other"}`), note: r.note ? <span className="break-words">{r.note}</span> : t("none"),
    page: t("pageRef", { ref: r.ref }), reported: format.dateTime(new Date(r.createdAt), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }),
    giving: <StatusBadge tone={r.hidden ? "danger" : "success"} label={t(r.hidden ? "hidden" : "shown")} dot />,
    actions: <span className="flex flex-wrap justify-end gap-2">
      {r.status === "open" && <><Button type="button" variant="outline" size="responsive" aria-label={t("markReviewedNamed", { name: r.ministry })} onClick={() => void act(`/api/platform/giving/reports/${r.id}/resolve`, { status: "reviewed" }, t("resolved"))}>{t("markReviewed")}</Button>
        <Button type="button" variant="outline" size="responsive" aria-label={t("dismissNamed", { name: r.ministry })} onClick={() => void act(`/api/platform/giving/reports/${r.id}/resolve`, { status: "dismissed" }, t("resolved"))}>{t("dismiss")}</Button></>}
      {role === "admin" && (r.hidden ? <Button type="button" variant="outline" size="responsive" aria-label={t("restoreNamed", { name: r.ministry })} onClick={() => setRestoring(r)}>{t("restore")}</Button>
        : <Button type="button" variant="destructive" size="responsive" aria-label={t("hideNamed", { name: r.ministry })} onClick={() => setHiding(r)}>{t("hide")}</Button>)}
    </span>,
  } }));

  return <div className="min-w-0 space-y-4">
    {banner && <p role="status" className="rounded-md border bg-card px-3 py-2 text-sm">{banner}</p>}
    {load === "reauth" ? <Alert role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{t("reauth")}<Button type="button" size="responsive" onClick={() => void signInAgain()}>{t("signInAgain")}</Button></AlertDescription></Alert>
      : <DataTable label={t("tableLabel")} columns={columns} rows={rows} state={load === "loading" ? "loading" : load === "error" ? "error" : "ready"}
        tabs={{ label: t("tabsLabel"), value: status, onValueChange: (value) => { setStatus(value as Status); setBanner(""); }, items: statuses.map((value) => ({ value, label: t(`tabs.${value}`), ...(value === "open" ? { count: openCount } : {}) })) }}
        toolbar={{ actions: <Button type="button" variant="outline" size="responsive" disabled={load === "loading"} onClick={() => void refresh(status)}>{t("refresh")}</Button> }}
        error={<Alert variant="destructive" role="alert"><AlertDescription>{t("loadFailed")}</AlertDescription></Alert>}
        empty={<EmptyState icon={Flag} size="compact" title={t(`empty.${status}`)} />} />}
    {hiding && <HideDialog report={hiding} onClose={() => setHiding(null)} onHide={async (reason) => { const problem = await act(`/api/platform/giving/ministries/${hiding.tenantId}/standing`, { hidden: true, reason }, t("hiddenDone")); if (!problem) setHiding(null); return problem; }} />}
    <ConfirmDialog tone="neutral" open={restoring !== null} onOpenChange={(open) => { if (!open) setRestoring(null); }} title={t("restoreTitle")} description={restoring ? t("restoreBody", { name: restoring.ministry }) : undefined}
      cancelLabel={t("cancel")} confirmLabel={t("restore")} onConfirm={async () => { if (!restoring) return; const problem = await act(`/api/platform/giving/ministries/${restoring.tenantId}/standing`, { hidden: false }, t("restoredDone")); if (problem) return problem; setRestoring(null); }} />
  </div>;
}

function HideDialog({ report, onClose, onHide }: { report: StaffGivingReport; onClose: () => void; onHide: (reason: string) => Promise<string | undefined> }) {
  const t = useTranslations("WaysToGive.staff");
  const [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit() {
    if (!reason.trim()) return;
    setBusy(true); setError("");
    const problem = await onHide(reason.trim());
    setBusy(false);
    if (problem) setError(problem);
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
      <DialogHeader><DialogTitle className="break-words">{t("hideTitle", { name: report.ministry })}</DialogTitle></DialogHeader>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <Field><FieldLabel htmlFor="giving-hide-reason">{t("hideReason")}</FieldLabel>
        <Textarea id="giving-hide-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <DialogFooter><Button type="button" variant="outline" size="responsive" disabled={busy} onClick={onClose}>{t("cancel")}</Button>
        <Button type="button" variant="destructive" size="responsive" disabled={busy || !reason.trim()} onClick={() => void submit()}>{t("hide")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
