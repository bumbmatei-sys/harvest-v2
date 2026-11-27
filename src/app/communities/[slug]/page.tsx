import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { getPublicCommunity } from "@/server/community-joining";
import { publicReadCharge } from "@/server/public-read-limit";
import { communityCanJoin } from "@/lib/editor-preview";
import { optionalSession } from "@/server/page-session";
import { PublicFrame } from "@/components/connect/public-frame";
import { CommunityPageView } from "@/components/communities/community-page-view";
import { JoinDialog } from "@/components/communities/join-dialog";

// C05: resolved per request through the published-only definer, so unpublishing or hiding takes effect at once.
export const dynamic = "force-dynamic";
// One per-visitor charge per request, shared by the metadata and the page. Over the limit nothing is read; a page cannot answer 429,
// so it shows a neutral notice and is never indexed.
const pageCharge = cache(async () => publicReadCharge(await headers(), "community-page"));
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ invite?: string }> };

export async function generateMetadata({ params, searchParams }: Props) {
  if (!communitiesEnabled()) return {};
  if ((await pageCharge()).limited) return { robots: { index: false, follow: false } };
  const community = await getPublicCommunity(getDb(), (await params).slug, (await searchParams).invite);
  // Only Listed communities may be indexed; unlisted, hidden and missing ones never are.
  if (!community) return { robots: { index: false, follow: false } };
  return { title: community.name, description: community.tagline ?? undefined, referrer: "no-referrer",
    robots: community.visibility === "listed" && !community.invited ? undefined : { index: false, follow: false } };
}

export default async function CommunityPage({ params, searchParams }: Props) {
  if (!communitiesEnabled()) notFound();
  const { slug } = await params, { invite } = await searchParams;
  if ((await pageCharge()).limited) return <PublicFrame personal notice={false}>
    <p role="status" className="text-sm text-muted-foreground">{(await getTranslations("CommunityPage"))("busy")}</p>
  </PublicFrame>;
  const community = await getPublicCommunity(getDb(), slug, invite);
  if (!community) notFound();
  const session = await optionalSession(), t = await getTranslations("CommunityPage");
  const invited = community.invited ? invite : undefined, canJoin = communityCanJoin({ invited: Boolean(invited), allowOpen: community.allowOpen, allowApply: community.allowApply });
  const back = `/communities/${community.slug}${invited ? `?invite=${invited}` : ""}`;
  return <PublicFrame personal notice={false}>
    <CommunityPageView data={{ name: community.name, tagline: community.tagline, description: community.description, rulesList: community.rulesList, hostName: community.hostName }}
      join={canJoin ? <JoinDialog slug={community.slug} name={community.name} rules={community.rulesList} rulesVersion={community.rulesVersion}
        questions={community.joinQuestions} questionsVersion={community.questionsVersion} apply={community.allowApply} invite={invited}
        signedIn={Boolean(session)} signInHref={`/sign-in?personal=1&next=${encodeURIComponent(back)}`} />
        : <p className="text-sm text-muted-foreground">{t("closed")}</p>} />
  </PublicFrame>;
}
