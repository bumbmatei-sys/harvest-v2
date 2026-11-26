import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listGivingMethods } from "@/server/ways-to-give";
import { waysToGiveEnabled } from "@/server/ways-to-give-mode";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { WaysToGiveManager } from "@/components/giving/ways-to-give-manager";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { const t = await getTranslations("WaysToGive"); return { title: t("title") }; }

// Operations > Giving > Ways to give. Owners and admins (a collaborator with Giving at manage); everyone else gets the access state.
export default async function WaysToGivePage({ params }: { params: Promise<{ tenantId: string }> }) {
  if (!waysToGiveEnabled()) notFound();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const db = getDb(), user = session.user.id;
  const denied = (error: unknown) => { if (error instanceof AccessError) return null; throw error; };
  const workspace = await getWorkspace(db, user, tenantId).catch(denied);
  if (!workspace) return <AccessState />;
  const methods = await listGivingMethods(db, user, tenantId).catch(denied);
  if (!methods) return <AccessState />;
  return <WaysToGiveManager tenantId={tenantId} ministryName={workspace.name} initial={methods} />;
}
