/** Derived from Shadcn UI Kit item tables14 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 3 and Kit PR 7). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Flag, History, Hourglass, MoreHorizontal, Scale, Search, Users, type LucideIcon } from "lucide-react";
import { useCrmRequest } from "@/components/crm/request";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { memberInitials } from "@/lib/community-members";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canActOn, canDecideAppeal, communityRank, moderationLimits, muteDays } from "@/lib/moderation";
import type { AppealItem, HeldItem, HistoryEntry, ModerationMember, QueueItem } from "@/server/community-moderation";
import { EditHistory } from "./edit-history";

type Props = { slug: string; me: string; role: string; queue: QueueItem[]; held: HeldItem[]; members: ModerationMember[]; history: HistoryEntry[]; appeals: AppealItem[] };

/** C12a: the hosts' moderation page. Studio Admin style: tabs, tables, a review sheet and row menus. */
export function ModerationPanel({ slug, me, role, queue, held, members, history, appeals }: Props) {
  const t = useTranslations("Moderation"), ks = useTranslations("CommunityScreens.moderation"), format = useFormatter(), request = useCrmRequest(), router = useRouter();
  const [tab, setTab] = useState("reports"), [reviewing, setReviewing] = useState<string | null>(null), [search, setSearch] = useState("");
  const [banning, setBanning] = useState<ModerationMember | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [warning, setWarning] = useState<ModerationMember | null>(null), [warnReason, setWarnReason] = useState("");
  const [appealId, setAppealId] = useState<string | null>(null), [appealReply, setAppealReply] = useState("");
  const base = `/api/communities/${slug}/moderation`, date = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  async function act(path: string, body: unknown, after?: () => void) {
    setBusy(true); setError("");
    const result = await request(path, { method: "POST", body });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    after?.(); router.refresh();
  }
  const current = queue.find((q) => q.reportId === reviewing) ?? null, currentAppeal = appeals.find((x) => x.id === appealId) ?? null, openAppeals = appeals.filter((x) => x.status === "open").length;
  const itemLabel = (i: { targetType: string; title: string; excerpt: string }) => i.targetType === "comment" ? i.excerpt : i.title;
  const postHref = (postId: string | null) => postId ? `/communities/${slug}/posts/${postId}` : null;
  const visibleMembers = members.filter((m) => m.name.toLowerCase().includes(search.trim().toLowerCase()));

  const emptyState = (key: string, icon: LucideIcon) => <EmptyState icon={icon} size="compact" title={t(key as "emptyReports")} />;
  const actionsHeader = { header: t("actions"), srOnlyHeader: true, align: "end", card: "actions" } as const;

  // Reports: type tabs (the queue is already one list per report; tabs only narrow it).
  const reportTypes = ["post", "comment", "member"] as const, [reportType, setReportType] = useState("all");
  const reportTabs = [{ value: "all", label: ks("all"), count: queue.length }, ...reportTypes.filter((type) => queue.some((q) => q.targetType === type))
    .map((type) => ({ value: type, label: ks(`types.${type}` as "types.post"), count: queue.filter((q) => q.targetType === type).length }))];
  const reportColumns: DataTableColumn[] = [{ id: "item", header: t("item"), card: "title", className: "max-w-72" }, { id: "type", header: t("type") }, { id: "reasons", header: t("reasons") },
    { id: "reports", header: t("reports"), align: "end" }, { id: "first", header: t("firstReported") }, { id: "actions", ...actionsHeader }];
  const reportRows: DataTableRow[] = queue.filter((q) => reportType === "all" || q.targetType === reportType).map((q) => ({ id: q.reportId, label: itemLabel(q) || t("unavailable"), cells: {
    item: <span className="line-clamp-2 break-words">{itemLabel(q) || t("unavailable")}</span>,
    type: <Badge variant="outline">{t(`targets.${q.targetType}`)}</Badge>,
    reasons: <div className="flex flex-wrap gap-1">{q.reasons.map((r) => <Badge key={r} variant="secondary">{t(`reasonLabels.${r}`)}</Badge>)}</div>,
    reports: <span className="tabular-nums">{q.reports}</span>, first: <span className="whitespace-nowrap">{date(q.firstReportedAt)}</span>,
    actions: <Button variant="outline" className="min-h-11" onClick={() => setReviewing(q.reportId)} aria-label={t("reviewNamed", { name: itemLabel(q) || t(`targets.${q.targetType}`) })}>{t("review")}</Button>,
  } }));

  const heldColumns: DataTableColumn[] = [{ id: "item", header: t("item"), card: "title", className: "max-w-72" }, { id: "author", header: t("author") }, { id: "why", header: t("why") },
    { id: "date", header: t("date") }, { id: "actions", ...actionsHeader }];
  const heldRows: DataTableRow[] = held.map((h) => { const label = itemLabel(h), href = postHref(h.postId); return { id: h.id, label, cells: {
    item: <div className="space-y-1"><Badge variant="outline">{t(`targets.${h.targetType}`)}</Badge>
      {href ? <Link href={href} prefetch={false} className="line-clamp-2 block break-words hover:underline">{label}</Link> : <span className="line-clamp-2 break-words">{label}</span>}</div>,
    author: h.authorName?.trim() || t("unnamed"), why: <Badge variant="secondary">{t(`heldReasons.${h.reason}`)}</Badge>, date: <span className="whitespace-nowrap">{date(h.heldAt)}</span>,
    actions: <div className="flex justify-end gap-2">
      <Button className="min-h-11" disabled={busy} aria-label={t("approveNamed", { name: label })} onClick={() => void act(`${base}/held`, { targetType: h.targetType, id: h.id, decision: "approve" })}>{t("approve")}</Button>
      <Button variant="outline" className="min-h-11" disabled={busy} aria-label={t("rejectNamed", { name: label })} onClick={() => void act(`${base}/held`, { targetType: h.targetType, id: h.id, decision: "reject" })}>{t("reject")}</Button></div>,
  } }; });

  const memberColumns: DataTableColumn[] = [{ id: "name", header: t("name"), card: "title" }, { id: "role", header: t("role") }, { id: "status", header: t("status") },
    { id: "warnings", header: t("warnings"), align: "end" }, { id: "actions", ...actionsHeader }];
  const memberRows: DataTableRow[] = visibleMembers.map((m) => { const name = m.name.trim() || t("unnamed"), allowed = canActOn(role, m.role, m.userId === me);
    const canUnban = m.status === "banned" && communityRank(role) >= 2 && m.userId !== me; return { id: m.userId, label: name, cells: {
    name: <span className="flex min-w-0 items-center gap-3"><Avatar><AvatarFallback aria-hidden="true">{memberInitials(m.name)}</AvatarFallback></Avatar><span className="min-w-0 break-words font-medium">{name}</span></span>,
    role: t(`roles.${m.role}` as "roles.member"),
    status: m.status === "banned" ? <Badge variant="destructive">{t("banned")}</Badge>
      : m.mutedUntil ? <Badge variant="secondary" className="h-auto whitespace-normal">{t("mutedUntil", { date: format.dateTime(new Date(m.mutedUntil), { dateStyle: "medium", timeStyle: "short" }) })}</Badge>
      : <Badge variant="outline">{t("active")}</Badge>,
    warnings: <span className="tabular-nums">{m.warnings}</span>,
    actions: (allowed || canUnban) ? <DropdownMenu><DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" className="size-11" disabled={busy} aria-label={t("actionsFor", { name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {m.status === "active" && allowed && <>
          <DropdownMenuItem className="min-h-11" onSelect={() => { setWarning(m); setWarnReason(""); }}>{t("warn")}</DropdownMenuItem>
          {muteDays.map((days) => <DropdownMenuItem key={days} className="min-h-11" onSelect={() => void act(`${base}/members`, { userId: m.userId, action: "mute", days })}>{t("mute", { days })}</DropdownMenuItem>)}
          {m.mutedUntil && <DropdownMenuItem className="min-h-11" onSelect={() => void act(`${base}/members`, { userId: m.userId, action: "unmute" })}>{t("unmute")}</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => setBanning(m)}>{t("ban")}</DropdownMenuItem></>}
        {canUnban && <DropdownMenuItem className="min-h-11" onSelect={() => void act(`${base}/members`, { userId: m.userId, action: "unban" })}>{t("unban")}</DropdownMenuItem>}
      </DropdownMenuContent></DropdownMenu> : null,
  } }; });

  const [appealFilter, setAppealFilter] = useState("all");
  const appealTabs = [{ value: "all", label: ks("all"), count: appeals.length }, { value: "open", label: t("appealStatus.open"), count: openAppeals }, { value: "closed", label: ks("resolved"), count: appeals.length - openAppeals }];
  const appealColumns: DataTableColumn[] = [{ id: "name", header: t("name"), card: "title" }, { id: "message", header: t("appealMessage"), className: "max-w-72" }, { id: "status", header: t("status") },
    { id: "date", header: t("date") }, { id: "actions", ...actionsHeader }];
  const appealRows: DataTableRow[] = appeals.filter((x) => appealFilter === "all" || (appealFilter === "open") === (x.status === "open")).map((x) => { const name = x.name?.trim() || t("unnamed"); return { id: x.id, label: name, cells: {
    name: <span className="font-medium">{name}</span>, message: <span className="line-clamp-2 break-words">{x.message}</span>,
    status: <Badge variant={x.status === "open" ? "secondary" : "outline"}>{t(`appealStatus.${x.status}`)}</Badge>, date: <span className="whitespace-nowrap">{date(x.createdAt)}</span>,
    actions: <Button variant={x.status === "open" ? "default" : "outline"} className="min-h-11" aria-label={t("reviewNamed", { name })} onClick={() => { setAppealId(x.id); setAppealReply(""); }}>{t("review")}</Button>,
  } }; });

  const historyColumns: DataTableColumn[] = [{ id: "date", header: t("date"), className: "whitespace-normal" }, { id: "host", header: t("host"), className: "whitespace-normal" },
    { id: "action", header: t("action"), card: "title", className: "whitespace-normal" }, { id: "subject", header: t("subject"), className: "whitespace-normal" }];
  const historyRows: DataTableRow[] = history.map((h) => ({ id: h.id, label: t(`history.${h.action}` as "history.ban", { days: Number(h.detail.days ?? 0) }), cells: {
    date: format.dateTime(new Date(h.createdAt), { dateStyle: "medium", timeStyle: "short" }), host: h.actorName?.trim() || t("unnamed"),
    action: t(`history.${h.action}` as "history.ban", { days: Number(h.detail.days ?? 0) }),
    subject: t("subjectWithType", { name: h.subjectName?.trim() || t("unnamed"), type: t(`targets.${h.targetType}` as "targets.post") }),
  } }));

  return <div className="min-w-0 space-y-4 p-4 lg:p-6">
    <h2 className="text-xl font-semibold">{t("title")}</h2>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="h-auto flex-wrap">
        <TabsTrigger value="reports" className="min-h-11">{t("tabs.reports")}{queue.length > 0 && <Badge variant="secondary" className="ml-1">{queue.length}</Badge>}</TabsTrigger>
        <TabsTrigger value="held" className="min-h-11">{t("tabs.held")}{held.length > 0 && <Badge variant="secondary" className="ml-1">{held.length}</Badge>}</TabsTrigger>
        <TabsTrigger value="members" className="min-h-11">{t("tabs.members")}</TabsTrigger>
        <TabsTrigger value="appeals" className="min-h-11">{t("tabs.appeals")}{openAppeals > 0 && <Badge variant="secondary" className="ml-1">{openAppeals}</Badge>}</TabsTrigger>
        <TabsTrigger value="history" className="min-h-11">{t("tabs.history")}</TabsTrigger>
      </TabsList>

      <TabsContent value="reports" className="mt-4"><DataTable label={t("tabs.reports")} columns={reportColumns} rows={reportRows}
        tabs={queue.length > 0 ? { label: ks("reportTypes"), value: reportType, onValueChange: setReportType, items: reportTabs } : undefined}
        empty={emptyState("emptyReports", Flag)} /></TabsContent>

      <TabsContent value="held" className="mt-4"><DataTable label={t("tabs.held")} columns={heldColumns} rows={heldRows} empty={emptyState("emptyHeld", Hourglass)} /></TabsContent>

      <TabsContent value="members" className="mt-4"><DataTable label={t("tabs.members")} columns={memberColumns} rows={memberRows} empty={emptyState("emptyMembers", Users)}
        toolbar={{ search: <InputGroup className="min-h-11 lg:min-h-9"><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput id="moderation-search" type="search" aria-label={t("search")} placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} /></InputGroup> }} /></TabsContent>

      <TabsContent value="appeals" className="mt-4"><DataTable label={t("tabs.appeals")} columns={appealColumns} rows={appealRows} empty={emptyState("emptyAppeals", Scale)}
        tabs={appeals.length > 0 ? { label: ks("appealStates"), value: appealFilter, onValueChange: setAppealFilter, items: appealTabs } : undefined} /></TabsContent>

      <TabsContent value="history" className="mt-4"><DataTable label={t("tabs.history")} columns={historyColumns} rows={historyRows} empty={emptyState("emptyHistory", History)} /></TabsContent>
    </Tabs>

    <Sheet open={current !== null} onOpenChange={(next) => { if (!next) setReviewing(null); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">{current && <>
        <SheetHeader><SheetTitle>{t("reviewTitle")}</SheetTitle></SheetHeader>
        <div className="space-y-4 px-4">
          <div className="space-y-1"><Badge variant="outline">{t(`targets.${current.targetType}`)}</Badge>
            {current.title && <p className="font-medium break-words">{current.title}</p>}
            {current.excerpt && <p className="text-sm whitespace-pre-line break-words text-muted-foreground">{current.excerpt}</p>}
            {current.targetType !== "member" && <p className="text-sm">{t("byAuthor", { name: current.authorName?.trim() || t("unnamed") })}</p>}
            {postHref(current.postId) && <Link href={postHref(current.postId)!} prefetch={false} className="inline-flex min-h-11 items-center text-sm underline">{t("openItem")}</Link>}
            {(current.targetType === "post" || current.targetType === "comment") && <div><EditHistory slug={slug} targetType={current.targetType} targetId={current.targetId} name={itemLabel(current) || t(`targets.${current.targetType}`)} /></div>}</div>
          <div className="space-y-2"><h3 className="text-sm font-medium">{t("reportsCount", { count: current.reports })}</h3>
            <div className="flex flex-wrap gap-1">{current.reasons.map((r) => <Badge key={r} variant="secondary">{t(`reasonLabels.${r}`)}</Badge>)}</div>
            {current.notes.length > 0 && <ul className="space-y-2">{current.notes.map((note, i) => <li key={i} className="rounded-md border p-2 text-sm break-words">{note}</li>)}</ul>}</div>
        </div>
        <SheetFooter className="flex-row flex-wrap">
          {current.targetType === "member"
            ? <Button variant="outline" className="min-h-11" onClick={() => { setSearch(current.authorName ?? ""); setTab("members"); setReviewing(null); }}>{t("manageMember")}</Button>
            : <Button variant="destructive" className="min-h-11" disabled={busy || current.removed} onClick={() => void act(`${base}/reports/${current.reportId}`, { decision: "remove" }, () => setReviewing(null))}>{t("remove")}</Button>}
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void act(`${base}/reports/${current.reportId}`, { decision: "keep" }, () => setReviewing(null))}>{t("keep")}</Button>
        </SheetFooter></>}
      </SheetContent>
    </Sheet>

    <Sheet open={currentAppeal !== null} onOpenChange={(next) => { if (!next) setAppealId(null); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">{currentAppeal && <>
        <SheetHeader><SheetTitle>{t("appealTitle")}</SheetTitle></SheetHeader>
        <div className="space-y-4 px-4">
          <div className="space-y-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium break-words">{currentAppeal.name?.trim() || t("unnamed")}</p>
            <Badge variant={currentAppeal.status === "open" ? "secondary" : "outline"}>{t(`appealStatus.${currentAppeal.status}`)}</Badge></div>
            <p className="text-sm text-muted-foreground">{date(currentAppeal.createdAt)}</p>
            <p className="text-sm whitespace-pre-line break-words">{currentAppeal.message}</p></div>
          {currentAppeal.status === "open"
            ? <div className="space-y-2"><Label htmlFor="appeal-reply">{t("appealReply")}</Label>
              <Textarea id="appeal-reply" rows={3} value={appealReply} maxLength={moderationLimits.appealReply} onChange={(e) => setAppealReply(e.target.value)} /></div>
            : currentAppeal.reply && <div className="space-y-1"><h3 className="text-sm font-medium">{t("appealReply")}</h3><p className="text-sm whitespace-pre-line break-words">{currentAppeal.reply}</p></div>}
        </div>
        {currentAppeal.status === "open" && <SheetFooter className="flex-row flex-wrap">
          {canDecideAppeal(role, "approve") && <Button className="min-h-11" disabled={busy}
            onClick={() => void act(`${base}/appeals`, { appealId: currentAppeal.id, decision: "approve", ...(appealReply.trim() ? { reply: appealReply.trim() } : {}) }, () => setAppealId(null))}>{t("approveAppeal")}</Button>}
          <Button variant="outline" className="min-h-11" disabled={busy}
            onClick={() => void act(`${base}/appeals`, { appealId: currentAppeal.id, decision: "decline", ...(appealReply.trim() ? { reply: appealReply.trim() } : {}) }, () => setAppealId(null))}>{t("declineAppeal")}</Button>
        </SheetFooter>}</>}
      </SheetContent>
    </Sheet>

    <Dialog open={warning !== null} onOpenChange={(next) => { if (!next) setWarning(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t("warnTitle", { name: warning?.name.trim() || t("unnamed") })}</DialogTitle></DialogHeader>
        <div className="space-y-2"><Label htmlFor="warn-reason">{t("warnReason")}</Label>
          <Textarea id="warn-reason" rows={4} value={warnReason} maxLength={moderationLimits.warning} onChange={(e) => setWarnReason(e.target.value)} /></div>
        <DialogFooter><Button className="min-h-11" disabled={busy || !warnReason.trim()}
          onClick={() => { const m = warning; if (m) void act(`${base}/warnings`, { userId: m.userId, reason: warnReason.trim() }, () => setWarning(null)); }}>{t("warnSend")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={banning !== null} onOpenChange={(next) => { if (!next) setBanning(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t("banTitle", { name: banning?.name.trim() || t("unnamed") })}</AlertDialogTitle></AlertDialogHeader>
        <p className="text-sm text-muted-foreground">{t("banConsequence")}</p>
        <AlertDialogFooter><AlertDialogCancel className="min-h-11">{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction className="min-h-11" onClick={() => { const m = banning; setBanning(null); if (m) void act(`${base}/members`, { userId: m.userId, action: "ban" }); }}>{t("ban")}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
