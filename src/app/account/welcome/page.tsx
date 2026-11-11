import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { getAccountProfile } from "@/server/account-profile";
import { communitiesEnabled } from "@/server/communities-mode";
import { pageSession } from "@/server/page-session";
import { safeSourcePath } from "@/server/connect-invitations";
import { PublicFrame } from "@/components/connect/public-frame";
import { PersonalSignOut } from "@/components/connect/personal-sign-out";
import { Button } from "@/components/ui/button";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function Welcome({searchParams}:{searchParams:Promise<{from?:string}>}){
 const session=await pageSession("personal"),source=safeSourcePath((await searchParams).from),profile=await getAccountProfile(getDb(),session.user.id);
 const setupHref=`/account/onboarding${source==="/resources/start"?"":`?from=${encodeURIComponent(source)}`}`;
 if(profile.onboarding==="pending")redirect(setupHref);
 const t=await getTranslations("Invitations"),setup=await getTranslations("AccountProfile");
 return <PublicFrame personal><div className="space-y-6"><h1 className="text-3xl font-semibold">{t("welcomeTitle")}</h1><p className="max-w-prose">{t("welcomeBody")}</p>
 <div className="flex flex-wrap gap-3"><Button asChild className="min-h-11"><Link href="/resources/start" prefetch={false}>{t("resources")}</Link></Button><Button asChild variant="outline" className="min-h-11"><Link href="/account/profile">{t("profile")}</Link></Button>{communitiesEnabled()&&<><Button asChild variant="outline" className="min-h-11"><Link href="/discover" prefetch={false}>{t("discover")}</Link></Button><Button asChild variant="outline" className="min-h-11"><Link href="/account/communities" prefetch={false}>{t("myCommunities")}</Link></Button></>}{profile.onboarding==="skipped"&&<Button asChild variant="outline" className="min-h-11"><Link href={setupHref}>{setup("finishSetup")}</Link></Button>}{source!=="/resources/start"&&<Button asChild variant="outline" className="min-h-11"><Link href={source} prefetch={false}>{t("return")}</Link></Button>}<Button asChild variant="outline" className="min-h-11"><Link href="/connect/rights" prefetch={false}>{t("responseRights")}</Link></Button></div><PersonalSignOut/></div></PublicFrame>;
}
