import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DealsPage } from "@/components/crm/deals/deals-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Deals");
  return { title: t("pageTitle", { page: t("pipelines") }) };
}
export default async function PipelinePage({ params, searchParams }: { params: Promise<{ tenantId: string; pipelineId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tenantId, pipelineId } = await params;
  return <DealsPage tenantId={tenantId} pipelineId={pipelineId} searchParams={await searchParams} />;
}
