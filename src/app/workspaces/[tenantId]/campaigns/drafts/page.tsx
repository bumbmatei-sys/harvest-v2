import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listDrafts } from "@/server/campaign-wizard";
import { listWizardMembers } from "@/server/campaign-wizard-members";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { Button } from "@/components/ui/button";
import { DraftsList } from "@/components/campaigns/drafts-list";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("CampaignWizard"))("draftsPageTitle") };
}

export default async function CampaignDraftsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const t = await getTranslations("CampaignWizard"), session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) notFound();
  const db = getDb(), denied = (error: unknown) => { if (error instanceof AccessError) return null; throw error; };
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch(denied);
  if (!workspace) notFound();
  const result = await listDrafts(db, session.user.id, tenantId).catch(denied);
  if (!result) notFound();
  const members = (await listWizardMembers(db, session.user.id, tenantId).catch(denied)) ?? [];
  const manager = workspace.role === "owner" || workspace.role === "admin", canStart = can(workspace.role, "campaigns:write");
  return <div className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-[28px] font-semibold tracking-tight">{t("draftsTitle")}</h1><p className="mt-1 text-sm text-muted-foreground">{t(manager ? "draftsAll" : "draftsMine")}</p></div>
      {canStart && <Button asChild className="min-h-11"><Link href={`/workspaces/${tenantId}/campaigns/new`}>{t("newCampaign")}</Link></Button>}
    </div>
    <DraftsList tenantId={tenantId} viewerId={session.user.id} role={workspace.role} canStart={canStart} creators={Object.fromEntries(members.map((member) => [member.id, member.name]))}
      rows={result.drafts.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))} />
  </div>;
}
