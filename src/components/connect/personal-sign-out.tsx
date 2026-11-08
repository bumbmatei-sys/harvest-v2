"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Alert,AlertDescription } from "@/components/ui/alert";
export function PersonalSignOut(){
 const t=useTranslations("Invitations"),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 async function leave(){setBusy(true);setFailed(false);try{const r=await authClient.signOut();if(r.error){setFailed(true);return;}window.location.replace("/resources/start");}catch{setFailed(true);}finally{setBusy(false);}}
 return <div className="space-y-3">{failed&&<Alert variant="destructive"><AlertDescription>{t("failed")}</AlertDescription></Alert>}<Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>void leave()}>{t(busy?"saving":"signOut")}</Button></div>;
}
