"use client";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, Circle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EditorShell } from "@/components/editor/editor-shell";
import { CommunityJoinCard } from "@/components/communities/join-card";
import { CommunityInvites, type CommunityInvite } from "@/components/communities/community-invites";
import { Textarea } from "@/components/ui/textarea";
import { useCrmRequest } from "@/components/crm/request";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { comingSoonSteps, communityEditorSteps, publishChecklist, type CommunityEditorStep } from "@/lib/community-editor";

export type EditableCommunity = { id: string; slug: string; name: string; tagline: string | null; status: "draft" | "published" | "archived";
  visibility: "listed" | "unlisted" | "hidden"; allowOpen: boolean; allowApply: boolean; allowInvite: boolean; allowEntitlement: boolean; version: number;
  description: string | null; rules: string | null; discoverOptIn: boolean };
export type CommunityMember = { userId: string; name: string; role: string; status: string };
type Fields = Pick<EditableCommunity, "name" | "tagline" | "visibility" | "allowOpen" | "allowApply" | "allowInvite" | "allowEntitlement" | "description" | "rules" | "discoverOptIn">;
const optionalText = ["tagline", "description", "rules"] as const;
const admissionKeys = ["allowOpen", "allowApply", "allowInvite", "allowEntitlement"] as const;
const fieldsOf = (c: EditableCommunity): Fields => ({ name: c.name, tagline: c.tagline, visibility: c.visibility, allowOpen: c.allowOpen, allowApply: c.allowApply,
  allowInvite: c.allowInvite, allowEntitlement: c.allowEntitlement, description: c.description, rules: c.rules, discoverOptIn: c.discoverOptIn });
const same = (a: Fields, b: Fields) => (Object.keys(a) as (keyof Fields)[]).every((key) => (a[key] ?? null) === (b[key] ?? null));

