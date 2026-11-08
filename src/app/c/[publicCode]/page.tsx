import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PublicFrame } from "@/components/connect/public-frame";
import { ResponseForm } from "@/components/connect/response-form";
import { readIntakeManifest } from "@/server/connect-intake";
import { getDb } from "@/db/client";
import { syntheticIntakeEnabled } from "@/server/connect-intake-mode";
import { LandingContent } from "@/components/connect/landing-view";
import { findLandingByPublicCode } from "@/server/connect-public";

// HC-03: resolved per request from the database; never statically cached, so revocation is immediate.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("Connect");
  return { title: t("landingMetaTitle"), description: t("freeNotice"), robots: { index: false, follow: false } };
}

export default async function ConnectLanding({ params }: { params: Promise<{ publicCode: string }> }) {
  const code = (await params).publicCode;
  const landing = await findLandingByPublicCode(code);
  if (!landing) notFound();
  const manifest = syntheticIntakeEnabled() && landing.source === "campaign-link" ? await readIntakeManifest(getDb(),"qr",code).catch(()=>null) : null;
  return <PublicFrame externalOffers={landing.source === "campaign-link" && Boolean(landing.definition)}><LandingContent landing={landing} responseHref={manifest?"#response-form":undefined} invitationAvailable={Boolean(manifest?.purposes.includes("account_communications"))} />{manifest&&<ResponseForm key={`${code}:${manifest.stamp}`} manifest={manifest} endpoint={`/api/public/connect/qr/${encodeURIComponent(code)}/responses`}/>}</PublicFrame>;
}
