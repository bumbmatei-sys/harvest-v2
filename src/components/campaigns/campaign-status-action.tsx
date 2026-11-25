"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useRequest } from "@/hooks/use-request";

/**
 * Activate, or return to draft, for owners and admins. State only: the server flips the campaign's status and nothing is published, sent or created.
 * A campaign without its place, dates and time zone is refused (409) and the screen says what to add.
 */
export function CampaignStatusAction({ tenantId, campaignId, status }: { tenantId: string; campaignId: string; status: "draft" | "active" }) {
  const t = useTranslations("CampaignWizard.activate"), request = useRequest(), router = useRouter();
  const [open, setOpen] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const target = status === "draft" ? "active" : "draft";
  async function change() {
    const result = await request(`/api/workspaces/${tenantId}/campaigns/${campaignId}/status`, { method: "POST", body: { status: target } });
    if (result.ok) { setOpen(false); setError(""); setNotice(t(target === "active" ? "ok" : "backOk")); router.refresh(); return; }
    setOpen(false); setNotice(""); setError(result.status === 409 && result.details?.issues ? t("notReady") : result.error);
  }
  return <div className="space-y-3">
    {notice && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <ConfirmDialog tone="neutral" open={open} onOpenChange={setOpen} title={t(target === "active" ? "title" : "backTitle")} description={t(target === "active" ? "body" : "backBody")}
      cancelLabel={t("cancel")} confirmLabel={t(target === "active" ? "confirm" : "backConfirm")} busyLabel={t("working")} onConfirm={change}
      trigger={<Button variant={target === "active" ? "default" : "outline"} className="min-h-11">{t(target === "active" ? "button" : "back")}</Button>} />
    <p className="text-xs text-muted-foreground">{t("nothingPublished")}</p>
  </div>;
}
