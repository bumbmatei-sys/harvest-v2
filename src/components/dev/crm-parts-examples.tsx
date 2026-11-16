"use client";
import { useTranslations } from "next-intl";
import { CopyButton } from "@/components/copy-button";
import { RowSummary } from "@/components/crm/list-row-summary";
import { StatusTracker } from "@/components/status-tracker";

const steps = ["first", "second", "third", "fourth"] as const;

/** Synthetic fixtures only: sample strings, no records, no requests. */
export function CrmPartsExamples() {
  const t = useTranslations("UiShowcase.crm");
  const list = steps.map(id => ({ id, label: t(`steps.${id}`) }));
  return <div className="space-y-6">
    <div className="space-y-2" data-example-tracker><h3 className="text-sm font-medium">{t("trackerTitle")}</h3>
      <StatusTracker steps={list} current="second" label={t("trackerLabel")} />
      <StatusTracker steps={list} current="fourth" tone="success" label={t("trackerWonLabel")} />
      <StatusTracker steps={[...list.slice(0, 3), { id: "lost", label: t("steps.lost") }]} current="lost" tone="danger" label={t("trackerLostLabel")} />
    </div>
    <div className="space-y-2" data-example-copy><h3 className="text-sm font-medium">{t("copyTitle")}</h3>
      <p className="flex items-center gap-1 text-sm"><span>{t("sampleEmail")}</span><CopyButton value={t("sampleEmail")} label={t("copyLabel")} /></p>
    </div>
    <div className="space-y-2"><h3 className="text-sm font-medium">{t("summaryTitle")}</h3>
      <div className="@container max-w-xs rounded-lg border p-3" data-example-summary><p className="text-sm font-medium">{t("sampleName")}</p>
        <RowSummary indent="" data={{ status: { text: t("sampleStatus"), tone: "success" }, links: [{ kind: "email", text: t("sampleEmail"), href: "#" }, { kind: "phone", text: t("samplePhone"), href: "#" }] }} /></div>
    </div>
  </div>;
}
