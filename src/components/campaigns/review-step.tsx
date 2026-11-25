"use client";
import { CircleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { departmentKeys, moduleKeys, type WizardStep } from "@/lib/campaign-wizard";
import type { DraftView, WizardForm } from "@/lib/campaign-wizard-form";
import type { Issue } from "@/lib/campaign-wizard";
import type { WizardPerson } from "@/components/campaigns/teams-step";

/**
 * Step 8: a summary of everything chosen, a way back to any step, and the reasons Finish is blocked, each with a link to its step. It shows the
 * answers on screen (the unsaved ones included) and decides nothing: the server checks the draft again when Finish is pressed. Budget and registration
 * choices are not part of the wizard yet, so they are listed as not set up rather than left out.
 */
export function ReviewStep({ form, draft, people, issues, serverIssues, onEdit }: {
  form: WizardForm; draft: DraftView; people: WizardPerson[]; issues: readonly Issue[]; serverIssues: readonly Issue[]; onEdit: (step: WizardStep) => void;
}) {
  const t = useTranslations("CampaignWizard"), tr = useTranslations("CampaignWizard.review"), format = useFormatter();
  const blocking = issues.length ? issues : serverIssues;
  const nameOf = (userId: string) => people.find((person) => person.id === userId)?.name || t("aMember");
  const owner = nameOf(draft.createdBy);
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00Z`), { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  const notSet = tr("notSet");
  const place = [[t("place.structure"), form.place.structure ? t(`place.structures.${form.place.structure}`) : notSet],
    [t("place.country"), form.place.country || notSet], [t("place.cityRegion"), form.place.cityRegion || notSet],
    [tr("dates"), form.place.startDate && form.place.endDate ? `${date(form.place.startDate)} – ${date(form.place.endDate)}` : notSet], [t("place.timeZone"), form.place.timeZone || notSet]];
  const departments = departmentKeys.filter((key) => form.leaders.departments.includes(key));
  const modules = moduleKeys.filter((key) => form.tools.modules.includes(key));
  const section = (id: WizardStep, title: string, body: React.ReactNode) => <section key={id} aria-labelledby={`review-${id}`} className="space-y-3 rounded-xl border bg-card p-4">
    <div className="flex items-center justify-between gap-3"><h3 id={`review-${id}`} className="text-sm font-semibold">{title}</h3>
      <Button type="button" variant="outline" className="min-h-11" aria-label={tr("editLabel", { step: title })} onClick={() => onEdit(id)}>{tr("edit")}</Button></div>
    {body}
  </section>;
  const rows = (list: string[][]) => <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm">{value}</dd></div>)}</dl>;
  return <div className="space-y-4">
    {blocking.length > 0 && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true" /><AlertTitle>{tr("blockedTitle")}</AlertTitle>
      <AlertDescription><ul className="space-y-1">{blocking.map((issue) => <li key={`${issue.step}-${issue.code}`} className="flex flex-wrap items-center gap-2">
        <span>{t(`issues.${issue.code}`)}</span>
        <Button type="button" variant="link" className="h-auto min-h-11 p-0" onClick={() => onEdit(issue.step as WizardStep)}>{tr("goTo", { step: t(`steps.${issue.step}`) })}</Button></li>)}</ul></AlertDescription></Alert>}
    {section("type", t("steps.type"), rows([[t("steps.type"), form.type ? t(`types.${form.type}.label`) : notSet]]))}
    {section("basics", t("steps.basics"), <>
      {rows([[t("basics.name"), form.basics.name.trim() || notSet], [tr("owner"), owner]])}
      {form.basics.description.trim() && <div><p className="text-xs text-muted-foreground">{t("basics.description")}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{form.basics.description}</p></div>}
      {form.basics.mission.trim() && <div><p className="text-xs text-muted-foreground">{t("basics.mission")}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{form.basics.mission}</p></div>}</>)}
    {section("place", t("steps.place"), rows(place))}
    {section("leaders", t("steps.leaders"), departments.length ? <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{departments.map((key) => {
      const leaders = draft.assignments.filter((row) => row.department === key && row.role === "leader").map((row) => nameOf(row.userId));
      const members = draft.assignments.filter((row) => row.department === key && row.role === "member").length;
      const pending = draft.invitations.filter((row) => row.department === key && row.state === "pending").length;
      return <li key={key} className="min-w-0 rounded-lg border px-3 py-2"><p className="text-sm font-medium">{t(`departments.${key}`)}</p>
        <p className="mt-1 break-words text-xs text-muted-foreground">{[leaders.length ? tr("leaders", { names: leaders.join(", ") }) : tr("noLeader"), tr("teamCount", { count: members }), pending ? tr("pending", { count: pending }) : ""].filter(Boolean).join(" · ")}</p></li>;
    })}</ul> : <p className="text-sm text-muted-foreground">{tr("noDepartments")}</p>)}
    {section("tools", t("steps.tools"), modules.length ? <ul className="flex flex-wrap gap-2">{modules.map((key) => <li key={key} className="rounded-md border px-2 py-1 text-sm">{t(`modules.${key}`)}</li>)}</ul> : <p className="text-sm text-muted-foreground">{tr("noTools")}</p>)}
    <section aria-labelledby="review-budget" className="space-y-2 rounded-xl border bg-card p-4"><h3 id="review-budget" className="text-sm font-semibold">{t("steps.budget")}</h3><p className="text-sm text-muted-foreground">{tr("notAvailable")}</p></section>
    <section aria-labelledby="review-connect" className="space-y-2 rounded-xl border bg-card p-4"><h3 id="review-connect" className="text-sm font-semibold">{t("steps.connect")}</h3><p className="text-sm text-muted-foreground">{tr("notAvailable")}</p></section>
    <p className="text-sm text-muted-foreground">{tr("nothingPublished")}</p>
  </div>;
}
