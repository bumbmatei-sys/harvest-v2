import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Flag } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { getDraft } from "@/server/campaign-wizard";
import { listWizardMembers } from "@/server/campaign-wizard-members";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { CampaignWizard } from "@/components/campaigns/campaign-wizard";
import type { DraftView } from "@/lib/campaign-wizard-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("CampaignWizard"))("pageTitle") };
}

export default async function CampaignDraftPage({ params }: { params: Promise<{ tenantId: string; draftId: string }> }) {
  const t = await getTranslations("CampaignWizard"), session = await pageSession(), { tenantId, draftId } = await params;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(draftId).success) notFound();
  const db = getDb(), denied = (error: unknown) => { if (error instanceof AccessError) return null; throw error; };
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch(denied);
  const draft = workspace ? await getDraft(db, session.user.id, tenantId, draftId).catch(denied) : null;
  if (!workspace || !draft) notFound();
  const root = `/workspaces/${tenantId}/campaigns`;
  if (draft.status !== "draft") {
    // A finished draft is a campaign; a discarded one is closed. Neither is edited again.
    return <Empty className="border border-solid bg-card py-16"><EmptyHeader><EmptyMedia variant="icon"><Flag aria-hidden="true" /></EmptyMedia>
      <EmptyTitle><h1>{t(draft.status === "finished" ? "closed.finished" : "closed.discarded")}</h1></EmptyTitle></EmptyHeader>
      <EmptyContent><Button asChild className="min-h-11"><Link href={draft.status === "finished" && draft.campaignId ? `${root}/${draft.campaignId}` : `${root}/drafts`}>{draft.status === "finished" ? t("openCampaign") : t("draftBack")}</Link></Button></EmptyContent></Empty>;
  }
  const members = (await listWizardMembers(db, session.user.id, tenantId).catch(denied)) ?? [];
  const manager = workspace.role === "owner" || workspace.role === "admin", mine = draft.createdBy === session.user.id;
  const ownerName = mine ? (members.find((member) => member.id === session.user.id)?.name ?? session.user.name ?? "") : (members.find((member) => member.id === draft.createdBy)?.name ?? "");
  return <CampaignWizard tenantId={tenantId} viewerId={session.user.id} ownerName={ownerName} canDiscard={mine || manager} listHref={`${root}/drafts`}
    initial={JSON.parse(JSON.stringify(draft)) as DraftView} />;
}
