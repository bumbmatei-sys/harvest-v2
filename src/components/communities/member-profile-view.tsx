/** Layout and behaviour modelled on bumbmatei-sys/Admin-dashboard (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/dashboard/(auth)/pages/profile/page.tsx, components/profile-card.tsx, components/latest-activity.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { LayoutList, MessageSquareReply } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MemberSummary } from "@/components/communities/chat/member-profile-sheet";
import { MemberProfileSettings } from "@/components/communities/member-profile-settings";
import type { NotificationPrefs } from "@/lib/notifications";
import type { MemberProfile } from "@/server/community-member-profile";
import { cn } from "@/lib/utils";

/**
 * The member profile page: the shared summary with post and reply counts on the left, the latest activity on the right and, on one's own
 * profile, a Settings tab. Which person and which activity may appear was decided by the server projection; this only lays it out.
 */
export async function MemberProfileView({ profile, tab, chat, prefs, acceptMembers, me }: {
  profile: MemberProfile; tab: "activity" | "settings"; chat: boolean; prefs: NotificationPrefs; acceptMembers: boolean | null; me: string;
}) {
  const t = await getTranslations("CommunityProfile"), forum = await getTranslations("CommunityForum"), format = await getFormatter();
  const { context, member, self } = profile, name = member.name.trim() || forum("unnamed"), base = `/communities/${context.slug}/members/${encodeURIComponent(member.userId)}`;
  const person = { userId: member.userId, name, role: member.role, joinedAt: member.joinedAt ? new Date(member.joinedAt).toISOString() : null };
  const tabs = [{ id: "activity", href: base, label: t("activity") }, ...(self ? [{ id: "settings", href: `${base}?tab=settings`, label: t("settings") }] : [])];
  return <section className="min-w-0 space-y-4 p-4 lg:space-y-6 lg:p-6" aria-labelledby="profile-title">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="profile-title" className="text-xl font-semibold">{self ? t("yourProfile") : t("profile")}</h2>
      <Button asChild variant="outline" className="min-h-11"><Link href={`/communities/${context.slug}/members`} prefetch={false}>{t("backToMembers")}</Link></Button>
    </div>
    {self && <nav aria-label={t("sections")} className="flex gap-1 border-b">
      {tabs.map((item) => <Link key={item.id} href={item.href} prefetch={false} aria-current={tab === item.id ? "page" : undefined}
        className={cn("flex min-h-11 items-center border-b-2 px-3 text-sm", tab === item.id ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{item.label}</Link>)}
    </nav>}
    <div className="grid gap-4 lg:gap-6 xl:grid-cols-3">
      <div className="space-y-4 lg:space-y-6 xl:col-span-1">
        <Card><CardContent className="space-y-8">
          <MemberSummary person={person} message={chat ? { slug: context.slug, me } : undefined} />
          <dl className="grid grid-cols-2 divide-x rounded-md border bg-muted text-center *:py-3">
            <div><dd className="text-lg font-semibold">{format.number(profile.posts)}</dd><dt className="text-sm text-muted-foreground">{t("posts")}</dt></div>
            <div><dd className="text-lg font-semibold">{format.number(profile.replies)}</dd><dt className="text-sm text-muted-foreground">{t("replies")}</dt></div>
          </dl>
        </CardContent></Card>
      </div>
      <div className="space-y-4 lg:space-y-6 xl:col-span-2">
        {tab === "settings" && self ? <MemberProfileSettings slug={context.slug} prefs={prefs} acceptMembers={acceptMembers} /> :
        <Card>
          <CardHeader><CardTitle>{t("latestActivity")}</CardTitle></CardHeader>
          <CardContent>
            {profile.activity.length === 0 ? <EmptyState icon={LayoutList} title={t("noActivity")} size="compact" /> :
            <ol className="relative ms-3 border-s">
              {profile.activity.map((item) => <li key={`${item.kind}:${item.id}`} className="ms-6 pb-6 last:pb-0">
                <span className="absolute -start-3 flex size-6 items-center justify-center rounded-full border bg-muted">
                  {item.kind === "post" ? <LayoutList className="size-3 text-primary" aria-hidden="true" /> : <MessageSquareReply className="size-3 text-primary" aria-hidden="true" />}</span>
                <h3 className="flex flex-wrap items-center gap-2 font-semibold"><Link href={`/communities/${context.slug}/posts/${item.postId}`} prefetch={false} className="min-h-11 content-center break-words hover:underline">{item.postTitle}</Link>
                  <Badge variant="outline">{t(item.kind === "post" ? "kindPost" : "kindReply")}</Badge></h3>
                <time dateTime={item.createdAt} className="text-sm text-muted-foreground">{format.dateTime(new Date(item.createdAt), { dateStyle: "medium" })}</time>
                {item.excerpt && <p className="mt-1 text-sm break-words text-muted-foreground">{item.excerpt}</p>}
              </li>)}
            </ol>}
            {(profile.page > 1 || profile.hasMore) && <nav aria-label={t("pages")} className="mt-4 flex gap-2">
              {profile.page > 1 && <Button asChild variant="outline" className="min-h-11"><Link href={profile.page === 2 ? base : `${base}?page=${profile.page - 1}`} prefetch={false}>{t("newer")}</Link></Button>}
              {profile.hasMore && <Button asChild variant="outline" className="min-h-11"><Link href={`${base}?page=${profile.page + 1}`} prefetch={false}>{t("older")}</Link></Button>}
            </nav>}
          </CardContent>
        </Card>}
      </div>
    </div>
  </section>;
}
