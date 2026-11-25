/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/mail/components/account-switcher.tsx (account choice with provider marks); code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useCallback, useState } from "react";
import { Mail, RotateCw, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ProviderLogo } from "@/components/office/provider-logo";
import { useConnectAttempt } from "@/components/office/use-connect-attempt";
import { mailboxLabel, platformName, type MailApi, type OfficeConnection, type OfficePlatform } from "@/lib/office/mail";

/**
 * Connect, reconnect and attention states for the signed-in person's own mailbox. The privacy notice is always on screen before the person chooses a
 * provider; choosing one is the affirmative action. A hosted authorisation URL opens in a new tab and is held in memory only; this page polls the same
 * signed-in account until the handoff finishes.
 */
export function MailConnect({ api, notice, noticeVersion, connection, onConnected, onRefresh, disconnect }: {
  api: MailApi; notice: string; noticeVersion: number; connection: OfficeConnection | null; onConnected: () => void; onRefresh: () => void; disconnect: React.ReactNode;
}) {
  const c = useTranslations("OfficeMail.connect");
  const reconnect = connection?.health === "reconnect_needed" || (connection !== null && connection.platform === null);
  const attention = connection !== null && !reconnect && connection.health !== "healthy";
  const [checking, setChecking] = useState(false);
  const existingId = connection?.id;
  const start = useCallback((platform: OfficePlatform) => api.startConnect(platform, noticeVersion, existingId), [api, noticeVersion, existingId]);
  const finish = useCallback((attemptId: string) => api.finishConnect(attemptId), [api]);
  const { phase, begin, cancel } = useConnectAttempt({ start, finish, onConnected });

  async function check() {
    if (!connection) return;
    setChecking(true);
    try { await api.health(connection.id); } catch { /* the refreshed overview shows the outcome */ }
    setChecking(false); onRefresh();
  }

  const choices: OfficePlatform[] = connection?.platform ? [connection.platform] : ["google", "microsoft"];
  const busy = phase.name === "starting" || phase.name === "pending";
  const title = attention ? c("attentionTitle") : reconnect ? c("reconnectTitle") : c("title");
  return <section className="mx-auto w-full max-w-xl rounded-xl border bg-card p-4 sm:p-6" aria-labelledby="mail-connect-title" data-testid="mail-connect" data-state={attention ? "attention" : reconnect ? "reconnect" : "connect"}>
    <div className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background"><Mail className="size-5" aria-hidden="true" /></span>
      <h2 id="mail-connect-title" className="text-lg font-semibold">{title}</h2>
    </div>
    <p className="mt-4 text-sm text-muted-foreground" data-testid="connect-notice">{notice}</p>

    {attention
      ? <div className="mt-4 space-y-3">
        <Alert variant="attention" role="status"><TriangleAlert aria-hidden="true" /><AlertTitle>{c("attentionTitle")}</AlertTitle><AlertDescription>{c("attention")}</AlertDescription></Alert>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="responsive" disabled={checking} onClick={() => void check()} data-testid="check-again">{checking ? <Spinner /> : <RotateCw aria-hidden="true" />}{c("checkAgain")}</Button>
          {disconnect}
        </div>
      </div>
      : <div className="mt-4 space-y-3">
        {phase.name === "pending"
          ? <Alert role="status" data-testid="connect-pending"><Spinner /><AlertTitle>{c("pendingTitle")}</AlertTitle><AlertDescription>
            <p>{c("pendingBody")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {phase.url && <Button asChild variant="outline" size="responsive"><a href={phase.url} target="_blank" rel="noopener noreferrer">{c("openAgain")}</a></Button>}
              <Button type="button" variant="outline" size="responsive" onClick={cancel}>{c("cancel")}</Button>
            </div></AlertDescription></Alert>
          : <div className="flex flex-col gap-2 sm:flex-row" role="group" aria-label={c("choose")}>
            {choices.map((platform) => <Button key={platform} type="button" variant="outline" size="responsive" className="sm:flex-1" disabled={busy} onClick={() => void begin(platform)} data-testid={`connect-${platformName[platform]}`}>
              {phase.name === "starting" && phase.platform === platform ? <Spinner /> : <ProviderLogo platform={platform} />}
              {reconnect ? c("reconnectWith", { provider: mailboxLabel[platform] }) : c("connectWith", { provider: mailboxLabel[platform] })}
            </Button>)}
          </div>}
        {phase.name === "failed" && <Alert variant="destructive" role="alert" data-testid="connect-failed"><AlertDescription>{c("failed")}</AlertDescription></Alert>}
        {phase.name === "refused" && <Alert variant="destructive" role="alert" data-testid="connect-refused"><AlertDescription>{c("refused")}</AlertDescription></Alert>}
        {disconnect && reconnect && <div>{disconnect}</div>}
      </div>}
  </section>;
}
