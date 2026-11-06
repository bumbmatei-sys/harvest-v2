import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Kanban } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listPipelines } from "@/server/crm-deals";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { PipelineSettings } from "@/components/crm/deals/pipeline-settings";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Deals");
  return { title: t("pageTitle", { page: t("pipelineSettings") }) };
}

export default async function PipelineSettingsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const t = await getTranslations("Deals");
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const result = await Promise.all([getWorkspace(getDb(), session.user.id, tenantId), listPipelines(getDb(), session.user.id, tenantId, { includeArchived: true })])
    .catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!result) return <AccessState />;
  const [workspace, pipelines] = result, writable = can(workspace.role, "crm:pipelines_write");
  return <div className="space-y-4">
    <div><div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground"><Kanban className="size-3.5" aria-hidden="true" />{t("crm")}</div>
      <h1 className="text-[28px] font-semibold tracking-tight">{t("pipelineSettings")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("pipelineSettingsDescription")}</p></div>
    {!writable && <Alert><AlertDescription>{t("viewOnlyPipelineSettings")}</AlertDescription></Alert>}
    {pipelines.length ? <PipelineSettings tenantId={tenantId} pipelines={pipelines} writable={writable} />
      : <Empty className="min-h-[240px] border border-solid bg-card p-7 sm:p-10"><EmptyHeader><EmptyMedia variant="icon"><Kanban aria-hidden="true" /></EmptyMedia><EmptyTitle><h2>{t("noPipelineYet")}</h2></EmptyTitle><EmptyDescription>{t("noPipelineYetHelp")}</EmptyDescription></EmptyHeader></Empty>}
  </div>;
}
