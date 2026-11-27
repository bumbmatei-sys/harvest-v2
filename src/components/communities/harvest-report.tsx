"use client";
import { useTranslations } from "next-intl";
import { PublicReportDialog, publicReportLabelKeys, type PublicReportLabels } from "@/components/public-report-dialog";
import { harvestReportNoteMax, harvestReportReasons } from "@/lib/community-takedown";

/** "Report" on a public community page: to Harvest staff, not the community's hosts. Any visitor, no account. */
export function CommunityHarvestReport({ slug }: { slug: string }) {
  const t = useTranslations("CommunityTakedown.report");
  const labels = Object.fromEntries(publicReportLabelKeys.map((key) => [key, t(key)])) as PublicReportLabels;
  return <PublicReportDialog url={`/api/communities/${encodeURIComponent(slug)}/harvest-report`} labels={labels} noteMax={harvestReportNoteMax} idPrefix="community-report"
    reasons={harvestReportReasons.map((value) => ({ value, label: t(`reasons.${value}`) }))} marker={{ "data-community-report": "" }} />;
}
