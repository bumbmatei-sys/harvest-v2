"use client";
import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Check, Eye, EyeOff, Flag, MoreHorizontal, X } from "lucide-react";
import { request } from "@/hooks/use-request";
import { authClient } from "@/lib/auth-client";
import type { StaffGivingReport } from "@/server/platform/giving";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
    // Text columns wrap (cells default to one line), so the row fits the container at desktop widths instead of pushing the actions out of view.
    { id: "ministry", header: t("ministry"), card: "title", className: "whitespace-normal" }, { id: "reason", header: t("reason"), className: "whitespace-normal" },
    { id: "note", header: t("note"), showFrom: "@lg", className: "min-w-40 whitespace-normal" }, { id: "page", header: t("page"), showFrom: "@md", className: "whitespace-normal break-all" },
    { id: "reported", header: t("reported"), showFrom: "@md", className: "whitespace-normal" }, { id: "giving", header: t("giving") },
    { id: "actions", header: t("actions"), srOnlyHeader: true, align: "end", card: "actions", className: "w-16" },
  ];
  const rows: DataTableRow[] = reports.map((r) => ({ id: r.id, label: r.ministry, cells: {
    ministry: <span className="break-words font-medium">{r.ministry}</span>, reason: tr(`reasons.${r.reason as "other"}`), note: r.note ? <span className="break-words">{r.note}</span> : t("none"),
    page: t("pageRef", { ref: r.ref }), reported: format.dateTime(new Date(r.createdAt), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }),
    giving: <StatusBadge tone={r.hidden ? "danger" : "success"} label={t(r.hidden ? "hidden" : "shown")} dot />,
    // One row menu, like the other DataTable screens: three wide buttons clipped the table at desktop widths.
    actions: r.status !== "open" && role !== "admin" ? null : <DropdownMenu><DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="icon" className="size-11 lg:size-9" aria-label={t("actionsNamed", { name: r.ministry })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {r.status === "open" && <><DropdownMenuItem className="min-h-11 lg:min-h-0" onSelect={() => void act(`/api/platform/giving/reports/${r.id}/resolve`, { status: "reviewed" }, t("resolved"))}><Check aria-hidden="true" />{t("markReviewed")}</DropdownMenuItem>
          <DropdownMenuItem className="min-h-11 lg:min-h-0" onSelect={() => void act(`/api/platform/giving/reports/${r.id}/resolve`, { status: "dismissed" }, t("resolved"))}><X aria-hidden="true" />{t("dismiss")}</DropdownMenuItem></>}
        {role === "admin" && <>{r.status === "open" && <DropdownMenuSeparator />}{r.hidden
          ? <DropdownMenuItem className="min-h-11 lg:min-h-0" onSelect={() => setRestoring(r)}><Eye aria-hidden="true" />{t("restore")}</DropdownMenuItem>
          : <DropdownMenuItem variant="destructive" className="min-h-11 lg:min-h-0" onSelect={() => setHiding(r)}><EyeOff aria-hidden="true" />{t("hide")}</DropdownMenuItem>}</>}
      </DropdownMenuContent></DropdownMenu>,
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
