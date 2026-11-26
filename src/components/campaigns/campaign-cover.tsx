"use client";
import { useEventCoverUrl } from "@/components/events/use-event-cover-url";

/**
 * The campaign's cover image or logo, when it has one, from the campaign's signed cover route. A campaign without a cover shows nothing here for now:
 * this is the slot the type-art placeholder (CampaignCoverPlaceholder) takes when that lands. The picture sits on the muted surface token with a
 * theme border, so it has no light edge in a dark theme while it loads or if it fails.
 */
export function CampaignCover({ tenantId, campaignId, coverFileId, alt }: { tenantId: string; campaignId: string; coverFileId: string | null; alt: string }) {
  const cover = useEventCoverUrl(`/api/workspaces/${tenantId}/campaigns/${campaignId}`, coverFileId);
  if (!coverFileId) return null;
  return <div data-slot="campaign-cover" className="aspect-[3/1] max-h-64 w-full overflow-hidden rounded-xl border bg-muted">
    {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed storage address, not a static asset */}
    {cover.url && <img src={cover.url} alt={alt} onError={cover.failed} className="size-full object-cover" />}
  </div>;
}
