"use client";
import Link from "next/link";
import { useState,useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Alert,AlertDescription } from "@/components/ui/alert";
import { authClient } from "@/lib/auth-client";
// The URL fragment is an external browser source. Capture each new link in this page, remove it
// before interaction, and retain it only in this client store (never storage or server HTML).
function fragmentStore(){
 let value:string|null=null;
 return {snapshot:()=>value,server:()=>null,subscribe:(notify:()=>void)=>{
  const capture=()=>{const incoming=new URLSearchParams(location.hash.slice(1)).get("token");
   if(value===null||incoming!==null){value=incoming??"";history.replaceState(null,"",location.pathname);notify();}
  };
  capture();window.addEventListener("hashchange",capture);
  return ()=>window.removeEventListener("hashchange",capture);
 }};
}
async function post<T>(path:string,body:unknown){
 try{const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  return {ok:r.ok,status:r.status,data:await r.json() as T&{details?:{reason?:string}}};
 }catch{return {ok:false,status:0,data:null};}
}
export function ClaimForm({ready,email,automatic=false,organizer=""}:{ready:boolean;email:string|null;automatic?:boolean;organizer?:string}) {
 const t=useTranslations("Invitations"),[store]=useState(fragmentStore);
 const token=useSyncExternalStore(store.subscribe,store.snapshot,store.server);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 async function prepare(){
  setBusy(true);setError("");const result=await post("/api/connect/invitations/prepare",{token});
  setBusy(false);if(!result.ok){setError(t("unavailable"));return;}
  window.location.replace("/connect/claim");
 }
 async function consume(action:"confirm"|"decline"){
  setBusy(true);setError("");const r=await post<{next:string}>("/api/connect/invitations/claim",{action});
  setBusy(false);if(!r.ok){if(r.status===401){window.location.replace("/sign-in?connect=1");return;}setError(r.data?.details?.reason==="mismatch"?t("mismatch"):r.status===409?t("unavailable"):t("failed"));return;}if(r.data)window.location.replace(r.data.next);
 }
 async function switchAccount(){await authClient.signOut();window.location.replace("/sign-in?connect=1");}
 return <div className="space-y-5">
  {error&&<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  {token===null?<p>{t("saving")}</p>:token?<><p>{t("claimBody")}</p><Button disabled={busy} className="min-h-11" onClick={()=>void prepare()}>{t(busy?"saving":"prepare")}</Button></>:ready?<>
   {email?<><p>{automatic?t("automaticConfirm",{email,organizer}):t("confirmBody",{email})}</p><div className="flex flex-wrap gap-3"><Button disabled={busy} className="min-h-11" onClick={()=>void consume("confirm")}>{t("confirm")}</Button><Button variant="outline" disabled={busy} className="min-h-11" onClick={()=>void consume("decline")}>{t("decline")}</Button><Button variant="outline" disabled={busy} className="min-h-11" onClick={()=>void switchAccount()}>{t("switchAccount")}</Button></div></>:<Button asChild className="min-h-11"><Link href="/sign-in?connect=1" prefetch={false}>{t("signIn")}</Link></Button>}
  </>:<p>{t("unavailable")}</p>}
  <Button asChild variant="outline" className="min-h-11"><Link href="/resources/start" prefetch={false}>{t("resources")}</Link></Button>
 </div>;
}
