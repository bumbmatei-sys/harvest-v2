"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useRequest } from "@/hooks/use-request";
import { AccentIcon } from "@/components/accent-icon";
import { departmentMarks } from "@/components/campaigns/wizard-icons";
import { departmentKeys, invitationInput } from "@/lib/campaign-wizard";
import type { DraftView, InvitationView, WizardForm } from "@/lib/campaign-wizard-form";
import type { SetStep } from "@/components/campaigns/wizard-steps";

export type WizardPerson = { id: string; name: string; role: string };

/**
 * Step 4: who will organize the campaign. The person starting it is the Campaign Owner. Each department can be included or left out, and receives a
 * leader and team members by invitation: a ministry member picked from the list, or an email address (a member's email invites that member). Each person
 * shows as Pending, Accepted or Expired until they accept; nothing is added to a department before that. The invitations are their own requests.
 */
export function TeamsStep({ form, set, disabled, draft, people, endpoint, saveNow, onInvitations }: {
  form: WizardForm; set: SetStep; disabled: boolean; draft: DraftView; people: WizardPerson[]; endpoint: string; saveNow: () => Promise<boolean>; onInvitations: (list: InvitationView[]) => void;
}) {
  const t = useTranslations("CampaignWizard"), tt = useTranslations("CampaignWizard.teams"), format = useFormatter(), request = useRequest();
  const [inviting, setInviting] = useState<string | null>(null), [withdrawing, setWithdrawing] = useState<string | null>(null), [error, setError] = useState("");
  const owner = people.find((person) => person.id === draft.createdBy);
  const include = (department: string, on: boolean) => set("leaders", (current) => ({ ...current, leaders: { departments: on ? [...current.leaders.departments, department] : current.leaders.departments.filter((entry) => entry !== department) } }), 120);
  async function withdraw(invitation: InvitationView) {
    setWithdrawing(invitation.id); setError("");
    const result = await request<{ invitations: InvitationView[] }>(`${endpoint}/invitations/${invitation.id}/revoke`, { method: "POST", body: {} });
    setWithdrawing(null);
    if (result.ok) onInvitations(result.data.invitations); else setError(result.error);
  }
  return <div className="space-y-6">
    <div className="flex min-h-11 flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
      <span className="text-sm font-medium">{owner ? (owner.name) : tt("you")}</span><Badge variant="secondary">{tt("owner")}</Badge>
    </div>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {departmentKeys.map((department) => {
        const included = form.leaders.departments.includes(department), name = t(`departments.${department}`);
        const rows = draft.invitations.filter((invitation) => invitation.department === department && invitation.state !== "revoked");
        return <section key={department} aria-labelledby={`department-${department}`} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-3"><AccentIcon icon={departmentMarks[department].icon} accent={departmentMarks[department].accent} tone="neutral" size="sm" />
              <h3 id={`department-${department}`} className="text-sm font-semibold">{name}</h3></span>
            <Switch checked={included} disabled={disabled} aria-label={tt("include", { name })} onCheckedChange={(next) => include(department, next)} />
          </div>
          {included && <>
            {(["leader", "member"] as const).map((role) => {
              const list = rows.filter((row) => row.role === role);
              return <div key={role} className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{tt(role === "leader" ? "leader" : "members")}</p>
                {list.length ? <ul className="space-y-1.5">{list.map((row) => <li key={row.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-1.5">
                  <span className="min-w-0 break-words text-sm">{row.label}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant={row.state === "accepted" ? "secondary" : "outline"}>{tt(`state.${row.state}`)}</Badge>
                    {row.state === "pending" && <span className="text-xs text-muted-foreground">{tt("expires", { date: format.dateTime(new Date(row.expiresAt), { dateStyle: "medium", timeZone: "UTC" }) })}</span>}
                    {(row.state === "pending" || row.state === "expired") && <Button type="button" variant="outline" className="min-h-11" disabled={disabled || withdrawing === row.id} aria-label={tt("withdrawLabel", { name: row.label })} onClick={() => void withdraw(row)}>
                      <X aria-hidden="true" />{tt("withdraw")}</Button>}
                  </span></li>)}</ul> : <p className="text-sm text-muted-foreground">{tt("none")}</p>}
              </div>;
            })}
            <Button type="button" variant="outline" className="min-h-11 self-start" disabled={disabled} onClick={() => setInviting(department)}><Plus aria-hidden="true" />{tt("invite")}</Button>
          </>}
        </section>;
      })}
    </div>
    {inviting && <InviteDialog department={inviting} people={people} draft={draft} endpoint={endpoint} saveNow={saveNow} onClose={() => setInviting(null)} onInvitations={onInvitations} />}
  </div>;
}

function InviteDialog({ department, people, draft, endpoint, saveNow, onClose, onInvitations }: {
  department: string; people: WizardPerson[]; draft: DraftView; endpoint: string; saveNow: () => Promise<boolean>; onClose: () => void; onInvitations: (list: InvitationView[]) => void;
}) {
  const t = useTranslations("CampaignWizard"), tt = useTranslations("CampaignWizard.teams"), request = useRequest();
  const [role, setRole] = useState<"leader" | "member">("member"), [userId, setUserId] = useState(""), [email, setEmail] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  // Members who can be placed and are not already invited to or placed in this department.
  const taken = new Set(draft.invitations.filter((row) => row.department === department && (row.state === "pending" || row.state === "accepted") && row.userId).map((row) => row.userId));
  const eligible = people.filter((person) => ["owner", "admin", "member"].includes(person.role) && !taken.has(person.id));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (userId && email.trim()) { setError(tt("oneTarget")); return; }
    if (!userId && !email.trim()) { setError(tt("needTarget")); return; }
    const body = invitationInput.safeParse({ department, role, ...(userId ? { userId } : { email }) });
    if (!body.success) { setError(tt("invalidEmail")); return; }
    setBusy(true); setError("");
    // The department must be saved on the draft before it can receive an invitation.
    await saveNow();
    const result = await request<{ invitations: InvitationView[] }>(`${endpoint}/invitations`, { method: "POST", body: body.data });
    setBusy(false);
    if (!result.ok) { setError(result.status === 409 ? tt("exists") : result.status === 400 ? tt("invalidTarget") : result.error); return; }
    onInvitations(result.data.invitations); onClose();
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <DialogHeader><DialogTitle>{tt("inviteTo", { name: t(`departments.${department}`) })}</DialogTitle><DialogDescription>{tt("inviteDescription")}</DialogDescription></DialogHeader>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <Field><FieldLabel htmlFor="invite-role">{tt("role")}</FieldLabel>
          <NativeSelect id="invite-role" className="min-h-11" value={role} onChange={(event) => setRole(event.target.value as "leader" | "member")}>
            <option value="leader">{tt("roleLeader")}</option><option value="member">{tt("roleMember")}</option></NativeSelect></Field>
        <Field><FieldLabel htmlFor="invite-member">{tt("member")}</FieldLabel>
          <NativeSelect id="invite-member" className="min-h-11" value={userId} onChange={(event) => { setUserId(event.target.value); if (event.target.value) setEmail(""); }}>
            <option value="">{tt("pickMember")}</option>{eligible.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</NativeSelect></Field>
        <Field><FieldLabel htmlFor="invite-email">{tt("email")}</FieldLabel>
          <Input id="invite-email" type="email" className="min-h-11" autoComplete="off" value={email} maxLength={254} onChange={(event) => { setEmail(event.target.value); if (event.target.value) setUserId(""); }} /></Field>
        <p className="text-sm text-muted-foreground">{tt("recorded")}</p>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>{tt("cancel")}</Button>
          <Button type="submit" className="min-h-11" disabled={busy}>{busy ? <Spinner decorative size="sm" /> : null}{tt("send")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
