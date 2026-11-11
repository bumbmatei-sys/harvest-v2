import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MessagesSquare } from "lucide-react";
import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { activeMembership } from "@/server/community-joining";
import { pageSession } from "@/server/page-session";
import { PublicFrame } from "@/components/connect/public-frame";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

// C06 member home: a welcome until the community shell and feed arrive (C09/C10).
export default async function CommunityHome({ params }: { params: Promise<{ slug: string }> }) {
  if (!communitiesEnabled()) notFound();
  const session = await pageSession("personal"), { slug } = await params;
  const community = await activeMembership(getDb(), session.user.id, slug);
  if (!community) redirect(`/communities/${encodeURIComponent(slug)}`);
  const t = await getTranslations("CommunityHome");
  return <PublicFrame personal notice={false}>
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-[28px] font-semibold tracking-tight break-words">{community.name}</h1>
        <p className="text-muted-foreground">{t("welcome")}</p>
      </header>
      <Empty className="border">
        <EmptyHeader><EmptyMedia variant="icon"><MessagesSquare aria-hidden="true" /></EmptyMedia><EmptyTitle>{t("feedSoon")}</EmptyTitle></EmptyHeader>
      </Empty>
      <div className="flex flex-wrap gap-3">
        {community.rules && <Button asChild variant="outline" className="min-h-11"><Link href={`/communities/${community.slug}`} prefetch={false}>{t("rules")}</Link></Button>}
        <Button asChild variant="outline" className="min-h-11"><Link href="/account/communities" prefetch={false}>{t("myCommunities")}</Link></Button>
      </div>
    </div>
  </PublicFrame>;
}
