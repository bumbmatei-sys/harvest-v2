import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { signInIsFresh, soleOwnerMinistries } from "@/server/account-deletion";
import { PublicFrame } from "@/components/connect/public-frame";
import { DeleteAccountForm } from "@/components/delete-account-form";
import { FormSection } from "@/components/form-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

const kept = ["keptPosts", "keptAudit", "keptMinistry"] as const;
const removed = ["removedProfile", "removedDms", "removedCourses", "removedMemberships", "removedConnections", "removedSessions"] as const;

export default async function DeleteAccount() {
  const session = await pageSession("personal"), t = await getTranslations("YourData");
  const blockers = await soleOwnerMinistries(getDb(), session.user.id);
  return <PublicFrame personal><div className="max-w-xl space-y-6">
    <h1 className="text-3xl font-semibold">{t("deleteTitle")}</h1>
    <FormSection title={t("removedTitle")}><ul className="list-disc space-y-1 pl-5 text-sm">{removed.map((key) => <li key={key}>{t(key)}</li>)}</ul></FormSection>
    <FormSection title={t("keptTitle")}><ul className="list-disc space-y-1 pl-5 text-sm">{kept.map((key) => <li key={key}>{t(key)}</li>)}</ul></FormSection>
    {blockers.length > 0
      ? <div className="space-y-4"><Alert variant="destructive" role="alert"><AlertTitle>{t("soleOwnerTitle")}</AlertTitle>
          <AlertDescription><p>{t("soleOwnerBody")}</p><ul className="mt-2 list-disc pl-5">{blockers.map((ministry) => <li key={ministry.id}>{ministry.name}</li>)}</ul></AlertDescription></Alert>
          <Button asChild variant="outline" className="min-h-11"><Link href="/account/profile">{t("cancel")}</Link></Button></div>
      : <DeleteAccountForm fresh={signInIsFresh(session.session.createdAt)} />}
  </div></PublicFrame>;
}
