import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Wheat } from "lucide-react";
import { getDb } from "@/db/client";
import { discoverGateOpen } from "@/server/discover/gate";
import { optionalSession } from "@/server/page-session";
import { staffRole } from "@/server/platform/staff";
import { StaffReview } from "@/components/discover/staff-review";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { const t = await getTranslations("DiscoverScreens"); return { title: t("staff.title"), robots: { index: false, follow: false } }; }

// Harvest staff only. Everyone else (signed out, a member, a revoked reviewer) gets the same neutral 404 as an unknown page, and nothing links here. Hard-off with the rest of Discover.
// A sign-in older than 15 minutes still opens the page; the review routes answer 401 and the screen asks for a new sign-in.
export default async function StaffDiscoverPage() {
  if (!discoverGateOpen()) notFound();
  const session = await optionalSession().catch(() => null);
  if (!session) notFound();
  const role = await staffRole(getDb(), session.user.id).catch(() => null);
  if (!role) notFound();
  const t = await getTranslations("DiscoverScreens");
  return <div className="min-h-dvh bg-background">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3">{t("staff.skip")}</a>
    <header className="border-b">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 lg:px-6">
        <p className="flex items-center gap-2 text-base font-semibold"><Wheat className="size-6" aria-hidden="true" />{t("staff.title")}</p>
        <Badge variant="outline">{t("staff.role", { role: t(`staff.roles.${role}`) })}</Badge>
      </div>
    </header>
    <main id="main-content" tabIndex={-1} className="space-y-6 px-4 py-6 outline-none lg:px-6">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("staff.title")}</h1>
      <StaffReview role={role} />
    </main>
  </div>;
}
