import { getFormatter, getTranslations } from "next-intl/server";
import { ConsentForm } from "@/components/consent-form";
import { PermissionCard } from "@/components/permission-card";
import { Button } from "@/components/ui/button";
import { permissionPreset, rowActions } from "@/lib/consent-controls";
import { consentTone } from "@/lib/crm-consent-tone";

export type FollowUpConsentEvent = { channel: "email" | "sms" | "social" | null; status: "granted" | "withdrawn" | "unknown"; occurredAt: Date; source: string | null };
const channels = ["email", "sms", "social"] as const;

/**
 * Follow-up consent for the person on a case, one card per channel that has a record (or one "none" card), from the CRM ledger's
 * effective events. Display first: the record buttons appear only for the roles that may use them (grant: attest, withdrawal: record), through the same
 * consent dialog and permission helpers as the person page. Recording here changes the ledger, never the case, and sends nothing.
 */
export async function FollowUpConsent({ tenantId, contactId, events, canGrant, canWithdraw }: {
  tenantId: string; contactId: string; events: FollowUpConsentEvent[]; canGrant: boolean; canWithdraw: boolean;
}) {
  const t = await getTranslations("FollowUp");
  const labels = await getTranslations("ConsentLabels");
  const assoc = await getTranslations("Associations");
  const format = await getFormatter();
  const recorded = channels.map((channel) => ({ channel, event: events.find((entry) => entry.channel === channel) })).filter((entry) => entry.event && entry.event.status !== "unknown");
  const rows = recorded.length ? recorded : [{ channel: "email" as const, event: undefined }];
  return <ul aria-label={t("consentTitle")} className="space-y-3">{rows.map(({ channel, event }) => {
    const state = event?.status === "granted" || event?.status === "withdrawn" ? event.status : "none" as const;
    const actions = rowActions(state, { canGrant, canWithdraw });
    return <PermissionCard as="li" key={channel} label={t("consentChannel", { channel: labels(channel) })} status={{ tone: consentTone(state), label: assoc(`status.${state}`) }}
      meta={event ? assoc(state === "withdrawn" ? "withdrawnOn" : "grantedOn", { date: format.dateTime(event.occurredAt, "date"), source: event.source || assoc("unknownSource") }) : undefined}
      actions={actions.length ? actions.map((status) => <ConsentForm key={status} tenantId={tenantId} contactId={contactId} statuses={[status]} preset={permissionPreset("outreach_follow_up", { status: state, channel }, status)}
        trigger={<Button type="button" variant="outline" size="sm" className="min-h-11 lg:min-h-8" aria-label={assoc(status === "withdrawn" ? "recordWithdrawalFor" : "recordOptInFor", { purpose: t("consentChannel", { channel: labels(channel) }) })}>
          {assoc(status === "withdrawn" ? "recordWithdrawal" : "recordOptIn")}</Button>} />) : undefined} />;
  })}</ul>;
}
