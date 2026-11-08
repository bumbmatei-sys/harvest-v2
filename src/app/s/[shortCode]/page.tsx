import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PublicFrame } from "@/components/connect/public-frame";
import { ResponseForm } from "@/components/connect/response-form";
import { readIntakeManifest } from "@/server/connect-intake";
import { getDb } from "@/db/client";
import { syntheticIntakeEnabled } from "@/server/connect-intake-mode";
import { LandingContent } from "@/components/connect/landing-view";
import { findLandingByShortCode } from "@/server/connect-public";

// HC-03 short URL: the same landing, rendered directly (no redirect hop on slow connections).
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("Connect");
  return { title: t("landingMetaTitle"), description: t("freeNotice"), robots: { index: false, follow: false } };
}

export default async function ShortLinkLanding({ params }: { params: Promise<{ shortCode: string }> }) {
  const code = (await params).shortCode;
  const landing = await findLandingByShortCode(code);
  if (!landing) notFound();
  const manifest = syntheticIntakeEnabled() && landing.source === "campaign-link" ? await readIntakeManifest(getDb(),"short",code).catch(()=>null) : null;
  return <PublicFrame><LandingContent landing={landing} responseHref={manifest?"#response-form":undefined} />{manifest&&<ResponseForm key={`${code}:${manifest.stamp}`} manifest={manifest} endpoint={`/api/public/connect/short/${encodeURIComponent(code)}/responses`}/>}</PublicFrame>;
}
