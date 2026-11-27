"use client";
import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Check, Eye, EyeOff, Flag, MoreHorizontal, X } from "lucide-react";
import { request } from "@/hooks/use-request";
import { authClient } from "@/lib/auth-client";
import type { StaffCommunityReport } from "@/server/community-takedown";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { StaffHideDialog } from "@/components/platform/staff-hide-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Status = "open" | "reviewed" | "dismissed";
type Load = "loading" | "ready" | "error" | "reauth";
const statuses: Status[] = ["open", "reviewed", "dismissed"];

/**
 * Harvest staff: reports of communities, posts and replies, on the same DataTable, tabs and row menu as the Ways to give review. Reviewers and admins resolve
 * reports; admins only hide and restore (not rendered for a reviewer; the server and the database refuse it too).
 */
export function StaffCommunityReview({ role, initialOpen }: { role: "reviewer" | "admin"; initialOpen: number }) {
  const t = useTranslations("CommunityTakedown.staff"), tr = useTranslations("CommunityTakedown.report"), format = useFormatter();
  const [status, setStatus] = useState<Status>("open"), [reports, setReports] = useState<StaffCommunityReport[]>([]), [openCount, setOpenCount] = useState(initialOpen), [load, setLoad] = useState<Load>("loading"), [banner, setBanner] = useState("");
  const [hiding, setHiding] = useState<StaffCommunityReport | null>(null), [restoring, setRestoring] = useState<StaffCommunityReport | null>(null);
  const refresh = useCallback(async (which: Status) => {
    setLoad("loading");
    const result = await request<{ reports: StaffCommunityReport[]; openCount: number }>(`/api/platform/communities/reports?status=${which}`, { method: "GET" });
    if (!result.ok) { setLoad(result.status === 401 ? "reauth" : "error"); return; }
    setReports(result.data.reports); setOpenCount(result.data.openCount); setLoad("ready");
  }, []);
  useEffect(() => { const timer = setTimeout(() => void refresh(status), 0); return () => clearTimeout(timer); }, [refresh, status]);
  async function act(path: string, body: unknown, done: string) {
    const result = await request(path, { method: "POST", body });
    if (!result.ok) return result.status === 401 ? t("reauth") : result.error;
    setBanner(done); await refresh(status);
  }
  const takedown = (r: StaffCommunityReport, hidden: boolean, reason?: string) =>
    act("/api/platform/communities/takedowns", { targetType: r.targetType, targetId: r.targetId, hidden, ...(reason ? { reason } : {}) }, t(hidden ? "hiddenDone" : "restoredDone"));
  async function signInAgain() { await authClient.signOut().catch(() => undefined); window.location.replace("/sign-in?next=%2Fplatform%2Fcommunities"); }
  const name = (r: StaffCommunityReport) => r.community ?? t("unknown");

  const columns: DataTableColumn[] = [
    { id: "community", header: t("community"), card: "title", className: "whitespace-normal" }, { id: "target", header: t("target"), className: "whitespace-normal" },
    { id: "content", header: t("content"), showFrom: "@md", className: "min-w-48 whitespace-normal" }, { id: "reason", header: t("reason"), className: "whitespace-normal" },
    { id: "note", header: t("note"), showFrom: "@lg", className: "min-w-40 whitespace-normal" },
    { id: "reported", header: t("reported"), showFrom: "@lg", className: "whitespace-normal" }, { id: "visibility", header: t("visibility") },
    { id: "actions", header: t("actions"), srOnlyHeader: true, align: "end", card: "actions", className: "w-16" },
  ];
  const rows: DataTableRow[] = reports.map((r) => ({ id: r.id, label: name(r), cells: {
    community: <span className="break-words"><span className="font-medium">{name(r)}</span>{r.ministry && <span className="block text-sm text-muted-foreground">{r.ministry}</span>}</span>,
    target: t(`targets.${r.targetType}`),
    content: r.targetType === "community" ? (r.slug ? `/communities/${r.slug}` : t("none")) : r.removed ? t("removed") : <span className="break-words">{r.excerpt}</span>,
    reason: tr(`reasons.${r.reason as "other"}`), note: r.note ? <span className="break-words">{r.note}</span> : t("none"),
    reported: format.dateTime(new Date(r.createdAt), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }),
    visibility: <StatusBadge tone={r.hidden ? "danger" : "success"} label={t(r.hidden ? "hidden" : "shown")} dot />,
    actions: r.status !== "open" && role !== "admin" ? null : <DropdownMenu><DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="icon" className="size-11 lg:size-9" aria-label={t("actionsNamed", { name: name(r) })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {r.status === "open" && <><DropdownMenuItem className="min-h-11 lg:min-h-0" onSelect={() => void act(`/api/platform/communities/reports/${r.id}/resolve`, { status: "reviewed" }, t("resolved"))}><Check aria-hidden="true" />{t("markReviewed")}</DropdownMenuItem>
          <DropdownMenuItem className="min-h-11 lg:min-h-0" onSelect={() => void act(`/api/platform/communities/reports/${r.id}/resolve`, { status: "dismissed" }, t("resolved"))}><X aria-hidden="true" />{t("dismiss")}</DropdownMenuItem></>}
        {role === "admin" && <>{r.status === "open" && <DropdownMenuSeparator />}{r.hidden
          ? <DropdownMenuItem className="min-h-11 lg:min-h-0" onSelect={() => setRestoring(r)}><Eye aria-hidden="true" />{t("restore")}</DropdownMenuItem>
          : <DropdownMenuItem variant="destructive" className="min-h-11 lg:min-h-0" onSelect={() => setHiding(r)}><EyeOff aria-hidden="true" />{t(`hide.${r.targetType}`)}</DropdownMenuItem>}</>}
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
    {hiding && <StaffHideDialog id="community-hide-reason" title={t(`hideTitle.${hiding.targetType}`, { name: name(hiding) })} reasonLabel={t("hideReason")} cancelLabel={t("cancel")}
      hideLabel={t(`hide.${hiding.targetType}`)} onClose={() => setHiding(null)} onHide={async (reason) => { const problem = await takedown(hiding, true, reason); if (!problem) setHiding(null); return problem; }} />}
    <ConfirmDialog tone="neutral" open={restoring !== null} onOpenChange={(open) => { if (!open) setRestoring(null); }} title={t("restoreTitle")} description={restoring ? t(`restoreBody.${restoring.targetType}`, { name: name(restoring) }) : undefined}
      cancelLabel={t("cancel")} confirmLabel={t("restore")} onConfirm={async () => { if (!restoring) return; const problem = await takedown(restoring, false); if (problem) return problem; setRestoring(null); }} />
  </div>;
}
