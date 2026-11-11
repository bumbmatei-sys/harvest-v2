import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getAccountProfile } from "@/server/account-profile";
import { safeSourcePath } from "@/server/connect-invitations";
import { PublicFrame } from "@/components/connect/public-frame";
import { AccountProfileForm } from "@/components/account-profile-form";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function Onboarding({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const session = await pageSession("personal"), profile = await getAccountProfile(getDb(), session.user.id), t = await getTranslations("AccountProfile");
  const source = safeSourcePath((await searchParams).from);
  return <PublicFrame personal><div className="mx-auto max-w-xl space-y-6"><h1 className="text-3xl font-semibold">{t("onboardingTitle")}</h1>
    <AccountProfileForm mode="onboarding" initial={{ name: profile.name, locale: profile.locale, cityRegion: profile.cityRegion }} from={source === "/resources/start" ? undefined : source} />
  </div></PublicFrame>;
}
