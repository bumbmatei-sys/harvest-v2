import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { signInIsFresh, soleOwnerMinistries } from "@/server/account-deletion";
import { PublicFrame } from "@/components/connect/public-frame";
import { DeleteAccountForm } from "@/components/delete-account-form";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function DeleteAccount() {
  const session = await pageSession("personal");
  const blockers = await soleOwnerMinistries(getDb(), session.user.id);
  return <PublicFrame personal><div className="max-w-xl">
    <DeleteAccountForm fresh={signInIsFresh(session.session.createdAt)} blockers={blockers.map((ministry) => ({ id: ministry.id, name: ministry.name }))} />
  </div></PublicFrame>;
}
