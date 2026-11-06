"use client";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { taskQueryParams, taskSorts, type TaskQuery } from "@/lib/crm-tasks";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/** URL-backed task filters. Every change resets to page 1. */
export function TaskToolbar({ query, members, currentUserId }: { query: TaskQuery; members: { id: string; name: string }[]; currentUserId: string }) {
  const t = useTranslations("Tasks");
  const router = useRouter(), pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(query.q), [seen, setSeen] = useState(query.q);
  if (query.q !== seen) { setSeen(query.q); setText(query.q); }
  function navigate(next: Partial<TaskQuery>) {
    const value = taskQueryParams({ ...query, page: 1, ...next }).toString();
    startTransition(() => router.push(value ? `${pathname}?${value}` : pathname));
  }
  const filtered = query.assignee !== "me" || query.status !== "open" || !!query.due || !!query.related || !!query.q;
  const [sortKey, descending] = [query.sort.replace(/^-/, ""), query.sort.startsWith("-")];
  return <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
    <form role="search" className="min-w-0 flex-1 basis-52" onSubmit={(event) => { event.preventDefault(); navigate({ q: text.trim() }); }}>
      <InputGroup className="h-9 border-transparent bg-muted">
        <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
        <InputGroupInput type="search" aria-label={t("searchTasks")} placeholder={t("searchTasksPlaceholder")} value={text} maxLength={100} onChange={(event) => setText(event.target.value)} />
        {text && <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label={t("clearSearch")} onClick={() => { setText(""); navigate({ q: "" }); }}><X aria-hidden="true" /></InputGroupButton></InputGroupAddon>}
      </InputGroup>
    </form>
    <NativeSelect aria-label={t("filterAssignee")} value={query.assignee === currentUserId ? "me" : query.assignee} onChange={(event) => navigate({ assignee: event.target.value })} className="h-9 w-40">
      <NativeSelectOption value="me">{t("assignedToMe")}</NativeSelectOption><NativeSelectOption value="any">{t("anyone")}</NativeSelectOption><NativeSelectOption value="none">{t("unassigned")}</NativeSelectOption>
      {members.filter((member) => member.id !== currentUserId).map((member) => <NativeSelectOption key={member.id} value={member.id}>{member.name}</NativeSelectOption>)}
    </NativeSelect>
    <NativeSelect aria-label={t("filterStatus")} value={query.status} onChange={(event) => navigate({ status: event.target.value as TaskQuery["status"] })} className="h-9 w-32">
      <NativeSelectOption value="open">{t("statuses.open")}</NativeSelectOption><NativeSelectOption value="done">{t("statuses.done")}</NativeSelectOption><NativeSelectOption value="all">{t("statuses.all")}</NativeSelectOption>
    </NativeSelect>
    <NativeSelect aria-label={t("filterDue")} value={query.due} onChange={(event) => navigate({ due: event.target.value as TaskQuery["due"] })} className="h-9 w-36">
      <NativeSelectOption value="">{t("dueFilters.any")}</NativeSelectOption><NativeSelectOption value="overdue">{t("dueFilters.overdue")}</NativeSelectOption>
      <NativeSelectOption value="today">{t("dueFilters.today")}</NativeSelectOption><NativeSelectOption value="upcoming">{t("dueFilters.upcoming")}</NativeSelectOption><NativeSelectOption value="none">{t("dueFilters.none")}</NativeSelectOption>
    </NativeSelect>
    <NativeSelect aria-label={t("filterRelated")} value={query.related} onChange={(event) => navigate({ related: event.target.value as TaskQuery["related"] })} className="h-9 w-40">
      <NativeSelectOption value="">{t("relatedFilters.any")}</NativeSelectOption><NativeSelectOption value="person">{t("relatedFilters.person")}</NativeSelectOption>
      <NativeSelectOption value="company">{t("relatedFilters.company")}</NativeSelectOption><NativeSelectOption value="deal">{t("relatedFilters.deal")}</NativeSelectOption><NativeSelectOption value="none">{t("relatedFilters.none")}</NativeSelectOption>
    </NativeSelect>
    <NativeSelect aria-label={t("sortTasks")} value={`${sortKey}:${descending ? "desc" : "asc"}`} onChange={(event) => { const [key, direction] = event.target.value.split(":"); navigate({ sort: direction === "desc" ? `-${key}` : key }); }} className="h-9 w-48">
      {taskSorts.flatMap((key) => (["asc", "desc"] as const).map((direction) => <NativeSelectOption key={`${key}:${direction}`} value={`${key}:${direction}`}>{t(`sorts.${key}.${direction}`)}</NativeSelectOption>))}
    </NativeSelect>
    {filtered && <Button size="sm" variant="ghost" className="h-9 text-muted-foreground" onClick={() => { setText(""); navigate({ assignee: "me", status: "open", due: "", related: "", q: "" }); }}>{t("resetFilters")}</Button>}
  </div>;
}
