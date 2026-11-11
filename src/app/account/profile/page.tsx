import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pageSession } from "@/server/page-session";
import { getDb } from "@/db/client";
import { getAccountProfile } from "@/server/account-profile";
import { AccountProfileForm } from "@/components/account-profile-form";
import { PublicFrame } from "@/components/connect/public-frame";
import { Button } from "@/components/ui/button";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function PersonalProfile() {
  const session = await pageSession("personal"), profile = await getAccountProfile(getDb(), session.user.id), t = await getTranslations("Invitations");
  return <PublicFrame personal><div className="space-y-6"><h1 className="text-3xl font-semibold">{t("profileTitle")}</h1><p>{profile.email}</p>
    <div className="max-w-xl"><AccountProfileForm mode="profile" initial={{ name: profile.name, locale: profile.locale, cityRegion: profile.cityRegion }} /></div>
    <Button asChild variant="outline" className="min-h-11"><Link href="/account/welcome">{t("accountHome")}</Link></Button></div></PublicFrame>;
}
