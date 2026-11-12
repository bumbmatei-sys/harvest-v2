"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { MoreHorizontal, Search } from "lucide-react";
import { useCrmRequest } from "@/components/crm/request";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canActOn, communityRank, muteDays } from "@/lib/moderation";
import type { HeldItem, HistoryEntry, ModerationMember, QueueItem } from "@/server/community-moderation";

type Props = { slug: string; me: string; role: string; queue: QueueItem[]; held: HeldItem[]; members: ModerationMember[]; history: HistoryEntry[] };

/** C12a: the hosts' moderation page. Studio Admin style: tabs, tables, a review sheet and row menus. */
export function ModerationPanel({ slug, me, role, queue, held, members, history }: Props) {
  const t = useTranslations("Moderation"), format = useFormatter(), request = useCrmRequest(), router = useRouter();
  const [tab, setTab] = useState("reports"), [reviewing, setReviewing] = useState<string | null>(null), [search, setSearch] = useState("");
  const [banning, setBanning] = useState<ModerationMember | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const base = `/api/communities/${slug}/moderation`, date = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  async function act(path: string, body: unknown, after?: () => void) {
    setBusy(true); setError("");
    const result = await request(path, { method: "POST", body });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    after?.(); router.refresh();
  }
  const current = queue.find((q) => q.reportId === reviewing) ?? null;
  const itemLabel = (i: { targetType: string; title: string; excerpt: string }) => i.targetType === "comment" ? i.excerpt : i.title;
  const postHref = (postId: string | null) => postId ? `/communities/${slug}/posts/${postId}` : null;
  const visibleMembers = members.filter((m) => m.name.toLowerCase().includes(search.trim().toLowerCase()));
  const empty = (key: string) => <Empty className="border"><EmptyHeader><EmptyTitle>{t(key as "emptyReports")}</EmptyTitle></EmptyHeader></Empty>;

  return <div className="min-w-0 space-y-4 p-4 lg:p-6">
    <h2 className="text-xl font-semibold">{t("title")}</h2>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="h-auto flex-wrap">
        <TabsTrigger value="reports" className="min-h-11">{t("tabs.reports")}{queue.length > 0 && <Badge variant="secondary" className="ml-1">{queue.length}</Badge>}</TabsTrigger>
        <TabsTrigger value="held" className="min-h-11">{t("tabs.held")}{held.length > 0 && <Badge variant="secondary" className="ml-1">{held.length}</Badge>}</TabsTrigger>
        <TabsTrigger value="members" className="min-h-11">{t("tabs.members")}</TabsTrigger>
        <TabsTrigger value="history" className="min-h-11">{t("tabs.history")}</TabsTrigger>
      </TabsList>

      <TabsContent value="reports" className="mt-4">{queue.length === 0 ? empty("emptyReports") : <div className="overflow-x-auto rounded-lg border">
        <Table aria-label={t("tabs.reports")}><TableHeader><TableRow><TableHead>{t("item")}</TableHead><TableHead>{t("type")}</TableHead><TableHead>{t("reasons")}</TableHead>
          <TableHead className="text-right">{t("reports")}</TableHead><TableHead>{t("firstReported")}</TableHead><TableHead><span className="sr-only">{t("actions")}</span></TableHead></TableRow></TableHeader>
          <TableBody>{queue.map((q) => <TableRow key={q.reportId}>
            <TableCell className="max-w-72"><span className="line-clamp-2 break-words">{itemLabel(q) || t("unavailable")}</span></TableCell>
            <TableCell><Badge variant="outline">{t(`targets.${q.targetType}`)}</Badge></TableCell>
            <TableCell><div className="flex flex-wrap gap-1">{q.reasons.map((r) => <Badge key={r} variant="secondary">{t(`reasonLabels.${r}`)}</Badge>)}</div></TableCell>
            <TableCell className="text-right tabular-nums">{q.reports}</TableCell>
            <TableCell className="whitespace-nowrap">{date(q.firstReportedAt)}</TableCell>
            <TableCell className="text-right"><Button variant="outline" className="min-h-11" onClick={() => setReviewing(q.reportId)}
              aria-label={t("reviewNamed", { name: itemLabel(q) || t(`targets.${q.targetType}`) })}>{t("review")}</Button></TableCell>
          </TableRow>)}</TableBody></Table></div>}</TabsContent>

      <TabsContent value="held" className="mt-4">{held.length === 0 ? empty("emptyHeld") : <div className="overflow-x-auto rounded-lg border">
        <Table aria-label={t("tabs.held")}><TableHeader><TableRow><TableHead>{t("item")}</TableHead><TableHead>{t("author")}</TableHead><TableHead>{t("why")}</TableHead>
          <TableHead>{t("date")}</TableHead><TableHead><span className="sr-only">{t("actions")}</span></TableHead></TableRow></TableHeader>
          <TableBody>{held.map((h) => { const label = itemLabel(h), href = postHref(h.postId); return <TableRow key={h.id}>
            <TableCell className="max-w-72"><div className="space-y-1"><Badge variant="outline">{t(`targets.${h.targetType}`)}</Badge>
              {href ? <Link href={href} prefetch={false} className="line-clamp-2 block break-words hover:underline">{label}</Link> : <span className="line-clamp-2 break-words">{label}</span>}</div></TableCell>
            <TableCell>{h.authorName?.trim() || t("unnamed")}</TableCell>
            <TableCell><Badge variant="secondary">{t(`heldReasons.${h.reason}`)}</Badge></TableCell>
            <TableCell className="whitespace-nowrap">{date(h.heldAt)}</TableCell>
            <TableCell><div className="flex justify-end gap-2">
              <Button className="min-h-11" disabled={busy} aria-label={t("approveNamed", { name: label })} onClick={() => void act(`${base}/held`, { targetType: h.targetType, id: h.id, decision: "approve" })}>{t("approve")}</Button>
              <Button variant="outline" className="min-h-11" disabled={busy} aria-label={t("rejectNamed", { name: label })} onClick={() => void act(`${base}/held`, { targetType: h.targetType, id: h.id, decision: "reject" })}>{t("reject")}</Button>
            </div></TableCell></TableRow>; })}</TableBody></Table></div>}</TabsContent>

      <TabsContent value="members" className="mt-4 space-y-3">
        <div className="relative max-w-sm"><Label htmlFor="moderation-search" className="sr-only">{t("search")}</Label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="moderation-search" type="search" className="min-h-11 pl-9" placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {visibleMembers.length === 0 ? empty("emptyMembers") : <div className="overflow-x-auto rounded-lg border">
          <Table aria-label={t("tabs.members")}><TableHeader><TableRow><TableHead>{t("name")}</TableHead><TableHead>{t("role")}</TableHead><TableHead>{t("status")}</TableHead>
            <TableHead><span className="sr-only">{t("actions")}</span></TableHead></TableRow></TableHeader>
            <TableBody>{visibleMembers.map((m) => { const name = m.name.trim() || t("unnamed"), allowed = canActOn(role, m.role, m.userId === me);
              const canUnban = m.status === "banned" && communityRank(role) >= 2 && m.userId !== me; return <TableRow key={m.userId}>
              <TableCell className="font-medium">{name}</TableCell>
              <TableCell>{t(`roles.${m.role}` as "roles.member")}</TableCell>
              <TableCell>{m.status === "banned" ? <Badge variant="destructive">{t("banned")}</Badge>
                : m.mutedUntil ? <Badge variant="secondary" className="h-auto whitespace-normal">{t("mutedUntil", { date: format.dateTime(new Date(m.mutedUntil), { dateStyle: "medium", timeStyle: "short" }) })}</Badge>
                : <Badge variant="outline">{t("active")}</Badge>}</TableCell>
              <TableCell className="text-right">{(allowed || canUnban) && <DropdownMenu><DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-11" disabled={busy} aria-label={t("actionsFor", { name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {m.status === "active" && allowed && <>
                    {muteDays.map((days) => <DropdownMenuItem key={days} className="min-h-11" onSelect={() => void act(`${base}/members`, { userId: m.userId, action: "mute", days })}>{t("mute", { days })}</DropdownMenuItem>)}
                    {m.mutedUntil && <DropdownMenuItem className="min-h-11" onSelect={() => void act(`${base}/members`, { userId: m.userId, action: "unmute" })}>{t("unmute")}</DropdownMenuItem>}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => setBanning(m)}>{t("ban")}</DropdownMenuItem></>}
                  {canUnban && <DropdownMenuItem className="min-h-11" onSelect={() => void act(`${base}/members`, { userId: m.userId, action: "unban" })}>{t("unban")}</DropdownMenuItem>}
                </DropdownMenuContent></DropdownMenu>}</TableCell>
            </TableRow>; })}</TableBody></Table></div>}
      </TabsContent>

      <TabsContent value="history" className="mt-4">{history.length === 0 ? empty("emptyHistory") : <div className="overflow-x-auto rounded-lg border">
        <Table aria-label={t("tabs.history")}><TableHeader><TableRow><TableHead className="whitespace-normal">{t("date")}</TableHead><TableHead className="whitespace-normal">{t("host")}</TableHead><TableHead className="whitespace-normal">{t("action")}</TableHead><TableHead className="whitespace-normal">{t("subject")}</TableHead></TableRow></TableHeader>
          <TableBody>{history.map((h) => <TableRow key={h.id}>
            <TableCell className="whitespace-normal">{format.dateTime(new Date(h.createdAt), { dateStyle: "medium", timeStyle: "short" })}</TableCell>
            <TableCell className="whitespace-normal">{h.actorName?.trim() || t("unnamed")}</TableCell>
            <TableCell className="whitespace-normal">{t(`history.${h.action}` as "history.ban", { days: Number(h.detail.days ?? 0) })}</TableCell>
            <TableCell className="whitespace-normal">{t("subjectWithType", { name: h.subjectName?.trim() || t("unnamed"), type: t(`targets.${h.targetType}` as "targets.post") })}</TableCell>
          </TableRow>)}</TableBody></Table></div>}</TabsContent>
    </Tabs>

    <Sheet open={current !== null} onOpenChange={(next) => { if (!next) setReviewing(null); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">{current && <>
        <SheetHeader><SheetTitle>{t("reviewTitle")}</SheetTitle></SheetHeader>
        <div className="space-y-4 px-4">
          <div className="space-y-1"><Badge variant="outline">{t(`targets.${current.targetType}`)}</Badge>
            {current.title && <p className="font-medium break-words">{current.title}</p>}
            {current.excerpt && <p className="text-sm whitespace-pre-line break-words text-muted-foreground">{current.excerpt}</p>}
            {current.targetType !== "member" && <p className="text-sm">{t("byAuthor", { name: current.authorName?.trim() || t("unnamed") })}</p>}
            {postHref(current.postId) && <Link href={postHref(current.postId)!} prefetch={false} className="inline-flex min-h-11 items-center text-sm underline">{t("openItem")}</Link>}</div>
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
