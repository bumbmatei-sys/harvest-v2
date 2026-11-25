import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Compass } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { AccessError } from "@/server/permissions";
import { discoverGateOpen, discoverRouteDeps } from "@/server/discover/gate";
import { listMyListings } from "@/server/discover/owner";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { BrowseDiscoverLink, MyListings } from "@/components/discover/my-listings";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { const t = await getTranslations("DiscoverScreens"); return { title: t("owner.title") }; }

// Public > Discover: the ministry's own listings. Owners and admins only (the server answers the neutral 404 to anyone else); hard-off with the rest of Discover.
export default async function DiscoverManagePage({ params }: { params: Promise<{ tenantId: string }> }) {
  if (!discoverGateOpen()) notFound();
  const t = await getTranslations("DiscoverScreens"), session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const listings = await listMyListings(getDb(), session.user.id, tenantId, discoverRouteDeps()).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!listings) return <AccessState />;
  return <div className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><Compass className="mb-4 size-5 text-muted-foreground" aria-hidden="true" /><h1 className="text-[28px] font-semibold tracking-tight">{t("owner.title")}</h1></div>
      <BrowseDiscoverLink />
    </div>
    <MyListings tenantId={tenantId} initial={listings.items} canEdit />
  </div>;
}
