"use client";
import { errorMessage } from "@/i18n/messages";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";

export function EraseContact({ tenantId, contactId }: { tenantId: string; contactId: string }) {
  const t = useTranslations("ComponentsEraseContact");
  const router = useRouter();
  /** Returns a message to keep the dialog open, or nothing once the contact is erased. */
  async function erase(): Promise<string | void> {
    try {
      const response = await fetch(`/api/workspaces/${tenantId}/contacts/${contactId}/erase`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "erase" }),
      });
      if (response.status === 401) { router.replace("/sign-in"); return; }
      if (!response.ok) return errorMessage((await response.json()).error) ?? t("couldNotEraseThisContactTryAgain");
      router.replace(`/workspaces/${tenantId}/crm/people`); router.refresh();
    } catch { return t("couldNotConnectPleaseTryAgain"); }
  }
  return <ConfirmDialog tone="destructive" title={t("eraseThisContact")} description={t("thisPermanentlyRemovesTheirNameIdentifiersNotesAnd")}
    confirmLabel={t("erasePersonalData")} busyLabel={t("erasing")} cancelLabel={t("cancel")} onConfirm={erase}
    trigger={<Button variant="ghost" size="sm" className="text-destructive"><Trash2 aria-hidden="true" />{t("eraseContact")}</Button>} />;
}
