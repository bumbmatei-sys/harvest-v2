/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/mail/components/account-switcher.tsx (account choice with provider marks); code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useCallback, useState } from "react";
import { Cable, RotateCw, Unplug } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SourceLogo } from "@/components/office/provider-logo";
import { useConnectAttempt } from "@/components/office/use-connect-attempt";
import { StatusBadge } from "@/components/status-badge";
import { OfficeApiError, type OfficeConnection, type OfficePlatform } from "@/lib/office/mail";
import type { FilesApi } from "@/lib/office/files";
import { sourceNames } from "@/lib/files-screen";
import { notify } from "@/lib/toast";

/**
 * The person's own drive connections: the privacy notice is always on screen, choosing a provider is the affirmative action, and a connected drive can be
 * disconnected (which removes the connection and the file references the person linked; nothing in the drive changes). One drive connection per person is what the
 * server allows, so the connect buttons appear only while there is none.
 */
export function SourcesDialog({ api, connections, notice, noticeVersion, onChanged }: { api: FilesApi; connections: readonly OfficeConnection[]; notice: string; noticeVersion: number; onChanged: () => void }) {
  const t = useTranslations("FilesScreen.sources");
  const [open, setOpen] = useState(false);
  const start = useCallback((platform: OfficePlatform) => api.startConnect(platform, noticeVersion), [api, noticeVersion]);
  const finish = useCallback((attemptId: string) => api.finishConnect(attemptId), [api]);
  const connected = useCallback(() => { onChanged(); }, [onChanged]);
  const { phase, begin, cancel } = useConnectAttempt({ start, finish, onConnected: connected });
  const busy = phase.name === "starting" || phase.name === "pending";
  const [checking, setChecking] = useState(false);

  async function check(connection: OfficeConnection) {
    setChecking(true);
    try { await api.files(connection.id, { limit: 1 }); } catch { /* the refreshed overview shows the outcome */ }
    setChecking(false); onChanged();
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="outline" size="responsive" data-testid="sources-open"><Cable aria-hidden="true" />{t("open")}</Button></DialogTrigger>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{t("title")}</DialogTitle><DialogDescription>{t("subtitle")}</DialogDescription></DialogHeader>
      <p className="text-sm text-muted-foreground" data-testid="connect-notice">{notice}</p>
      <ul className="space-y-2" aria-label={t("list")}>
        <li className="flex items-center gap-3 rounded-lg border p-3 min-h-11"><SourceLogo source="harvest" className="size-5" /><span className="flex-1 font-medium">{sourceNames.harvest}</span><StatusBadge tone="success" label={t("always")} /></li>
        {connections.map((connection) => {
          const platform = connection.platform, name = platform ? sourceNames[platform] : t("legacy");
          const healthy = connection.health === "healthy" && platform !== null;
          return <li key={connection.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3" data-testid="source-connection">
            {platform ? <SourceLogo source={platform} className="size-5" /> : <Cable className="size-5" aria-hidden="true" />}
            <span className="flex-1 font-medium">{name}</span>
            <StatusBadge tone={healthy ? "success" : "warning"} label={healthy ? t("connected") : connection.health === "reconnect_needed" || !platform ? t("reconnect") : t("attention")} />
            {!healthy && platform && connection.health !== "reconnect_needed" && <Button type="button" variant="outline" size="responsive" disabled={checking} onClick={() => void check(connection)}>{checking ? <Spinner /> : <RotateCw aria-hidden="true" />}{t("checkAgain")}</Button>}
            <ConfirmDialog tone="destructive" title={t("disconnectTitle", { name })} description={t("disconnectBody")} confirmLabel={t("disconnect")} cancelLabel={t("cancel")} busyLabel={t("disconnecting")}
              onConfirm={async () => { const result = await api.disconnect(connection.id); if (result.state !== "disconnected") throw new OfficeApiError(0); notify.success(t("disconnected")); onChanged(); }}
              trigger={<Button type="button" variant="ghost" size="responsive" data-testid="source-disconnect" aria-label={t("disconnectValue", { name })}><Unplug aria-hidden="true" />{t("disconnect")}</Button>} />
          </li>;
        })}
      </ul>
      {connections.length === 0 && (phase.name === "pending"
        ? <Alert role="status" data-testid="connect-pending"><Spinner /><AlertTitle>{t("pendingTitle")}</AlertTitle><AlertDescription>
          <p>{t("pendingBody")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {phase.url && <Button asChild variant="outline" size="responsive"><a href={phase.url} target="_blank" rel="noopener noreferrer">{t("openAgain")}</a></Button>}
            <Button type="button" variant="outline" size="responsive" onClick={cancel}>{t("cancel")}</Button>
          </div></AlertDescription></Alert>
        : <div className="flex flex-col gap-2 sm:flex-row" role="group" aria-label={t("choose")}>
          {(["google", "microsoft"] as const).map((platform) => <Button key={platform} type="button" variant="outline" size="responsive" className="sm:flex-1" disabled={busy} onClick={() => void begin(platform)} data-testid={`connect-${platform}`}>
            {phase.name === "starting" && phase.platform === platform ? <Spinner /> : <SourceLogo source={platform} className="size-5" />}{t("connectWith", { provider: sourceNames[platform] })}
          </Button>)}
        </div>)}
      {phase.name === "failed" && <Alert variant="destructive" role="alert" data-testid="connect-failed"><AlertDescription>{t("failed")}</AlertDescription></Alert>}
      {phase.name === "refused" && <Alert variant="destructive" role="alert" data-testid="connect-refused"><AlertDescription>{t("refused")}</AlertDescription></Alert>}
    </DialogContent>
  </Dialog>;
}
