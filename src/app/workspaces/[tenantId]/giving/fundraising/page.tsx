import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { HandCoins } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listCampaigns } from "@/server/campaigns";
import { fundraisingEnabled, listFundraising } from "@/server/fundraising";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { FundraisingList } from "@/components/fundraising/fundraising-list";

export async function generateMetadata() { return { title: (await getTranslations("Fundraising"))("metaTitle") }; }

// Operations > Giving > Fundraising: owners and admins (and Giving collaborators, without giving records). Off in production.
export default async function FundraisingPage({ params }: { params: Promise<{ tenantId: string }> }) {
  if (!fundraisingEnabled()) notFound();
  const t = await getTranslations("Fundraising"), session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const db = getDb(), denied = (error: unknown) => { if (error instanceof AccessError) return null; throw error; };
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch(denied);
  if (!workspace || !can(workspace.role, "fundraising:read")) return <AccessState />;
  const rows = await listFundraising(db, session.user.id, tenantId);
  const canManage = can(workspace.role, "fundraising:manage");
  const campaigns = canManage && can(workspace.role, "campaigns:read") ? (await listCampaigns(db, session.user.id, tenantId).catch(denied))?.campaigns ?? [] : [];
  return <div className="min-w-0 space-y-6">
    <div><HandCoins className="mb-4 size-5 text-muted-foreground" aria-hidden="true" /><h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("recordOnly")}</p></div>
    <FundraisingList tenantId={tenantId} rows={rows} canManage={canManage} campaigns={campaigns.map((campaign) => ({ id: campaign.id, name: campaign.name }))} />
  </div>;
}
