import { cookies,headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { getAuth } from "@/server/auth-instance";
import { syntheticIntakeEnabled } from "@/server/connect-intake-mode";
import { readInvitationFlow } from "@/server/connect-invitations";
import { invitationFlowCookie } from "@/server/connect-invitation-http";
import { PublicFrame } from "@/components/connect/public-frame";
import { ClaimForm } from "@/components/connect/claim-form";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function ClaimPage(){
 if(!syntheticIntakeEnabled())notFound();
 const t=await getTranslations("Invitations"),flow=(await cookies()).get(invitationFlowCookie)?.value;
 const ready=Boolean(flow&&await readInvitationFlow(getDb(),flow));
 const session=await getAuth().api.getSession({headers:await headers()});
 return <PublicFrame personal><div className="space-y-6"><h1 className="text-3xl font-semibold">{t("claimTitle")}</h1><ClaimForm ready={ready} email={session?.user.email??null}/></div></PublicFrame>;
}
