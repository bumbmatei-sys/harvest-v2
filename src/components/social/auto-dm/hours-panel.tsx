"use client";
import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PlatformLogo } from "@/components/social/platform-logo";
import { StatusBadge } from "@/components/status-badge";
import { HoursForm } from "@/components/social/auto-dm/hours-form";
import { autoDmApi, type AutoDmAccountView, type HoursSettings } from "@/lib/social/auto-dm-api";
import { platformLabels } from "@/lib/social/labels";

/** A sheet with one account's hours form; the board's Hours tab and the rule editor both open it. */
export function HoursSheet({ tenantId, account, open, onOpenChange, onSaved }: { tenantId: string; account: AutoDmAccountView | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved?: (settings: HoursSettings) => void }) {
  const t = useTranslations("SocialAutoDm.hours");
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full overflow-y-auto sm:max-w-md" data-testid="hours-sheet">
    <SheetHeader><SheetTitle>{t("title")}</SheetTitle><SheetDescription>{account ? account.name ?? platformLabels[account.platform] : ""}</SheetDescription></SheetHeader>
    <div className="p-4 pt-0">{account && open && <HoursForm tenantId={tenantId} connectionId={account.id} onSaved={(settings) => onSaved?.(settings)} />}</div>
  </SheetContent></Sheet>;
}

/** The Hours tab: every Instagram and Facebook account with its weekly hours and away message; the same record the Inbox settings edit. */
export function HoursPanel({ tenantId, accounts }: { tenantId: string; accounts: readonly AutoDmAccountView[] }) {
  const t = useTranslations("SocialAutoDm.hours"), api = useMemo(() => autoDmApi(tenantId), [tenantId]);
  const [settings, setSettings] = useState<Record<string, HoursSettings | "error">>({}), [editing, setEditing] = useState<AutoDmAccountView | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    for (const account of accounts) void api.hours(account.id, controller.signal).then(({ settings: loaded }) => setSettings((current) => ({ ...current, [account.id]: loaded }))).catch(() => { if (!controller.signal.aborted) setSettings((current) => ({ ...current, [account.id]: "error" })); });
    return () => controller.abort();
  }, [api, accounts]);
  const days = useMemo(() => [1, 2, 3, 4, 5, 6, 7].map((day) => new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, day)))), []);
  return <section aria-label={t("title")} className="space-y-3" data-testid="hours-panel">
    <p className="text-sm text-muted-foreground">{t("lead")}</p>
    <ul className="grid gap-3 lg:grid-cols-2">{accounts.map((account) => {
      const current = settings[account.id], name = account.name ?? platformLabels[account.platform];
      return <li key={account.id} className="space-y-3 rounded-xl border bg-card p-4" data-testid="hours-card" data-platform={account.platform}>
        <div className="flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"><PlatformLogo platform={account.platform} className="size-4" /></span>
          <div className="min-w-0"><p className="truncate text-sm font-medium">{name}</p><p className="text-xs text-muted-foreground">{platformLabels[account.platform]}</p></div></div>
          <Button type="button" variant="outline" size="responsive" onClick={() => setEditing(account)}><Clock aria-hidden="true" />{t("edit")}</Button></div>
        {current === undefined ? <Skeleton className="h-12 w-full" /> : current === "error" ? <p role="alert" className="text-sm text-destructive">{t("loadFailed")}</p> : <div className="space-y-2 text-sm">
          {current.hours.length === 0 ? <p className="text-muted-foreground">{t("none")}</p> : <ul className="flex flex-wrap gap-1.5" aria-label={t("open")}>{current.hours.map((slot, index) => <li key={index} className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground">{t("range", { day: days[slot.day - 1], start: slot.start, end: slot.end })}</li>)}</ul>}
          <p className="text-xs text-muted-foreground">{current.timezone}</p>
          <p className="flex items-center gap-2 text-xs"><StatusBadge tone={current.awayTemplate ? "success" : "neutral"} label={current.awayTemplate ? t("awaySet") : t("awayNone")} /></p></div>}
      </li>;
    })}</ul>
    <HoursSheet tenantId={tenantId} account={editing} open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }} onSaved={(saved) => setSettings((current) => ({ ...current, [saved.connectionId]: saved }))} />
  </section>;
}
