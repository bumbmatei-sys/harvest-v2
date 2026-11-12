"use client";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { z } from "zod";
import type { intakeSubmission } from "@/lib/connect-intake";
import type { IntakeManifest, IntakePurpose } from "@/lib/connect-intake";
import { useRequest } from "@/hooks/use-request";

export function ResponseForm({ manifest, endpoint, preview=false }: { manifest: IntakeManifest; endpoint: string; preview?: boolean }) {
 const editor=useTranslations("LandingEditor");
 const invite=useTranslations("Invitations");
 const t=useTranslations("Intake"),id=useId(),request=useRequest();
 const [followUp,setFollowUp]=useState(false),[newsletter,setNewsletter]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [invitation,setInvitation]=useState(false),[invitationAck,setInvitationAck]=useState(false);
 const [receipt,setReceipt]=useState<string|null>(null),[ack,setAck]=useState(false),[copied,setCopied]=useState(false);
 const retry=useRef<z.infer<typeof intakeSubmission>|null>(null);
 const [locked,setLocked]=useState(false),[attempt,setAttempt]=useState<z.infer<typeof intakeSubmission>|null>(null);
 const selected: IntakePurpose[]=[...(followUp?["outreach_follow_up" as const]:[]),...(newsletter?["newsletter" as const]:[]),...(invitation?["account_communications" as const]:[])];
 const emailNeeded=invitation||newsletter||(followUp&&manifest.definition.followUpChannel==="email"),phoneNeeded=followUp&&manifest.definition.followUpChannel==="phone";
 async function submit(form:FormData) {
  if(preview)return;
  setBusy(true);setError("");
  if(!retry.current)retry.current={submissionId:crypto.randomUUID(),receiptToken:manifest.receiptToken,
   stamp:manifest.stamp,capability:manifest.capability,purposes:selected,
   preferredName:String(form.get("preferredName")||""),email:String(form.get("email")||""),phone:String(form.get("phone")||""),website:String(form.get("website")||"")};
  setLocked(true);setAttempt(retry.current);
  const result=await request(endpoint,{method:"POST",body:retry.current});
  setBusy(false);if(!result.ok){
   // A validation refusal persists no response. Permit correction; unknown outcomes retain the exact request and proof.
   if(result.status===400){retry.current=null;setAttempt(null);setLocked(false);}
   setError(result.status===400?t("checkDetails"):result.status===409?t("changed"):result.status===429?t("limited"):result.status===404?t("unavailable"):result.error);return;
  }setReceipt(retry.current.receiptToken);
 }
 async function resend(){
  setBusy(true);setError("");setInvitationAck(false);
  const result=await request("/api/public/connect/invitations",{method:"POST",body:{receiptToken:receipt}});
  setBusy(false);if(!result.ok){setError(result.status===429?t("limited"):invite("failed"));return;}setInvitationAck(true);
 }
 async function rights(action:"withdraw"|"erase",purpose?:IntakePurpose) {
  setBusy(true);setError("");setAck(false);
  const result=await request("/api/public/connect/rights",{method:"POST",body:{receiptToken:receipt,action,...(purpose?{purpose}:{})}});
  setBusy(false);if(!result.ok){setError(result.status===429?t("limited"):result.status===400?t("rightsInvalid"):result.status===404?t("unavailable"):result.error);return;}setAck(true);
 }
 return <section id="response-form" className="mt-10 space-y-4" aria-labelledby={`${id}-title`}>
  <Alert><AlertDescription>{t("testNotice")}</AlertDescription></Alert>
  <Card><CardHeader><CardTitle><h2 id={`${id}-title`}>{t(receipt?"pendingTitle":"formTitle")}</h2></CardTitle></CardHeader>
   <CardContent className="space-y-5">
    {error&&<Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {error&&!receipt&&attempt&&<Alert><AlertTitle>{t("recovery")}</AlertTitle><AlertDescription><p>{t("retryHelp")}</p><p>{t("recoveryHelp")}</p><code className="block break-all">{attempt.receiptToken}</code></AlertDescription></Alert>}
    {!receipt?<form onSubmit={event=>{event.preventDefault();if(!busy)void submit(new FormData(event.currentTarget));}}><FieldGroup>
     {preview&&<p role="status">{editor("previewForm")}</p>}<p>{t("formBody")}</p>
     {manifest.purposes.includes("outreach_follow_up")&&<label className="flex min-h-11 items-center gap-3" htmlFor={`${id}-followup`}>
      <Checkbox id={`${id}-followup`} disabled={locked} checked={followUp} onCheckedChange={v=>setFollowUp(v===true)} className="size-11 shrink-0"/>{t("followUp")}</label>}
     {manifest.purposes.includes("newsletter")&&<label className="flex min-h-11 items-center gap-3" htmlFor={`${id}-newsletter`}>
      <Checkbox id={`${id}-newsletter`} disabled={locked} checked={newsletter} onCheckedChange={v=>setNewsletter(v===true)} className="size-11 shrink-0"/>{t("newsletter")}</label>}
     {manifest.purposes.includes("account_communications")&&<><label className="flex min-h-11 items-center gap-3" htmlFor={`${id}-invitation`}>
      <Checkbox id={`${id}-invitation`} disabled={locked} checked={invitation} onCheckedChange={v=>setInvitation(v===true)} className="size-11 shrink-0"/>{invite("choice")}</label><p className="text-sm text-muted-foreground">{invite("formHelp")}</p></>}
     {manifest.definition.preferredName&&<Field><FieldLabel htmlFor={`${id}-name`}>{t("name")}</FieldLabel><Input disabled={locked} id={`${id}-name`} name="preferredName" autoComplete="off" maxLength={80} className="min-h-11"/></Field>}
     {emailNeeded&&<Field><FieldLabel htmlFor={`${id}-email`}>{t("email")}</FieldLabel><Input disabled={locked} id={`${id}-email`} name="email" type="email" autoComplete="off" required maxLength={254} className="min-h-11"/></Field>}
     {phoneNeeded&&<Field><FieldLabel htmlFor={`${id}-phone`}>{t("phone")}</FieldLabel><Input disabled={locked} id={`${id}-phone`} name="phone" type="tel" autoComplete="off" required maxLength={32} className="min-h-11"/></Field>}
     <div hidden aria-hidden="true"><label htmlFor={`${id}-website`}>{t("website")}</label><Input disabled={locked} id={`${id}-website`} name="website" tabIndex={-1} autoComplete="off"/></div>
     <div className="space-y-2 rounded-lg border p-4"><h3 className="font-semibold">{t("notice")}</h3><p className="whitespace-pre-wrap break-words text-sm">{manifest.notice}</p><p className="text-sm text-muted-foreground">{t("retention",{days:manifest.retentionDays})}</p></div>
     <Button disabled={preview||busy||selected.length===0} className="min-h-11" type="submit">{t(busy?"saving":"submit")}</Button>
    </FieldGroup></form>:<div className="space-y-4">
     <p>{attempt?.purposes.includes("account_communications")?invite("pendingBody"):t("pendingBody")}</p><Alert><AlertTitle>{t("recovery")}</AlertTitle><AlertDescription>{t("recoveryHelp")}</AlertDescription></Alert>
     <code className="block break-all rounded-lg border p-3 text-sm">{receipt}</code>
     <Button variant="outline" className="min-h-11" onClick={()=>void navigator.clipboard.writeText(receipt).then(()=>setCopied(true)).catch(()=>setCopied(false))}>{t(copied?"copied":"copy")}</Button>
     <div className="flex flex-wrap gap-3">{attempt?.purposes.includes("outreach_follow_up")&&<Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>void rights("withdraw","outreach_follow_up")}>{t("withdrawFollowUp")}</Button>}
      {attempt?.purposes.includes("newsletter")&&<Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>void rights("withdraw","newsletter")}>{t("withdrawNewsletter")}</Button>}
      {attempt?.purposes.includes("account_communications")&&<><Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>void rights("withdraw","account_communications")}>{invite("withdraw")}</Button><Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>void resend()}>{invite("resend")}</Button></>}
      <Button variant="destructive" className="min-h-11" disabled={busy} onClick={()=>void rights("erase")}>{t("erase")}</Button></div>
     {invitationAck&&<p role="status">{invite("ack")}</p>}
     {ack&&<p role="status">{t("rightsAck")}</p>}
    </div>}
    <div className="flex flex-wrap gap-3"><Button asChild variant="outline" className="min-h-11"><Link prefetch={false} href="/resources/start">{t("resources")}</Link></Button>
     <Button asChild variant="outline" className="min-h-11 whitespace-normal"><Link prefetch={false} href="/connect/rights">{t("rightsLink")}</Link></Button></div>
   </CardContent>
  </Card>
 </section>;
}
