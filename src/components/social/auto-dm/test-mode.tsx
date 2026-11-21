"use client";
import { useMemo, useState } from "react";
import { FlaskConical, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/status-badge";
import { autoDmApi, type PreviewResult } from "@/lib/social/auto-dm-api";
import type { AutoDmRule } from "@/lib/social/auto-dm";
import type { SocialPlatform } from "@/lib/social/platforms";
import { useAutoDmReason } from "@/components/social/auto-dm/use-auto-dm";

/**
 * Test mode: a synthetic sample is matched against the rule as written, with a fixed example first name. "Send a test" goes to a disposable in-process
 * test recipient on the fake provider; no account, person or network is involved. A hand-off rule has no test delivery.
 */
export function TestMode({ tenantId, platform, rule, ready }: { tenantId: string; platform: SocialPlatform; rule: AutoDmRule; ready: boolean }) {
  const t = useTranslations("SocialAutoDm.test"), reason = useAutoDmReason(), api = useMemo(() => autoDmApi(tenantId), [tenantId]);
  const [sample, setSample] = useState(""), [busy, setBusy] = useState<"" | "check" | "send">(""), [result, setResult] = useState<PreviewResult | null>(null), [error, setError] = useState("");
  const keyword = rule.trigger === "comment" || rule.trigger === "dm" || rule.trigger === "story_reply";
  async function run(testSend: boolean) {
    setBusy(testSend ? "send" : "check"); setError("");
    try { setResult(await api.preview({ platform, rule, sample: keyword || sample.trim() ? sample : null, testSend })); }
    catch (cause) { setResult(null); setError(reason(cause)); } finally { setBusy(""); }
  }
  const tone = result?.result === "matched" ? "success" : result?.result === "unavailable" ? "warning" : "neutral";
  return <section aria-label={t("title")} data-testid="test-mode" className="space-y-3 rounded-xl border bg-card p-4">
    <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-sm font-semibold"><FlaskConical className="size-4" aria-hidden="true" />{t("title")}</h2><StatusBadge tone="neutral" label={t("fake")} /></div>
    <label className="block space-y-1 text-sm">{keyword ? t("sample") : t("sampleOptional")}
      <Input value={sample} maxLength={2000} onChange={(event) => setSample(event.target.value)} className="min-h-11 lg:min-h-9" /></label>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="responsive" aria-disabled={!ready || busy !== "" || undefined} onClick={() => { if (ready && !busy) void run(false); }}>{busy === "check" ? <Spinner /> : null}{t("check")}</Button>
      <Button type="button" variant="outline" size="responsive" aria-disabled={!ready || busy !== "" || !!rule.handoffUserId || undefined} onClick={() => { if (ready && !busy && !rule.handoffUserId) void run(true); }}>{busy === "send" ? <Spinner /> : <Send aria-hidden="true" />}{t("send")}</Button>
    </div>
    {!ready && <p className="text-xs text-muted-foreground" role="status">{t("notReady")}</p>}
    {ready && rule.handoffUserId && <p className="text-xs text-muted-foreground">{t("handoffNoSend")}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {result && <div role="status" data-testid="test-result" className="space-y-2 border-t pt-3 text-sm">
      <p className="flex flex-wrap items-center gap-2"><StatusBadge tone={tone} label={t(`result.${result.result}`)} /></p>
      {result.result === "matched" && <p className="rounded-lg bg-muted p-2.5 whitespace-pre-wrap break-words" data-testid="test-response">{result.response}</p>}
      {result.testDelivery && <p className="text-xs text-muted-foreground" data-testid="test-delivery">{t("delivered", { id: result.testDelivery.id.slice(0, 8) })}</p>}
    </div>}
  </section>;
}
