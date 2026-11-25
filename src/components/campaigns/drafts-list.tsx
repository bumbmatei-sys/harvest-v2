"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Flag } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { AccentIcon } from "@/components/accent-icon";
import { CampaignCoverPlaceholder } from "@/components/campaigns/campaign-type-art";
import { useRequest } from "@/hooks/use-request";
import { draftActions } from "@/lib/campaign-wizard-form";
import { wizardSteps } from "@/lib/campaign-wizard";
import type { campaignTypes } from "@/lib/campaigns";

export type DraftRow = { id: string; createdBy: string; name: string | null; type: typeof campaignTypes[number] | null; currentStep: number; version: number; updatedAt: string };

/**
 * The drafts a person can see: their own, or every draft in the ministry for an owner or admin. Each row opens the wizard (the creator continues,
 * anyone else reads). Discarding asks first and closes the draft; it never deletes the row.
 */
export function DraftsList({ tenantId, rows, viewerId, role, creators, canStart }: {
  tenantId: string; rows: DraftRow[]; viewerId: string; role: string; creators: Record<string, string>; canStart: boolean;
}) {
  const t = useTranslations("CampaignWizard"), types = useTranslations("CampaignWizard.types"), format = useFormatter(), request = useRequest(), router = useRouter();
  const [pending, setPending] = useState<DraftRow | null>(null), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const root = `/workspaces/${tenantId}/campaigns`;
  async function discard(row: DraftRow) {
    const result = await request(`/api${root}/drafts/${row.id}/discard`, { method: "POST", body: { version: row.version } });
    if (!result.ok) { if (result.status === 409) { setPending(null); setError(result.error); router.refresh(); return; } return result.error; }
    setPending(null); setError(""); setNotice(t("discarded")); router.refresh();
  }
  return <div className="space-y-4">
    {notice && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {rows.length ? <ItemGroup aria-label={t("draftsTitle")} className="gap-2">
      {rows.map((row) => {
        const actions = draftActions(row, viewerId, role), by = row.createdBy === viewerId ? t("you") : (creators[row.createdBy] || t("aMember"));
        return <div key={row.id} role="listitem" className="flex flex-wrap items-center gap-2">
          <Item variant="outline" asChild className="min-w-0 flex-1 basis-72">
            <Link href={`${root}/drafts/${row.id}`} className="bg-card">
              {/* The list does not load cover images: the type's artwork stands in; a draft without a type shows a neutral mark. */}
              <ItemMedia className="max-sm:hidden">{row.type ? <CampaignCoverPlaceholder type={row.type} className="aspect-[4/3] w-20 rounded-md" /> : <AccentIcon icon={Flag} size="lg" className="h-15 w-20 rounded-md" />}</ItemMedia>
              <ItemContent className="min-w-0"><ItemTitle className="max-w-full break-words">{row.name?.trim() || t("untitled")}</ItemTitle>
                <ItemDescription>{[row.type ? types(`${row.type}.label`) : null, t("startedBy", { name: by }), t("updated", { when: format.dateTime(new Date(row.updatedAt), { dateStyle: "medium", timeZone: "UTC" }) })].filter(Boolean).join(" · ")}</ItemDescription></ItemContent>
              <Badge variant="secondary">{t("stepProgress", { step: Math.min(row.currentStep, wizardSteps.length), total: wizardSteps.length })}</Badge>
              <span className="text-sm font-medium">{actions.edit ? t("continue") : t("view")}</span><ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </Item>
          {actions.discard && <Button variant="outline" className="min-h-11" onClick={() => setPending(row)} aria-label={t("discardNamed", { name: row.name?.trim() || t("untitled") })}>{t("discard")}</Button>}
        </div>;
      })}
    </ItemGroup> : <Empty className="border border-solid bg-card py-16">
      <EmptyHeader><EmptyMedia><AccentIcon icon={Flag} accent="primary" size="lg" /></EmptyMedia><EmptyTitle><h2>{t("draftsEmpty")}</h2></EmptyTitle><EmptyDescription>{t("draftsEmptyDescription")}</EmptyDescription></EmptyHeader>
      {canStart && <EmptyContent><Button asChild className="min-h-11"><Link href={`${root}/new`}>{t("newCampaign")}</Link></Button></EmptyContent>}
    </Empty>}
    <ConfirmDialog tone="destructive" open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }} title={t("discardTitle")} description={t("discardBody")}
      cancelLabel={t("discardCancel")} confirmLabel={t("discardConfirm")} onConfirm={() => pending ? discard(pending) : undefined} />
  </div>;
}
