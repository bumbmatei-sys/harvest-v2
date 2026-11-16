"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useRequest } from "@/hooks/use-request";
import type { FollowUpCaseState } from "@/lib/follow-up-cases";
import { consequentialMoves, type CaseActions } from "@/lib/follow-up-ui";
import { notify } from "@/lib/toast";

const reasons = ["stale", "illegal_transition", "consent_not_in_effect", "assignee_not_eligible"] as const;

/**
 * The controls the viewer's role may use on one case. The page passes `actions` already filtered by role and state (see caseActions);
 * the server still refuses anything else with the same 403. Each request carries the case version, so a case someone else changed in
 * the meantime is refused and the page asks the person to reload.
 */
export function FollowUpCaseActions({ tenantId, caseId, version, assigneeId, currentUserId, members, actions }: {
  tenantId: string; caseId: string; version: number; assigneeId: string | null; currentUserId: string; members: { id: string; name: string }[]; actions: CaseActions;
}) {
  const t = useTranslations("FollowUp");
  const request = useRequest(), router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [pick, setPick] = useState("");
  const endpoint = `/api/workspaces/${tenantId}/followup-cases/${caseId}`;
  async function send(body: Record<string, unknown>, done: string): Promise<string | void> {
    setBusy(true); setError("");
    const result = await request<unknown>(endpoint, { method: "PATCH", body: { ...body, version } });
    setBusy(false);
    if (!result.ok) {
      const reason = typeof result.details?.reason === "string" ? result.details.reason : "";
      const text = (reasons as readonly string[]).includes(reason) ? t(`errors.${reason}`) : result.error;
      setError(text); return text;
    }
    notify.success(done);
    router.refresh();
  }
  const assignable = members.filter((member) => member.id !== assigneeId);
  if (!actions.assign && !actions.unassign && actions.moves.length === 0) return null;
  const guard = busy ? { "aria-disabled": true as const } : {};
  return <div className="space-y-4">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {actions.assign && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); if (pick && !busy) void send({ assigneeId: pick }, t("assignedDone")); }}>
      <Field className="gap-2"><FieldLabel htmlFor="follow-up-assignee">{assigneeId ? t("reassignTo") : t("assignTo")}</FieldLabel>
        <NativeSelect id="follow-up-assignee" className="min-h-11 w-full lg:min-h-9" value={pick} onChange={(event) => setPick(event.target.value)}>
          <NativeSelectOption value="">{t("chooseMember")}</NativeSelectOption>
          {assignable.map((member) => <NativeSelectOption key={member.id} value={member.id}>{member.id === currentUserId ? t("youNamed", { name: member.name }) : member.name}</NativeSelectOption>)}
        </NativeSelect></Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="responsive" disabled={!pick} {...guard}>{assigneeId ? t("reassign") : t("assign")}</Button>
        {actions.unassign && <Button type="button" variant="outline" size="responsive" {...guard} onClick={() => { if (!busy) void send({ assigneeId: null }, t("unassignedDone")); }}>{t("unassign")}</Button>}
      </div>
    </form>}
    {!actions.assign && actions.unassign && <Button type="button" variant="outline" size="responsive" {...guard} onClick={() => { if (!busy) void send({ assigneeId: null }, t("unassignedDone")); }}>{t("unassign")}</Button>}
    {actions.moves.length > 0 && <div role="group" aria-label={t("moveLabel")} className="flex flex-wrap gap-2">
      {actions.moves.map((to) => consequentialMoves.includes(to as FollowUpCaseState)
        ? <ConfirmDialog key={to} tone={to === "withdrawn" ? "destructive" : "neutral"} title={t(`confirm.${to}.title`)} description={t(`confirm.${to}.description`)}
          confirmLabel={t(`moves.${to}`)} cancelLabel={t("cancel")} onConfirm={() => send({ to }, t("updated"))}
          trigger={<Button type="button" variant="outline" size="responsive" className={to === "withdrawn" ? "text-destructive" : undefined}>{t(`moves.${to}`)}</Button>} />
        : <Button key={to} type="button" variant={to === "attempted" || to === "connected" ? "default" : "outline"} size="responsive" {...guard} onClick={() => { if (!busy) void send({ to }, t("updated")); }}>{t(`moves.${to}`)}</Button>)}
    </div>}
  </div>;
}
