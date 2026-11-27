import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { optionalSession } from "@/server/page-session";
import { staffRole } from "@/server/platform/staff";
import { staffCommunityOpenCount } from "@/server/community-takedown";
import { communitiesEnabled } from "@/server/communities-mode";
import { StaffPageFrame } from "@/components/platform/staff-page-frame";
import { StaffCommunityReview } from "@/components/communities/staff-community-review";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { const t = await getTranslations("CommunityTakedown.staff"); return { title: t("title"), robots: { index: false, follow: false } }; }

// Harvest staff only (the platform_staff role of Discover review). Everyone else gets the neutral 404 of an unknown page; nothing links here. Off with Communities.
export default async function StaffCommunitiesPage() {
  if (!communitiesEnabled()) notFound();
  const session = await optionalSession().catch(() => null);
  if (!session) notFound();
  const role = await staffRole(getDb(), session.user.id).catch(() => null);
  if (!role) notFound();
  const t = await getTranslations("CommunityTakedown.staff");
  const open = await staffCommunityOpenCount(getDb(), session.user.id).catch(() => 0);
  return <StaffPageFrame title={t("title")} skip={t("skip")} role={t(`roles.${role}`)} openBadge={open > 0 ? t("openBadge", { count: open }) : null} openMarker={{ "data-community-open-count": "" }}>
    <StaffCommunityReview role={role} initialOpen={open} />
  </StaffPageFrame>;
}
