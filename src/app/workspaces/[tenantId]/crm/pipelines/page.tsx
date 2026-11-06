import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DealsPage } from "@/components/crm/deals/deals-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Deals");
  return { title: t("pageTitle", { page: t("pipelines") }) };
}
export default async function PipelinesPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tenantId } = await params;
  return <DealsPage tenantId={tenantId} pipelineId={null} searchParams={await searchParams} />;
}
