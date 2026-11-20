"use client";
import { useState } from "react";
import { joinParts } from "@/lib/social/join";
import { Check, Minus, Plus, RefreshCw, ShieldAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { RingMark } from "@/components/social/platform-ring";
import { useReason } from "@/components/social/use-reason";
import { useSocialData } from "@/components/social/use-social-data";
import { socialApi, SocialApiError, type Capabilities, type ConnectionView } from "@/lib/social/api";
import { platformLabels } from "@/lib/social/labels";
import { socialPlatforms, platformCapabilities, type SocialPlatform } from "@/lib/social/platforms";
import { defineStatusTones } from "@/lib/status-tone";
import { notify } from "@/lib/toast";

const healthTone = defineStatusTones({ healthy: "success", degraded: "warning", failing: "danger" });
type Level = "supported" | "conditional" | "unavailable";
const levelOf = (value: string): Level => value === "supported" || value === "conditional" ? value : "unavailable";
const abilities = (caps: Capabilities): { key: string; level: Level }[] => [
  { key: "post", level: levelOf(caps.postTypes.post) }, { key: "story", level: levelOf(caps.postTypes.story) }, { key: "article", level: levelOf(caps.postTypes.article) },
  { key: "firstComment", level: levelOf(caps.firstComment) }, { key: "repost", level: levelOf(caps.repost) }, { key: "madeWithAi", level: levelOf(caps.madeWithAi) },
  { key: "altText", level: levelOf(caps.altText) }, { key: "link", level: caps.link === "unavailable" ? "unavailable" : "supported" },
  { key: "comments", level: levelOf(caps.comments) }, { key: "dms", level: levelOf(caps.dms) },
];

/**
 * Connected accounts with health, what each can do, and an explicit unavailable state (never an empty list). Linking an account here is for the
 * non-production test provider only (`testConnect`): one button, no sign-in flow and no field that asks for a credential.
 */
export function AccountsBoard({ tenantId, testConnect, testCredential }: { tenantId: string; testConnect: boolean; testCredential: string }) {
  const t = useTranslations("SocialPublish.accounts"), caps = useTranslations("SocialPublish.capabilities"), reason = useReason(), locale = useLocale();
  const data = useSocialData(tenantId), api = socialApi(tenantId);
  const [busy, setBusy] = useState<string | null>(null), [addOpen, setAddOpen] = useState(false), [platform, setPlatform] = useState<SocialPlatform>("instagram"), [error, setError] = useState("");
  const taken = new Set(data.connections.map((connection) => connection.platform));
  const postable = socialPlatforms.filter((value) => platformCapabilities[value].postTypes.post !== "unavailable");
  async function patch(connection: ConnectionView, body: { enabled: boolean } | { refreshHealth: true }) {
    setBusy(connection.id); setError("");
    try { await api.patchConnection(connection.id, body); data.reload(); notify.success(t("updated")); }
    catch (cause) { setError(cause instanceof SocialApiError && cause.unavailable ? t("notAvailableBody") : reason(cause instanceof SocialApiError ? cause.code ?? "UNKNOWN" : "UNKNOWN")); }
    finally { setBusy(null); }
  }
  async function add() {
    setBusy("add"); setError("");
    try { await api.link({ provider: "fake", credential: testCredential, accountRef: `test-${platform}` }); setAddOpen(false); data.reload(); }
    catch (cause) { setError(cause instanceof SocialApiError && cause.conflict ? t("alreadyLinked") : t("addFailed")); }
    finally { setBusy(null); }
  }
  const header = <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p></div>
    {testConnect && data.state === "ready" && <Button type="button" size="responsive" onClick={() => { setPlatform(postable.find((value) => !taken.has(value)) ?? "instagram"); setAddOpen(true); }}><Plus aria-hidden="true" />{t("addTest")}</Button>}</div>;
  if (data.state === "loading") return <div className="space-y-4" aria-busy="true">{header}<Skeleton className="h-40 w-full" /></div>;
  if (data.state === "unavailable") return <div className="space-y-4">{header}<EmptyState icon={ShieldAlert} title={t("unavailableTitle")} description={t("notAvailableBody")} solid /></div>;
  if (data.state === "error") return <div className="space-y-4">{header}<Alert variant="destructive" role="alert"><AlertDescription>{t("loadFailed")} <Button type="button" variant="link" onClick={data.reload}>{t("retry")}</Button></AlertDescription></Alert></div>;
  return <div className="min-w-0 space-y-4">
    {header}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {data.connections.length === 0 ? <EmptyState icon={ShieldAlert} title={t("empty")} description={testConnect ? undefined : t("emptyNoConnect")} solid />
      : <ul className="m-0 grid list-none gap-3 p-0 lg:grid-cols-2" data-testid="accounts-list">
        {data.connections.map((connection) => <li key={connection.id} className="space-y-3 rounded-xl border bg-card p-4" data-testid="account-card" data-platform={connection.platform}>
          <div className="flex flex-wrap items-center gap-3">
            <RingMark platform={connection.platform} active={false} />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{platformLabels[connection.platform]}</p><p className="truncate text-xs text-muted-foreground">{connection.displayName}</p></div>
            <StatusBadge tone={connection.availability === "available" ? "success" : "danger"} label={t(connection.availability)} dot />
            <StatusBadge tone={healthTone(connection.health)} label={t.has(`health.${connection.health}`) ? t(`health.${connection.health}`) : t("health.unknown")} />
          </div>
          {connection.healthCheckedAt && <p className="text-xs text-muted-foreground">{t("checked", { time: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(connection.healthCheckedAt)) })}</p>}
          {connection.healthCode && <p className="text-xs text-destructive">{reason(connection.healthCode)}</p>}
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={t("capabilities")}>
            {abilities(connection.capabilities).map(({ key, level }) => <li key={key} data-level={level} className="inline-flex min-h-6 items-center gap-1 rounded-md border px-2 text-xs">
              {level === "unavailable" ? <Minus className="size-3 text-muted-foreground" aria-hidden="true" /> : <Check className="size-3 text-success" aria-hidden="true" />}
              <span className={level === "unavailable" ? "text-muted-foreground" : undefined}>{caps(key)}<span className="sr-only">{joinParts(["", caps(level)], ": ")}</span>{level === "conditional" && <span aria-hidden="true">{caps("marker")}</span>}</span></li>)}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex min-h-11 items-center gap-2 text-sm"><Switch checked={connection.status === "active"} disabled={busy === connection.id || !["active", "disabled"].includes(connection.status)} onCheckedChange={(enabled) => void patch(connection, { enabled })} aria-label={t("enabled", { name: connection.displayName ?? platformLabels[connection.platform] })} />{t("enabledLabel")}</label>
            <Button type="button" variant="outline" size="responsive" disabled={busy === connection.id || connection.status !== "active"} onClick={() => void patch(connection, { refreshHealth: true })}><RefreshCw aria-hidden="true" />{t("checkHealth")}</Button>
          </div>
        </li>)}
      </ul>}
    <Dialog open={addOpen} onOpenChange={(open) => { if (busy !== "add") setAddOpen(open); }}><DialogContent className="max-w-sm">
      <DialogHeader><DialogTitle>{t("addTest")}</DialogTitle><DialogDescription>{t("addTestLead")}</DialogDescription></DialogHeader>
      <label className="block space-y-1 text-sm font-medium">{t("platform")}<NativeSelect value={platform} onChange={(event) => setPlatform(event.target.value as SocialPlatform)} className="min-h-11">
        {postable.filter((value) => !taken.has(value)).map((value) => <NativeSelectOption key={value} value={value}>{platformLabels[value]}</NativeSelectOption>)}</NativeSelect></label>
      <DialogFooter className="gap-2"><Button type="button" variant="outline" size="responsive" onClick={() => setAddOpen(false)}>{t("cancel")}</Button><Button type="button" size="responsive" aria-disabled={busy === "add" || taken.has(platform) || undefined} onClick={() => { if (!taken.has(platform)) void add(); }}>{t("addConfirm")}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
