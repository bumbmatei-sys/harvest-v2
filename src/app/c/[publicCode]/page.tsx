import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PublicFrame } from "@/components/connect/public-frame";
import { LandingContent } from "@/components/connect/landing-view";
import { findLandingByPublicCode } from "@/server/connect-public";

// HC-03: resolved per request from the database; never statically cached, so revocation is immediate.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("Connect");
  return { title: t("landingMetaTitle"), description: t("freeNotice"), robots: { index: false, follow: false } };
}

export default async function ConnectLanding({ params }: { params: Promise<{ publicCode: string }> }) {
  const landing = await findLandingByPublicCode((await params).publicCode);
  if (!landing) notFound();
  return <PublicFrame><LandingContent landing={landing} /></PublicFrame>;
}
