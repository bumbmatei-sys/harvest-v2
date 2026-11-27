import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { optionalSession } from "@/server/page-session";
import { staffRole } from "@/server/platform/staff";
import { staffGivingOpenCount } from "@/server/platform/giving";
import { waysToGiveEnabled } from "@/server/ways-to-give-mode";
import { StaffGivingReview } from "@/components/giving/staff-giving-review";
import { StaffPageFrame } from "@/components/platform/staff-page-frame";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { const t = await getTranslations("WaysToGive.staff"); return { title: t("title"), robots: { index: false, follow: false } }; }

// Harvest staff only (the platform_staff role of Discover review). Everyone else gets the neutral 404 of an unknown page; nothing links here. Off with Ways to give.
export default async function StaffGivingPage() {
  if (!waysToGiveEnabled()) notFound();
  const session = await optionalSession().catch(() => null);
  if (!session) notFound();
  const role = await staffRole(getDb(), session.user.id).catch(() => null);
  if (!role) notFound();
  const t = await getTranslations("WaysToGive.staff");
  const open = await staffGivingOpenCount(getDb(), session.user.id).catch(() => 0);
  return <StaffPageFrame title={t("title")} skip={t("skip")} role={t(`roles.${role}`)} openBadge={open > 0 ? t("openBadge", { count: open }) : null} openMarker={{ "data-giving-open-count": "" }}>
    <StaffGivingReview role={role} initialOpen={open} />
  </StaffPageFrame>;
}
