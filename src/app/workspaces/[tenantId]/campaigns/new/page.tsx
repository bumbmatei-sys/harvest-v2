import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { Button } from "@/components/ui/button";
import { AccessState } from "@/components/access-state";
import { StartCampaign } from "@/components/campaigns/start-campaign";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("CampaignWizard"))("newPageTitle") };
}

export default async function NewCampaignPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const t = await getTranslations("CampaignWizard"), session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) notFound();
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) notFound();
  if (!can(workspace.role, "campaigns:write")) return <AccessState href={`/workspaces/${tenantId}/campaigns`} />;
  return <div className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("newTitle")}</h1>
      <Button variant="outline" asChild className="min-h-11"><Link href={`/workspaces/${tenantId}/campaigns/drafts`}>{t("drafts")}</Link></Button>
    </div>
    <StartCampaign tenantId={tenantId} />
  </div>;
}
