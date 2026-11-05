import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getProfile } from "@/server/profile";
import { listWorkspaces } from "@/server/workspaces";
import { AppShell } from "@/components/app-shell";
import { ProfileForm } from "@/components/profile-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default async function ProfilePage() {
  const session = await pageSession(), db = getDb(), t = await getTranslations("Profile");
  const [profile, workspaces] = await Promise.all([getProfile(db, session.user.id), listWorkspaces(db, session.user.id)]);
  return <AppShell defaultOpen={(await cookies()).get("sidebar_state")?.value !== "false"} workspaces={workspaces} email={session.user.email}>
    <div className="mx-auto max-w-xl space-y-7"><h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1>
      <Card><CardHeader><CardTitle>{t("preferences")}</CardTitle><CardDescription>{profile.email}</CardDescription></CardHeader><CardContent><ProfileForm current={profile.locale} /></CardContent></Card>
    </div>
  </AppShell>;
}
