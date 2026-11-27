import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { optionalSession } from "@/server/page-session";
import { AcceptInvitation } from "@/components/campaigns/accept-invitation";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("CampaignInvitation"))("pageTitle"), robots: { index: false, follow: false } };
}

// The link a person receives for a campaign department. They sign in first (the invitation is for one account), then accept.
export default async function CampaignInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notFound();
  const session = await optionalSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/campaign-invitations/${token}`)}`);
  return <main id="main-content" className="mx-auto flex min-h-dvh w-full max-w-lg items-center pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]"><AcceptInvitation token={token} email={session.user.email} /></main>;
}
