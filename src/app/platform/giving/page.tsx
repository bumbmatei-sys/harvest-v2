import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Wheat } from "lucide-react";
import { getDb } from "@/db/client";
import { optionalSession } from "@/server/page-session";
import { staffRole } from "@/server/platform/staff";
import { staffGivingOpenCount } from "@/server/platform/giving";
import { waysToGiveEnabled } from "@/server/ways-to-give-mode";
import { StaffGivingReview } from "@/components/giving/staff-giving-review";
import { Badge } from "@/components/ui/badge";

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
  return <div className="min-h-dvh bg-background">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3">{t("skip")}</a>
    <header className="border-b">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 lg:px-6">
        <p className="flex items-center gap-2 text-base font-semibold"><Wheat className="size-6" aria-hidden="true" />{t("title")}</p>
        <span className="flex flex-wrap items-center gap-2">
          {open > 0 && <Badge data-giving-open-count>{t("openBadge", { count: open })}</Badge>}
          <Badge variant="outline">{t(`roles.${role}`)}</Badge></span>
      </div>
    </header>
    <main id="main-content" tabIndex={-1} className="space-y-6 px-4 py-6 outline-none lg:px-6">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1>
      <StaffGivingReview role={role} initialOpen={open} />
    </main>
  </div>;
}
