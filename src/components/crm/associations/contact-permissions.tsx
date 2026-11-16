import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PermissionRow, type PermissionItem } from "./permission-row";

/**
 * CRM-07: one opt-in per purpose, never bundled. Each row shows the effective state from the
 * consent ledger (a withdrawal wins) and when and how it was recorded; writers record the next choice.
 */
export async function ContactPermissions({ tenantId, contactId, permissions, canGrant, canWithdraw }: { tenantId: string; contactId: string; permissions: PermissionItem[]; canGrant: boolean; canWithdraw: boolean }) {
  const t = await getTranslations("Associations");
  return <Card className="gap-3">
    <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" /><h2>{t("permissionsTitle")}</h2></CardTitle>
      <CardDescription className="text-xs">{t("permissionsDescription")}</CardDescription></CardHeader>
    <CardContent><ul className="space-y-3" aria-label={t("permissionsTitle")}>{permissions.map((item) => <PermissionRow key={item.purpose} tenantId={tenantId} contactId={contactId} item={item} canGrant={canGrant} canWithdraw={canWithdraw} />)}</ul></CardContent>
  </Card>;
}