export function CommunityEditor({ initial, members, invites, endpoint, listHref, host, writable }: { initial: EditableCommunity; members: CommunityMember[]; invites: CommunityInvite[]; endpoint: string; listHref: string; host: string; writable: boolean }) {
  const t = useTranslations("CommunityEditor"), request = useCrmRequest();
  const [data, setData] = useState(initial), [fields, setFields] = useState(() => fieldsOf(initial));
  const [step, setStep] = useState<CommunityEditorStep>("basics");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [conflict, setConflict] = useState(false);
  const dirty = !same(fields, fieldsOf(data));
  const { destination, setDestination, leave } = useUnsavedChangesGuard(dirty || busy);
  const checklist = publishChecklist(fields);
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => { setNotice(""); setFields((previous) => ({ ...previous, [key]: value })); };

  function fail(result: { status: number; error: string }) { setConflict(result.status === 409); setError(result.error); }
  async function save(): Promise<EditableCommunity | null> {
    if (!dirty) return data;
    const changes = Object.fromEntries((Object.keys(fields) as (keyof Fields)[]).filter((key) => (fields[key] ?? null) !== (data[key] ?? null))
      .map((key) => [key, (optionalText as readonly string[]).includes(key) ? ((fields[key] as string | null)?.trim() || null) : key === "name" ? fields.name.trim() : fields[key]]));
    const result = await request<EditableCommunity>(endpoint, { method: "PATCH", body: { version: data.version, ...changes } });
    if (!result.ok) { fail(result); return null; }
    setData(result.data); setFields(fieldsOf(result.data)); return result.data;
  }
  async function run(action: "save" | "publish" | "unpublish") {
    setBusy(true); setError(""); setNotice(""); setConflict(false);
    const saved = await save();
    if (saved && action !== "save") {
      const result = await request<EditableCommunity>(`${endpoint}/publish`, { method: "POST", body: { version: saved.version, published: action === "publish" } });
      if (result.ok) { setData(result.data); setNotice(t(action === "publish" ? "publishedNotice" : "unpublishedNotice")); } else fail(result);
    } else if (saved) setNotice(t("saved"));
    setBusy(false);
  }

  const steps = communityEditorSteps.map((id) => ({ id, label: t(`steps.${id}`), disabled: comingSoonSteps.includes(id), badge: comingSoonSteps.includes(id) ? t("comingSoon") : undefined,
    done: id === "basics" ? checklist[0].done : id === "joining" ? checklist[1].done : id === "publish" ? data.status === "published" : id === "offer" || (id === "people" && members.length > 0) }));
  const status = <Badge variant={data.status === "published" ? "default" : "secondary"}>{t(`status.${data.status}`)}</Badge>;
  const actions = writable && <>
    <Button variant="outline" className="min-h-11" disabled={busy || !dirty} onClick={() => void run("save")}>{t(busy ? "saving" : "saveDraft")}</Button>
    {data.status === "published"
      ? <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void run("unpublish")}>{t("unpublish")}</Button>
      : <Button className="min-h-11" disabled={busy || !checklist.every((item) => item.done) || !fields.name.trim()} onClick={() => void run("publish")}>{t("publish")}</Button>}
  </>;
  const breadcrumb = <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><Link href={listHref}>{t("back")}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{data.name}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>;

  return <EditorShell breadcrumb={breadcrumb} title={data.name} status={status} actions={actions} steps={steps} current={step} onStep={(id) => setStep(id as CommunityEditorStep)}
    stepsLabel={t("stepsLabel")} previewLabel={t("preview")} preview={<CommunityJoinCard name={fields.name} tagline={fields.tagline} host={host} preview />}>
    {!writable && <Alert><AlertDescription>{t("readOnly")}</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{error}{conflict && <Button variant="outline" className="min-h-11" onClick={() => { if (dirty) setDestination(location.href); else location.reload(); }}>{t("reload")}</Button>}</AlertDescription></Alert>}
    {notice && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
    <Card><CardHeader><CardTitle>{t(`steps.${step}`)}</CardTitle></CardHeader><CardContent className="space-y-6">
      {step === "offer" && <RadioGroup value="free" aria-label={t("price")} className="gap-2">
        <Label htmlFor="community-price-free" className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal"><RadioGroupItem id="community-price-free" value="free" disabled={!writable} />{t("free")}</Label>
        <Label htmlFor="community-price-paid" className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal text-muted-foreground"><RadioGroupItem id="community-price-paid" value="paid" disabled /><span className="flex-1">{t("paid")}</span><Badge variant="secondary">{t("comingSoon")}</Badge></Label>
      </RadioGroup>}
      {step === "basics" && <>
        <Field><FieldLabel htmlFor="community-name">{t("name")}</FieldLabel><Input id="community-name" className="min-h-11" value={fields.name} maxLength={80} required disabled={!writable} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field><FieldLabel htmlFor="community-tagline">{t("tagline")}</FieldLabel><Input id="community-tagline" className="min-h-11" value={fields.tagline ?? ""} maxLength={160} disabled={!writable} onChange={(e) => set("tagline", e.target.value)} /></Field>
        <Field><FieldLabel htmlFor="community-description">{t("description")}</FieldLabel><Textarea id="community-description" rows={4} value={fields.description ?? ""} maxLength={2000} disabled={!writable} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field><FieldLabel htmlFor="community-address">{t("address")}</FieldLabel><Input id="community-address" className="min-h-11" value={`/communities/${data.slug}`} readOnly /></Field>
      </>}
      {step === "joining" && <>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">{t("visibility")}</legend>
          <RadioGroup value={fields.visibility} onValueChange={(value) => set("visibility", value as Fields["visibility"])} disabled={!writable} className="gap-2" aria-label={t("visibility")}>
            {(["listed", "unlisted", "hidden"] as const).map((value) => <Label key={value} htmlFor={`community-visibility-${value}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal"><RadioGroupItem id={`community-visibility-${value}`} value={value} />{t(`visibilities.${value}`)}</Label>)}
          </RadioGroup></fieldset>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">{t("admission")}</legend>
          {admissionKeys.map((key) => <Label key={key} htmlFor={`community-${key}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal">
            <Checkbox id={`community-${key}`} checked={fields[key]} disabled={!writable} onCheckedChange={(checked) => set(key, checked === true)} />{t(`admissions.${key}`)}</Label>)}
        </fieldset>
        <Label htmlFor="community-discover" className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal">
          <Checkbox id="community-discover" checked={fields.discoverOptIn && fields.visibility === "listed"} disabled={!writable || fields.visibility !== "listed"}
            onCheckedChange={(checked) => set("discoverOptIn", checked === true)} />{t("showInDiscover")}</Label>
        <Field><FieldLabel htmlFor="community-rules">{t("rules")}</FieldLabel><Textarea id="community-rules" rows={6} value={fields.rules ?? ""} maxLength={5000} disabled={!writable} onChange={(e) => set("rules", e.target.value)} /></Field>
      </>}
      {step === "people" && !writable && <p className="text-sm text-muted-foreground">{t("membersManagersOnly")}</p>}
      {step === "people" && writable && <div className="space-y-4">
        <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>{t("memberName")}</TableHead><TableHead>{t("memberRole")}</TableHead><TableHead>{t("memberStatus")}</TableHead></TableRow></TableHeader>
          <TableBody>{members.map((member) => <TableRow key={member.userId}><TableCell>{member.name.trim() || <span className="text-muted-foreground">{t("unnamed")}</span>}</TableCell><TableCell>{t(`roles.${member.role}`)}</TableCell><TableCell>{t(`memberStatuses.${member.status}`)}</TableCell></TableRow>)}</TableBody></Table></div>
        <CommunityInvites endpoint={endpoint} initial={invites} />
      </div>}
      {step === "publish" && <ul className="space-y-2" aria-label={t("checklist")}>
        {checklist.map((item) => <li key={item.key} className="flex min-h-11 items-center gap-3 rounded-md border px-3">
          {item.done ? <CircleCheck className="size-4 text-primary" aria-hidden="true" /> : <Circle className="size-4 text-muted-foreground" aria-hidden="true" />}
          <span>{t(`checks.${item.key}`)}</span><span className="sr-only">{t(item.done ? "checkDone" : "checkOpen")}</span></li>)}
      </ul>}
    </CardContent></Card>
    <AlertDialog open={destination !== null} onOpenChange={(open) => { if (!open) setDestination(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("leaveTitle")}</AlertDialogTitle><AlertDialogDescription>{t("leaveBody")}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel className="min-h-11">{t("stay")}</AlertDialogCancel><AlertDialogAction className="min-h-11" onClick={leave}>{t("leave")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </EditorShell>;
}
