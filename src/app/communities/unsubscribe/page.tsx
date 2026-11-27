import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { communitiesEnabled } from "@/server/communities-mode";
import { PublicFrame } from "@/components/connect/public-frame";
import { UnsubscribeConfirm } from "@/components/communities/unsubscribe-confirm";

// C15c: the confirmation page the email footer links to. It reads nothing on the server and changes nothing on GET:
// the token is in the URL fragment and is posted only when the person confirms. No sign-in, no personal data.
export async function generateMetadata(): Promise<Metadata> {
  if (!communitiesEnabled()) return {};
  return { title: (await getTranslations("CommunityUnsubscribe"))("metaTitle"), referrer: "no-referrer", robots: { index: false, follow: false } };
}

export default function CommunityUnsubscribePage() {
  if (!communitiesEnabled()) notFound();
  return <PublicFrame personal notice={false}><UnsubscribeConfirm /></PublicFrame>;
}
