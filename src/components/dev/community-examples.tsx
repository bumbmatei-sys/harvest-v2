"use client";
import { useTranslations } from "next-intl";
import { DiscoverCard } from "@/components/communities/discover-card";
import { MemberList } from "@/components/communities/member-list";
import { PostCard } from "@/components/forum/post-card";

/** Synthetic fixtures only: sample strings, no records, no requests (likes are switched off, so no request can be sent). */
export function CommunityExamples() {
  const t = useTranslations("UiShowcase.communities");
  return <div className="space-y-6" data-example-communities>
    <div className="space-y-2"><h3 className="text-sm font-medium">{t("membersTitle")}</h3>
      <MemberList label={t("membersLabel")} audience="manage" unnamedLabel={t("unnamed")} members={[
        { id: "m1", name: t("ownerName"), role: "owner", status: "active" }, { id: "m2", name: t("moderatorName"), role: "moderator", status: "active" },
        { id: "m3", name: t("memberName"), role: "member", status: "pending" }]} /></div>
    <div className="space-y-2"><h3 className="text-sm font-medium">{t("discoverTitle")}</h3>
      <ul className="grid gap-4 sm:grid-cols-2">
        <li><DiscoverCard item={{ id: "d1", slug: "example", name: t("communityName"), tagline: t("tagline"), hostName: t("hostName"), admission: ["open"] }} /></li>
        <li><DiscoverCard item={{ id: "d2", slug: "example-2", name: t("communityName2"), tagline: null, hostName: t("hostName"), admission: ["apply"] }} /></li></ul></div>
    <div className="space-y-2"><h3 className="text-sm font-medium">{t("postTitle")}</h3>
      <PostCard slug="example" category={{ name: t("category"), emoji: null }} post={{ id: "p1", title: t("postHeading"), excerpt: t("postExcerpt"), authorName: t("ownerName"), createdAt: new Date("2026-01-01T00:00:00Z"),
        likes: 3, comments: 2, liked: false, likesOff: true, coverFileId: null, hasVideo: false, held: false, pinned: true }} /></div>
  </div>;
}
