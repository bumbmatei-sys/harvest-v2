import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { listIntakeForms } from "@/server/connect-intake";
import { AccessError } from "@/server/permissions";
import { IntakeFormSettings } from "@/components/connect-admin/form-settings";
import { Button } from "@/components/ui/button";
export const dynamic="force-dynamic";
export default async function FormSettingsPage({params}:{params:Promise<{tenantId:string;campaignId:string}>}) {
 const p=await params,session=await pageSession(),t=await getTranslations("Intake");
 const versions=await listIntakeForms(getDb(),session.user.id,p.tenantId,p.campaignId).catch((error:unknown)=>{if(error instanceof AccessError)return null;throw error;});
 if(!versions)notFound();const root=`/workspaces/${p.tenantId}/campaigns/${p.campaignId}/connect`;
 return <div className="space-y-6"><Button asChild variant="outline" className="min-h-11"><Link href={root}>{t("back")}</Link></Button>
  <div className="space-y-2"><h1 className="text-2xl font-semibold">{t("settingsTitle")}</h1><p className="max-w-3xl text-muted-foreground">{t("settingsBody")}</p></div>
  <div className="max-w-3xl"><IntakeFormSettings endpoint={`/api/workspaces/${p.tenantId}/campaigns/${p.campaignId}/connect/forms`} versions={versions}/></div>
 </div>;
}
