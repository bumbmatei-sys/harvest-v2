"use client";
import { useId,useState } from "react";
import { useTranslations } from "next-intl";
import { Alert,AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field,FieldGroup,FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect,NativeSelectOption } from "@/components/ui/native-select";
import { useRequest } from "@/hooks/use-request";
export function IntakeRightsForm() {
 const invite=useTranslations("Invitations");
 const t=useTranslations("Intake"),id=useId(),request=useRequest();
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[done,setDone]=useState(false);
 async function submit(form:FormData) {
  setBusy(true);setError("");setDone(false);const action=form.get("action");
  const result=await request("/api/public/connect/rights",{method:"POST",body:{receiptToken:form.get("receiptToken"),action,...(action==="withdraw"?{purpose:form.get("purpose")}:{})}});
  setBusy(false);if(!result.ok){setError(result.status===429?t("limited"):result.status===400?t("rightsInvalid"):result.status===404?t("unavailable"):result.error);return;}setDone(true);
 }
 return <form onSubmit={event=>{event.preventDefault();if(!busy)void submit(new FormData(event.currentTarget));}}><FieldGroup>
  <p>{t("rightsBody")}</p>{error&&<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  <Field><FieldLabel htmlFor={`${id}-token`}>{t("recovery")}</FieldLabel><Input id={`${id}-token`} name="receiptToken" autoComplete="off" spellCheck={false} required minLength={64} maxLength={64} className="min-h-11"/></Field>
  <Field><FieldLabel htmlFor={`${id}-action`}>{t("action")}</FieldLabel><NativeSelect id={`${id}-action`} name="action" className="min-h-11"><NativeSelectOption value="withdraw">{t("withdraw")}</NativeSelectOption><NativeSelectOption value="erase">{t("erase")}</NativeSelectOption></NativeSelect></Field>
  <Field><FieldLabel htmlFor={`${id}-purpose`}>{t("purpose")}</FieldLabel><NativeSelect id={`${id}-purpose`} name="purpose" className="min-h-11"><NativeSelectOption value="outreach_follow_up">{t("followUp")}</NativeSelectOption><NativeSelectOption value="account_communications">{invite("choice")}</NativeSelectOption><NativeSelectOption value="newsletter">{t("newsletter")}</NativeSelectOption></NativeSelect></Field>
  <Button disabled={busy} type="submit" className="min-h-11">{t(busy?"saving":"apply")}</Button>{done&&<p role="status">{t("rightsAck")}</p>}
 </FieldGroup></form>;
}
