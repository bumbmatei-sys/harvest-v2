import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { getPublicCommunity } from "@/server/community-joining";
import { optionalSession } from "@/server/page-session";
import { PublicFrame } from "@/components/connect/public-frame";
import { CommunityJoinCard } from "@/components/communities/join-card";
import { JoinDialog } from "@/components/communities/join-dialog";

// C05: resolved per request through the published-only definer, so unpublishing or hiding takes effect at once.
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ invite?: string }> };

export async function generateMetadata({ params, searchParams }: Props) {
  if (!communitiesEnabled()) return {};
  const community = await getPublicCommunity(getDb(), (await params).slug, (await searchParams).invite);
  // Only Listed communities may be indexed; unlisted, hidden and missing ones never are.
  if (!community) return { robots: { index: false, follow: false } };
  return { title: community.name, description: community.tagline ?? undefined, referrer: "no-referrer",
    robots: community.visibility === "listed" && !community.invited ? undefined : { index: false, follow: false } };
}

export default async function CommunityPage({ params, searchParams }: Props) {
  if (!communitiesEnabled()) notFound();
  const { slug } = await params, { invite } = await searchParams;
  const community = await getPublicCommunity(getDb(), slug, invite);
  if (!community) notFound();
  const session = await optionalSession(), t = await getTranslations("CommunityPage");
  const invited = community.invited ? invite : undefined, canJoin = Boolean(invited) || community.allowOpen;
  const back = `/communities/${community.slug}${invited ? `?invite=${invited}` : ""}`;
  return <PublicFrame personal notice={false}>
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="min-w-0 space-y-6">
        <header className="space-y-2">
          <h1 className="text-[28px] font-semibold tracking-tight break-words">{community.name}</h1>
          {community.tagline && <p className="text-muted-foreground break-words">{community.tagline}</p>}
        </header>
        {community.description && <p className="max-w-prose whitespace-pre-line break-words">{community.description}</p>}
        {community.rules && <details className="rounded-md border px-4">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">{t("rules")}</summary>
          <p className="pb-4 text-sm whitespace-pre-line break-words">{community.rules}</p>
        </details>}
      </section>
      <aside className="min-w-0">
        <CommunityJoinCard name={community.name} tagline={null} host={community.hostName}
          action={canJoin ? <JoinDialog slug={community.slug} name={community.name} rules={community.rules} rulesVersion={community.rulesVersion} invite={invited}
            signedIn={Boolean(session)} signInHref={`/sign-in?personal=1&next=${encodeURIComponent(back)}`} />
            : <p className="text-sm text-muted-foreground">{t("closed")}</p>} />
      </aside>
    </div>
  </PublicFrame>;
}
