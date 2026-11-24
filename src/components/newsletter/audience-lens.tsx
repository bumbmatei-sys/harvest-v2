"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useRequest } from "@/hooks/use-request";
import { cn } from "@/lib/utils";

export type AudienceCounts = Record<"all" | "subscribed" | "not_on_list" | "unsubscribed" | "never" | "suppressed", number>;
export type AudienceListItem = { id: string; name: string; version: number; subscribed: number };
export type AudienceGroupItem = { id: string; name: string; version: number };
const statusKeys = ["all", "subscribed", "not_on_list", "unsubscribed", "never", "suppressed"] as const;

const pill = "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border px-3 text-sm transition-colors lg:min-h-8";
const active = "border-primary bg-primary/10 font-medium", idle = "bg-card hover:bg-muted";

/** The newsletter lens: status strip with exact counts, then lists and saved groups. Everything links to a route, so the list state below keeps its own filters. */
export function AudienceLens({ tenantId, counts, lists, groups, current, canManage }: {
  tenantId: string; counts: AudienceCounts; lists: AudienceListItem[]; groups: AudienceGroupItem[]; current: string; canManage: boolean;
}) {
  const t = useTranslations("NewsletterAudience");
  const router = useRouter(), request = useRequest();
  const base = `/workspaces/${tenantId}/newsletter/audience`, api = `/api/workspaces/${tenantId}/newsletter/audience`;
  type Target = { kind: "lists" | "groups"; id: string; name: string; version: number };
  const [dialog, setDialog] = useState<Target | null>(null);
  const [name, setName] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [removing, setRemoving] = useState<Target | null>(null);
  function open(next: Target) { setDialog(next); setName(next.name); setError(""); }
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    setBusy(true); setError("");
    const result = await request<{ id: string }>(`${api}/${dialog.kind}/${dialog.id}`, { method: "PATCH", body: { name, version: dialog.version } });
    setBusy(false);
    if (!result.ok) { setError(result.status === 409 ? t(result.details?.code === "GROUP_STALE" ? "groupStale" : "nameTakenOrChanged") : result.error); return; }
    setDialog(null);
    router.refresh();
  }
  async function remove(target: Target) {
    const result = await request(`${api}/${target.kind}/${target.id}`, { method: "DELETE", body: { version: target.version } });
    if (!result.ok) throw new Error(result.status === 409 ? t(result.details?.code === "GROUP_STALE" ? "groupStale" : target.kind === "lists" ? "listInUse" : "groupInUse") : result.error);
    setRemoving(null);
    router.push(current === `${target.kind === "lists" ? "list" : "group"}:${target.id}` ? base : `${base}${current === "all" ? "" : "/" + current}`);
    router.refresh();
  }
  return <section aria-label={t("lens")} className="space-y-3">
    <nav aria-label={t("statusNav")} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {statusKeys.map((key) => <Link key={key} href={key === "all" ? base : `${base}/${key}`} aria-current={current === key ? "page" : undefined} className={cn(pill, current === key ? active : idle)}>
        {t(`status.${key}`)}<Badge variant="secondary" className="rounded-md tabular-nums">{counts[key].toLocaleString()}</Badge></Link>)}
    </nav>
    {(lists.length > 0 || groups.length > 0) && <div className="flex flex-wrap items-center gap-2">
      <ul aria-label={t("lists")} className="contents">
        {lists.map((list) => <li key={list.id} className="flex items-center">
          <Link href={`${base}/list/${list.id}`} aria-current={current === `list:${list.id}` ? "page" : undefined} className={cn(pill, canManage && "rounded-r-none border-r-0", current === `list:${list.id}` ? active : idle)}>
            <span className="max-w-48 truncate">{list.name}</span><Badge variant="secondary" className="rounded-md tabular-nums">{list.subscribed.toLocaleString()}</Badge></Link>
          {canManage && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label={t("listActions", { name: list.name })} className="size-11 rounded-l-none lg:size-8"><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => open({ kind: "lists", id: list.id, name: list.name, version: list.version })}><Pencil aria-hidden="true" />{t("rename")}</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setRemoving({ kind: "lists", id: list.id, name: list.name, version: list.version })}><Trash2 aria-hidden="true" />{t("delete")}</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu>}
        </li>)}
      </ul>
      <ul aria-label={t("groups")} className="contents">
        {groups.map((group) => <li key={group.id} className="flex items-center">
          <Link href={`${base}/group/${group.id}`} aria-current={current === `group:${group.id}` ? "page" : undefined} className={cn(pill, canManage && "rounded-r-none border-r-0", current === `group:${group.id}` ? active : idle)}><span className="max-w-48 truncate">{group.name}</span></Link>
          {canManage && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label={t("listActions", { name: group.name })} className="size-11 rounded-l-none lg:size-8"><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => open({ kind: "groups", id: group.id, name: group.name, version: group.version })}><Pencil aria-hidden="true" />{t("rename")}</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setRemoving({ kind: "groups", id: group.id, name: group.name, version: group.version })}><Trash2 aria-hidden="true" />{t("delete")}</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu>}
        </li>)}
      </ul>
    </div>}
    <Dialog open={dialog !== null} onOpenChange={(value) => { if (!value && !busy) setDialog(null); }}>
      <DialogContent><form onSubmit={save} className="space-y-4">
        <DialogHeader><DialogTitle>{dialog?.kind === "groups" ? t("renameGroup") : t("renameList")}</DialogTitle></DialogHeader>
        <Field><FieldLabel htmlFor="audience-list-name">{dialog?.kind === "groups" ? t("groupName") : t("listName")}</FieldLabel><Input id="audience-list-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={dialog?.kind === "groups" ? 60 : 100} required autoFocus className="h-11 lg:h-9" /></Field>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)} className="min-h-11 lg:min-h-9">{t("cancel")}</Button><Button type="submit" disabled={busy || !name.trim()} className="min-h-11 lg:min-h-9">{t("save")}</Button></DialogFooter>
      </form></DialogContent>
    </Dialog>
    {removing && <ConfirmDialog open onOpenChange={(value) => { if (!value) setRemoving(null); }} title={t("deleteTitle", { name: removing.name })} description={removing.kind === "groups" ? t("deleteGroupBody") : t("deleteBody")}
      confirmLabel={t("delete")} cancelLabel={t("cancel")} onConfirm={async () => { try { await remove(removing); return undefined; } catch (error) { return error instanceof Error ? error.message : undefined; } }} />}
  </section>;
}
