import { z } from "zod";
import Link from "next/link";
import { headers } from "next/headers";
import { getDb } from "@/db/client";
import { getAuth } from "@/server/auth-instance";
import { listSubjectResponses } from "@/server/connect-subject-rights";
import { SubjectRights } from "@/components/connect/subject-rights";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { syntheticIntakeEnabled } from "@/server/connect-intake-mode";
import { PublicFrame } from "@/components/connect/public-frame";
import { IntakeRightsForm } from "@/components/connect/rights-form";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false},referrer:"no-referrer" as const};
export default async function RightsPage({searchParams}:{searchParams:Promise<{after?:string}>}){
 if(!syntheticIntakeEnabled())notFound();const t=await getTranslations("Intake");
 const subject=await getTranslations("SubjectRights");
 const session=await getAuth().api.getSession({headers:await headers()});
 const after=(await searchParams).after;
 if(after&&!z.uuid().safeParse(after).success)notFound();
 const page=session?await listSubjectResponses(getDb(),session.user.id,after):null;
 return <PublicFrame personal={Boolean(session)}><div className="mx-auto max-w-2xl space-y-6"><h1 className="text-3xl font-semibold">{t("rightsTitle")}</h1><section className="space-y-4"><h2 className="text-xl font-semibold">{subject("title")}</h2>{page?<><SubjectRights items={page.items}/>{page.next&&<Button asChild variant="outline" className="min-h-11"><Link href={`/connect/rights?after=${page.next}`} prefetch={false}>{subject("next")}</Link></Button>}</>:<Button asChild className="min-h-11"><Link href="/sign-in">{subject("signIn")}</Link></Button>}</section><section className="space-y-4"><h2 className="text-xl font-semibold">{subject("receipt")}</h2><IntakeRightsForm/></section></div></PublicFrame>;
}
