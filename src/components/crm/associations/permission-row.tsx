import { getFormatter, getTranslations } from "next-intl/server";
import { ConsentForm } from "@/components/consent-form";
import { PermissionCard } from "@/components/permission-card";
import { Button } from "@/components/ui/button";
import { permissionPreset, rowActions, type PermissionPurpose } from "@/lib/consent-controls";
import { defineStatusTones } from "@/lib/status-tone";

export type PermissionItem = { purpose: Exclude<PermissionPurpose, "outreach_follow_up">; status: "granted" | "withdrawn" | "none"; at: string | null; source: string | null; channel: "email" | "sms" | "social" | null };
const tone = defineStatusTones({ granted: "success", withdrawn: "warning", none: "neutral" });

/**
 * One purpose of a contact's consent ledger as a PermissionCard, with the record opt-in and withdrawal buttons the role may use.
 * Shared by the person page (every purpose) and the follow-up case (the follow-up purpose only), so the controls cannot drift apart.
 */
export async function PermissionRow({ tenantId, contactId, item, canGrant, canWithdraw }: {
  tenantId: string; contactId: string; item: PermissionItem; canGrant: boolean; canWithdraw: boolean;
}) {
  const t = await getTranslations("Associations");
  const format = await getFormatter();
  const actions = rowActions(item.status, { canGrant, canWithdraw });
  return <PermissionCard as="li" label={t(`purposes.${item.purpose}`)} status={{ tone: tone(item.status), label: t(`status.${item.status}`) }}
    description={t(`purposeHelp.${item.purpose}`)}
    meta={item.at ? t(item.status === "withdrawn" ? "withdrawnOn" : "grantedOn", { date: format.dateTime(new Date(item.at), "date"), source: item.source ?? t("unknownSource") }) : undefined}
    actions={actions.length > 0 ? actions.map((status) => <ConsentForm key={status} tenantId={tenantId} contactId={contactId} statuses={[status]} preset={permissionPreset(item.purpose, item, status)}
      trigger={<Button type="button" variant="outline" size="sm" className="min-h-11 lg:min-h-8" aria-label={t(status === "withdrawn" ? "recordWithdrawalFor" : "recordOptInFor", { purpose: t(`purposes.${item.purpose}`) })}>
        {t(status === "withdrawn" ? "recordWithdrawal" : "recordOptIn")}</Button>} />) : undefined} />;
}
