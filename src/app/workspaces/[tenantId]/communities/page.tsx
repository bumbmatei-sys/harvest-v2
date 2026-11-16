import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MessagesSquare } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listCommunities } from "@/server/communities";
import { communitiesEnabled } from "@/server/communities-mode";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { CommunitiesTable } from "@/components/communities/communities-table";
import { CreateCommunityDialog } from "@/components/communities/create-community-dialog";

export default async function CommunitiesPage({ params }: { params: Promise<{ tenantId: string }> }) {
  if (!communitiesEnabled()) notFound();
  const t = await getTranslations("CommunitiesPage"), session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  const communities = await listCommunities(getDb(), session.user.id, tenantId), manage = can(workspace.role, "communities:manage");
  return <div className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><MessagesSquare className="mb-4 size-5 text-muted-foreground" aria-hidden="true" /><h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1></div>
      {manage && <CreateCommunityDialog tenantId={tenantId} />}
    </div>
    <CommunitiesTable tenantId={tenantId} manage={manage} communities={communities.map(({ id, name, status, visibility }) => ({ id, name, status, visibility }))} />
  </div>;
}
