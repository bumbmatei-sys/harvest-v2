"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card,CardHeader,CardTitle,CardContent } from "@/components/ui/card";
import { Alert,AlertDescription } from "@/components/ui/alert";
import { useCrmRequest } from "@/components/crm/request";
import type { SubjectResponse } from "@/server/connect-subject-rights";
export function SubjectRights({items}:{items:SubjectResponse[]}){
 const t=useTranslations("SubjectRights"),router=useRouter(),request=useCrmRequest();
 const [busy,setBusy]=useState(false),[confirm,setConfirm]=useState<string|null>(null),[error,setError]=useState(""),[done,setDone]=useState(false);
 async function apply(handle:string,action:"withdraw"|"erase",purpose?:string){
  setBusy(true);setError("");setDone(false);
  const result=await request("/api/connect/rights",{method:"POST",body:{handle,action,...(purpose?{purpose}:{})}});
  setBusy(false);if(!result.ok){setError(t("failed"));return;}
  setConfirm(null);setDone(true);router.refresh();
 }
 return <div className="space-y-4">
  {error&&<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  {done&&<p role="status">{t("done")}</p>}
  {!items.length&&<p>{t("empty")}</p>}
  {items.map(item=><Card key={item.handle}><CardHeader><CardTitle className="break-words">{t("organizerCampaign",{organizer:item.organizer,campaign:item.campaign})}</CardTitle></CardHeader><CardContent className="space-y-4">
   <div className="flex flex-wrap gap-3">{item.purposes.map(purpose=><Button key={purpose} variant="outline" disabled={busy} className="min-h-11" onClick={()=>void apply(item.handle,"withdraw",purpose)}>{t("withdraw",{purpose:t(purpose)})}</Button>)}
   <Button variant="destructive" disabled={busy} className="min-h-11" onClick={()=>setConfirm(item.handle)}>{t("erase")}</Button></div>
   {confirm===item.handle&&<div className="space-y-3"><p>{t("erasureNotice")}</p><div className="flex flex-wrap gap-3"><Button variant="destructive" disabled={busy} className="min-h-11" onClick={()=>void apply(item.handle,"erase")}>{t("confirmErase")}</Button><Button variant="outline" disabled={busy} className="min-h-11" onClick={()=>setConfirm(null)}>{t("cancel")}</Button></div></div>}
  </CardContent></Card>)}
 </div>;
}
