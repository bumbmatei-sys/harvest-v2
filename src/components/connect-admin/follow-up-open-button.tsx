"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useRequest } from "@/hooks/use-request";
import { notify } from "@/lib/toast";

/** Owner/admin: turn verified, associated requests with follow-up consent in effect into cases. Idempotent; sends nothing. */
export function FollowUpOpenButton({ tenantId }: { tenantId: string }) {
  const t = useTranslations("FollowUp");
  const request = useRequest(), router = useRouter();
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    const result = await request<{ opened: number }>(`/api/workspaces/${tenantId}/followup-cases`, { method: "POST", body: {} });
    setBusy(false);
    if (!result.ok) { notify.error(result.error); return; }
    notify.success(t("openedCount", { count: result.data.opened }));
    router.refresh();
  }
  return <Button type="button" variant="outline" size="responsive" aria-disabled={busy || undefined} onClick={() => { if (!busy) void open(); }}>
    {busy ? <Spinner decorative /> : <ListPlus aria-hidden="true" />}{t("openCases")}</Button>;
}
