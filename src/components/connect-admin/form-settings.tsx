"use client";
import { useId,useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert,AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field,FieldDescription,FieldGroup,FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect,NativeSelectOption } from "@/components/ui/native-select";
import { useCrmRequest } from "@/components/crm/request";
import type { listIntakeForms } from "@/server/connect-intake";
export function IntakeFormSettings({endpoint,versions}:{endpoint:string;versions:Awaited<ReturnType<typeof listIntakeForms>>}) {
 const invite=useTranslations("Invitations");
 const t=useTranslations("Intake"),id=useId(),router=useRouter(),request=useCrmRequest();
 const [revision,setRevision]=useState(""),[name,setName]=useState(""),[notice,setNotice]=useState(""),[days,setDays]=useState("");
 const [includeName,setIncludeName]=useState(true),[followUp,setFollowUp]=useState(true),[newsletter,setNewsletter]=useState(true),[channel,setChannel]=useState("email");
 const [invitation,setInvitation]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[done,setDone]=useState(false);
 const selected=versions.find(v=>v.id===revision);
 const automatic=invitation&&selected?.definition.kind!=="connect-intake-v2";
 function choose(value:string) {
  setRevision(value);setDone(false);const v=versions.find(v=>v.id===value);
  setName(v?.name??"");setNotice(v?.notice?.replace(/^Synthetic test notice: /,"")??"");setDays(v?.retentionDays?.toString()??"");
  setIncludeName(v?.definition.preferredName===true);setFollowUp(v?v.purposes.includes("outreach_follow_up"):true);
  setInvitation(v?v.purposes.includes("account_communications"):false);setNewsletter(v?v.purposes.includes("newsletter"):true);setChannel(v?.definition.followUpChannel==="phone"?"phone":"email");
 }
 async function submit() {
  setBusy(true);setError("");setDone(false);
  const result=await request(endpoint,{method:"POST",body:{...(selected?{formId:selected.formId}:{}),name,notice,retentionDays:Number(days),
   definition:{kind:invitation?(selected?.definition.kind==="connect-intake-v2"?"connect-intake-v2":"connect-intake-v3"):(selected?.definition.kind??"connect-intake-v1"),syntheticOnly:true,preferredName:includeName,followUpChannel:channel},
   purposes:[...(followUp?["outreach_follow_up"]:[]),...(newsletter?["newsletter"]:[]),...(invitation?["account_communications"]:[])]}});
  setBusy(false);if(!result.ok){setError(result.error);return;}setDone(true);router.refresh();
 }
 return <form onSubmit={event=>{event.preventDefault();if(!busy)void submit();}}><FieldGroup>
  <Alert><AlertDescription>{t("testNotice")}</AlertDescription></Alert>
  {error&&<Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
  <Field><FieldLabel htmlFor={`${id}-revision`}>{t("revision")}</FieldLabel><NativeSelect id={`${id}-revision`} value={revision} onChange={e=>choose(e.target.value)} className="min-h-11"><NativeSelectOption value="">{t("newForm")}</NativeSelectOption>{versions.map(v=><NativeSelectOption key={v.id} value={v.id}>{t("version",{name:v.name,version:v.version})}</NativeSelectOption>)}</NativeSelect></Field>
  <Field><FieldLabel htmlFor={`${id}-name`}>{t("formName")}</FieldLabel><Input id={`${id}-name`} value={name} onChange={e=>setName(e.target.value)} required readOnly={Boolean(selected)} maxLength={200} className="min-h-11"/></Field>
  <label className="flex min-h-11 items-center gap-3" htmlFor={`${id}-include-name`}><Checkbox id={`${id}-include-name`} checked={includeName} onCheckedChange={v=>setIncludeName(v===true)} className="size-11 shrink-0"/>{t("includeName")}</label>
  <fieldset className="space-y-3"><legend className="mb-3 font-medium">{t("purposeLabel")}</legend>
   <label className="flex min-h-11 items-center gap-3" htmlFor={`${id}-followup`}><Checkbox id={`${id}-followup`} checked={followUp} onCheckedChange={v=>setFollowUp(v===true)} className="size-11 shrink-0"/>{t("followUp")}</label>
   <label className="flex min-h-11 items-center gap-3" htmlFor={`${id}-newsletter`}><Checkbox id={`${id}-newsletter`} checked={newsletter} onCheckedChange={v=>setNewsletter(v===true)} className="size-11 shrink-0"/>{t("newsletter")}</label>
   <label className="flex min-h-11 items-center gap-3" htmlFor={`${id}-invitation`}><Checkbox id={`${id}-invitation`} checked={invitation} onCheckedChange={v=>setInvitation(v===true)} className="size-11 shrink-0"/>{invite("choice")}</label>
   <FieldDescription>{invite(automatic?"automaticFormHelp":"formHelp")}</FieldDescription>
  </fieldset>
  {followUp&&<Field><FieldLabel htmlFor={`${id}-channel`}>{t("channel")}</FieldLabel><NativeSelect id={`${id}-channel`} value={channel} onChange={e=>setChannel(e.target.value)} className="min-h-11"><NativeSelectOption value="email">{t("emailChannel")}</NativeSelectOption></NativeSelect><FieldDescription>{t("phoneUnavailable")}</FieldDescription></Field>}
  <Field><FieldLabel htmlFor={`${id}-notice`}>{t("noticeLabel")}</FieldLabel><Textarea id={`${id}-notice`} value={notice} onChange={e=>setNotice(e.target.value)} required maxLength={19000} aria-describedby={`${id}-notice-help`}/><FieldDescription id={`${id}-notice-help`}>{t("noticeHelp")}</FieldDescription></Field>
  <Field><FieldLabel htmlFor={`${id}-days`}>{t("days")}</FieldLabel><Input id={`${id}-days`} value={days} onChange={e=>setDays(e.target.value)} type="number" min={1} max={36500} required className="min-h-11" aria-describedby={`${id}-days-help`}/><FieldDescription id={`${id}-days-help`}>{t("daysHelp")}</FieldDescription></Field>
  <Button type="submit" disabled={busy||(!followUp&&!newsletter&&!invitation)} className="min-h-11">{t(busy?"saving":"publish")}</Button>
  {done&&<p role="status">{t("published")}</p>}<p className="text-sm text-muted-foreground">{t("purgeHelp")}</p>
 </FieldGroup></form>;
}
