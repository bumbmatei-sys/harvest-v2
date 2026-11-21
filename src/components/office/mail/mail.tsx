"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { RotateCw, ShieldAlert, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { MailConnect } from "@/components/office/mail/mail-connect";
import { MailWorkspace } from "@/components/office/mail/mail-workspace";
import { mailApi, OfficeApiError, type OfficeOverview } from "@/lib/office/mail";
import { notify } from "@/lib/toast";

type Load = { status: "loading" } | { status: "error" } | { status: "unavailable" } | { status: "ready"; overview: OfficeOverview };

/**
 * Office, Email. Each owner or admin connects their own mailbox; the connection is private to that person. This component owns the connection lifecycle
 * (none, reconnect needed, needs attention, healthy) and shows the inbox only for a healthy mailbox. Sending and everything that leaves the ministry is
 * hard-off on the server and shown disabled here.
 */
export function OfficeMail({ tenantId }: { tenantId: string }) {
  const t = useTranslations("OfficeMail");
  const notice = useTranslations("Office");
  const api = useMemo(() => mailApi(tenantId), [tenantId]);
  const [load, setLoad] = useState<Load>({ status: "loading" });

  const refresh = useCallback(async (quiet = false) => {
    try {
      const overview = await api.overview();
      setLoad({ status: "ready", overview });
    } catch (error) {
      if (error instanceof OfficeApiError && error.unavailable) setLoad({ status: "unavailable" });
      else setLoad((current) => quiet && current.status === "ready" ? current : { status: "error" });
    }
  }, [api]);
  useEffect(() => { void Promise.resolve().then(() => refresh()); }, [refresh]);

  const connection = load.status === "ready" ? load.overview.connections.find((item) => item.kind === "mail") ?? null : null;
  const reconnect = useCallback(() => { void refresh(true); }, [refresh]);
  const disconnect = connection && <ConfirmDialog tone="destructive" title={t("account.disconnectTitle")} description={t("account.disconnectBody")} confirmLabel={t("account.disconnectConfirm")} busyLabel={t("account.disconnecting")}
    cancelLabel={t("account.cancel")} onConfirm={async () => { const result = await api.disconnect(connection.id); if (result.state !== "disconnected") throw new OfficeApiError(0); notify.success(t("account.disconnected")); await refresh(true); }}
    trigger={<Button type="button" variant="ghost" size="responsive" className="w-full justify-start" data-testid="disconnect"><Unplug aria-hidden="true" />{t("account.disconnect")}</Button>} />;

  const header = <header className="min-w-0"><h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p></header>;
  if (load.status === "loading") return <div className="space-y-4">{header}<div className="space-y-3" role="status" aria-busy="true" aria-label={t("loading")}><Skeleton className="h-10 w-48" /><Skeleton className="h-64 w-full" /></div></div>;
  if (load.status === "unavailable") return <div className="space-y-4">{header}<EmptyState icon={ShieldAlert} title={t("unavailableTitle")} description={t("unavailable")} solid /></div>;
  if (load.status === "error") return <div className="space-y-4">{header}<Alert variant="destructive" role="alert" data-testid="overview-error"><AlertDescription className="flex flex-wrap items-center gap-2">{t("loadFailed")}
    <Button type="button" variant="outline" size="responsive" onClick={() => { setLoad({ status: "loading" }); void refresh(); }}><RotateCw aria-hidden="true" />{t("retry")}</Button></AlertDescription></Alert></div>;

  const { overview } = load, healthy = connection?.health === "healthy" && connection.platform !== null && connection.grants === 1;
  if (!connection || !healthy) return <div className="space-y-4">{header}<MailConnect api={api} notice={notice("personalConnectionNotice")} noticeVersion={overview.notice.version} connection={connection} onConnected={() => void refresh(true)} onRefresh={reconnect} disconnect={disconnect} /></div>;
  return <div className="space-y-4">{header}<MailWorkspace key={connection.id} tenantId={tenantId} api={api} connection={connection} disconnect={disconnect} onReconnect={reconnect} /></div>;
}
