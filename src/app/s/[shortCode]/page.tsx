import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PublicFrame } from "@/components/connect/public-frame";
import { LandingContent } from "@/components/connect/landing-view";
import { findLandingByShortCode } from "@/server/connect-public";

// HC-03 short URL: the same landing, rendered directly (no redirect hop on slow connections).
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("Connect");
  return { title: t("landingMetaTitle"), description: t("freeNotice"), robots: { index: false, follow: false } };
}

export default async function ShortLinkLanding({ params }: { params: Promise<{ shortCode: string }> }) {
  const landing = await findLandingByShortCode((await params).shortCode);
  if (!landing) notFound();
  return <PublicFrame><LandingContent landing={landing} /></PublicFrame>;
}
