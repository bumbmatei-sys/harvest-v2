"use client";
import { useEffect, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { PlatformLogo } from "@/components/social/platform-logo";
import { StatusBadge } from "@/components/status-badge";
import { HardOffNotice } from "@/components/social/auto-dm/hard-off-notice";
import { useRuleLabels } from "@/components/social/auto-dm/rule-labels";
import { useAutoDmReason } from "@/components/social/auto-dm/use-auto-dm";
import { autoDmApi, type AutoDmAccountView, type AutoDmRuleView } from "@/lib/social/auto-dm-api";
import { promotionalFlags, ruleTemplates } from "@/lib/social/auto-dm-ui";
import { platformLabels } from "@/lib/social/labels";

type Review = { token: string; expiresAt: string; rule: AutoDmRuleView };
/**
 * The explicit enable review. Opening it asks the server for a ten-minute review of this exact version; the dialog shows the exact text that would go out,
 * the service-only confirmation and the limits, and turns the rule on only with that review's token and the person's own confirmation.
 */
export function EnableReview({ tenantId, rule, account, open, onOpenChange, onEnabled }: {
  tenantId: string; rule: AutoDmRuleView | null; account: AutoDmAccountView | null; open: boolean; onOpenChange: (open: boolean) => void; onEnabled: (rule: AutoDmRuleView) => void;
}) {
  const t = useTranslations("SocialAutoDm.review"), labels = useRuleLabels(), reason = useAutoDmReason(), api = useMemo(() => autoDmApi(tenantId), [tenantId]);
  const [review, setReview] = useState<Review | null>(null), [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle"), [error, setError] = useState(""), [read, setRead] = useState(false), [busy, setBusy] = useState(false), [now, setNow] = useState(() => Date.now()), [attempt, setAttempt] = useState(0);
  const ruleId = rule?.id, ruleVersion = rule?.version;
  useEffect(() => {
    if (!open || !ruleId || ruleVersion === undefined) return;
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the review as requested while the server call runs
    setState("loading"); setError(""); setRead(false); setReview(null);
    void api.review(ruleId, ruleVersion).then((response) => { if (live) { setReview({ token: response.review.token, expiresAt: response.review.expiresAt, rule: response.rule }); setState("ready"); setNow(Date.now()); } })
      .catch((cause: unknown) => { if (live) { setError(reason(cause)); setState("failed"); } });
    return () => { live = false; };
    // The review is requested once per opening (or restart); `reason` is a stable formatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, open, ruleId, ruleVersion, attempt]);
  useEffect(() => { if (state !== "ready") return; const timer = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(timer); }, [state]);
  const expired = review ? new Date(review.expiresAt).getTime() <= now : false;
  async function enable() {
    if (!review) return; setBusy(true); setError("");
    try { const done = await api.enable(review.rule.id, review.rule.version, review.token); onEnabled(done.rule); onOpenChange(false); }
    catch (cause) { setError(reason(cause)); } finally { setBusy(false); }
  }
  const shown = review?.rule ?? rule, templates = shown ? ruleTemplates(shown) : [], flags = shown ? promotionalFlags(...templates.map((item) => item.text)) : [];
  const row = (label: string, value: React.ReactNode) => <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-1.5"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 text-right font-medium break-words">{value}</dd></div>;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl" data-testid="enable-review">
    <DialogHeader><DialogTitle>{t("title")}</DialogTitle><DialogDescription>{shown?.name}</DialogDescription></DialogHeader>
    {state === "loading" && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />{t("preparing")}</p>}
    {state === "failed" && <Alert variant="destructive" role="alert" data-testid="review-error"><TriangleAlert aria-hidden="true" /><AlertDescription>{error}</AlertDescription></Alert>}
    {state === "ready" && shown && <div className="space-y-4 text-sm">
      <HardOffNotice compact />
      <dl className="divide-y rounded-lg border px-3">
        {row(t("account"), <span className="inline-flex items-center gap-1.5">{account && <PlatformLogo platform={account.platform} className="size-3.5" />}{account ? account.name ?? platformLabels[account.platform] : "-"}</span>)}
        {row(t("trigger"), `${labels.trigger(shown.trigger)} · ${labels.scope(shown)}`)}
        {shown.match.keywords.length > 0 && row(t("keywords"), `${shown.match.keywords.join(", ")} (${labels.mode(shown.match.mode)})`)}
        {row(t("limits"), t("limitsValue", { cooldown: labels.cooldown(shown.cooldownMinutes), person: shown.recipientDaily, rule: shown.ruleDaily }))}
        {row(t("hours"), labels.hours(shown.hours))}
        {row(t("handoff"), shown.handoffUserId ? t("handoffOn") : t("handoffOff"))}
        {row(t("purpose"), labels.purpose(shown.purpose))}
        {row(t("version"), String(shown.version))}
      </dl>
      <section aria-label={t("textTitle")} className="space-y-2"><h3 className="font-medium">{t("textTitle")}</h3>
        {templates.map((item) => <div key={item.kind} className="rounded-lg border bg-muted/40 p-3" data-testid="review-template">
          <p className="mb-1 text-xs text-muted-foreground">{t(`kinds.${item.kind}`)}</p><p className="whitespace-pre-wrap break-words">{item.text}</p></div>)}</section>
      <div className="space-y-2" data-testid="review-service">
        {shown.purpose === "service" && <p className="flex flex-wrap items-center gap-2"><StatusBadge tone={shown.serviceOnly ? "success" : "danger"} label={shown.serviceOnly ? t("serviceConfirmed", { version: shown.version }) : t("serviceMissing")} /></p>}
        {flags.length > 0 && <Alert role="alert" data-testid="review-flags"><TriangleAlert aria-hidden="true" /><AlertDescription>{t("flagged", { words: flags.join(", ") })}</AlertDescription></Alert>}
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {expired ? <Alert role="alert"><TriangleAlert aria-hidden="true" /><AlertDescription className="flex flex-wrap items-center gap-2">{t("expired")}<Button type="button" size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>{t("again")}</Button></AlertDescription></Alert>
        : <label className="flex min-h-11 items-start gap-2.5 py-1"><Checkbox checked={read} onCheckedChange={(value) => setRead(value === true)} className="mt-0.5" /><span>{t("read")}</span></label>}
    </div>}
    <DialogFooter className="gap-2 sm:gap-2">
      <Button type="button" variant="outline" size="responsive" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
      <Button type="button" size="responsive" aria-disabled={state !== "ready" || !read || expired || busy || undefined} onClick={() => { if (state === "ready" && read && !expired && !busy) void enable(); }}>{busy && <Spinner />}{t("enable")}</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}
