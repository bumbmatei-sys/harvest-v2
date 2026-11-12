"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { useCrmRequest } from "@/components/crm/request";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { MyWarning } from "@/server/community-moderation";

/** C12b: a warning from the hosts, shown at the top of the forum until the member acknowledges it. */
export function WarningAlerts({ slug, warnings }: { slug: string; warnings: MyWarning[] }) {
  const t = useTranslations("Warnings"), request = useCrmRequest(), router = useRouter();
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  async function acknowledge(id: string) {
    setBusy(id); setError("");
    const result = await request(`/api/communities/${slug}/warnings/${id}`, { method: "POST" });
    setBusy(null);
    if (result.ok) router.refresh(); else setError(result.error);
  }
  if (warnings.length === 0) return null;
  return <div className="space-y-2">
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {warnings.map((w) => <Alert key={w.id}>
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>{t("title")}</AlertTitle>
      <AlertDescription>
        <p className="whitespace-pre-line break-words">{w.reason}</p>
        <Button variant="outline" className="mt-2 min-h-11" disabled={busy === w.id} onClick={() => void acknowledge(w.id)}>{t("acknowledge")}</Button>
      </AlertDescription>
    </Alert>)}
  </div>;
}
