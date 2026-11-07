import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { syntheticIntakeEnabled } from "@/server/connect-intake-mode";
import { PublicFrame } from "@/components/connect/public-frame";
import { IntakeRightsForm } from "@/components/connect/rights-form";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false},referrer:"no-referrer" as const};
export default async function RightsPage(){
 if(!syntheticIntakeEnabled())notFound();const t=await getTranslations("Intake");
 return <PublicFrame><div className="mx-auto max-w-2xl space-y-6"><h1 className="text-3xl font-semibold">{t("rightsTitle")}</h1><IntakeRightsForm/></div></PublicFrame>;
}
