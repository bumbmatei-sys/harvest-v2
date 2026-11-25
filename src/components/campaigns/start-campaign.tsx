"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TypeCards } from "@/components/campaigns/type-cards";
import { useRequest } from "@/hooks/use-request";
import type { DraftView } from "@/lib/campaign-wizard-form";
import type { campaignTypes } from "@/lib/campaigns";

/** Step 1 before a draft exists: picking a type creates the draft (one Idempotency-Key per visit, so a double click makes one) and opens step 2. */
export function StartCampaign({ tenantId }: { tenantId: string }) {
  const t = useTranslations("CampaignWizard"), request = useRequest(), router = useRouter();
  const key = useRef(`wizard-${crypto.randomUUID()}`), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function pick(type: typeof campaignTypes[number]) {
    if (busy) return;
    setBusy(true); setError("");
    const response = await request<DraftView>(`/api/workspaces/${tenantId}/campaigns/drafts`, { method: "POST", body: { type }, headers: { "Idempotency-Key": key.current } });
    if (!response.ok) { setBusy(false); setError(response.error); return; }
    router.push(`/workspaces/${tenantId}/campaigns/drafts/${response.data.id}`);
  }
  return <div className="space-y-4">
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <h2 id="start-type" className="text-base font-semibold">{t("questions.type")}</h2>
    <TypeCards value={null} onPick={(type) => void pick(type)} disabled={busy} labelledBy="start-type" />
  </div>;
}
