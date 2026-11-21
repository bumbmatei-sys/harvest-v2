"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RotateCw, ShieldAlert, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { FormSection } from "@/components/form-section";
import { PlatformLogo } from "@/components/social/platform-logo";
import { hoursByDay, slotsProblem, sortSlots, weekdays, type DayHours, type Hours, type InboxAccount, type InboxApi } from "@/lib/social/inbox";
import { SocialApiError } from "@/lib/social/api";
import { platformLabels } from "@/lib/social/labels";
import { browserTimeZone, timeZones } from "@/lib/social/time";
import { notify } from "@/lib/toast";

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; settings: Hours };

/** Working hours and the away message for one connected account, using the server's fields: version, IANA timezone, weekly windows and an optional away template. */
export function InboxSettings({ tenantId, api, accounts, loading, failed, onRetry }: { tenantId: string; api: InboxApi; accounts: InboxAccount[]; loading: boolean; failed: boolean; onRetry: () => void }) {
  const t = useTranslations("SocialInbox.hours"), locale = useLocale();
  const [accountId, setAccountId] = useState<string>(""), [load, setLoad] = useState<Load>({ status: "loading" });
  const [zone, setZone] = useState("UTC"), [slots, setSlots] = useState<DayHours[]>([]), [away, setAway] = useState(""), [saving, setSaving] = useState(false), [notice, setNotice] = useState<"" | "conflict" | "failed">("");
  const current = accounts.find((account) => account.id === accountId) ?? accounts[0];
  const zones = useMemo(() => timeZones(load.status === "ready" ? load.settings.timezone : browserTimeZone()), [load]);

  // State is set only after the request answers; choosing another account shows the skeleton first.
  const read = useCallback(async (id: string) => {
    try {
      const { settings } = await api.hours(id);
      const fresh = settings.version === 0 ? { ...settings, timezone: browserTimeZone() } : settings;
      setLoad({ status: "ready", settings: fresh }); setZone(fresh.timezone); setSlots(sortSlots(fresh.hours)); setAway(fresh.awayTemplate ?? "");
    } catch { setLoad({ status: "error" }); }
  }, [api]);
  const currentId = current?.id;
  useEffect(() => { if (currentId) void Promise.resolve().then(() => read(currentId)); }, [currentId, read]);
  const choose = (id: string) => { setAccountId(id); setLoad({ status: "loading" }); setNotice(""); };

  if (loading) return <div className="space-y-3" aria-busy="true" role="status" aria-label={t("loading")}><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (failed) return <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-2">{t("failed")}<Button type="button" variant="outline" size="responsive" onClick={onRetry}><RotateCw aria-hidden="true" />{t("retry")}</Button></AlertDescription></Alert>;
  if (!current) return <EmptyState icon={ShieldAlert} title={t("noAccountsTitle")} solid action={<Button asChild size="responsive"><Link href={`/workspaces/${tenantId}/social/accounts`} prefetch={false}>{t("connect")}</Link></Button>} />;

  const byDay = hoursByDay(slots), problem = slotsProblem(slots);
  const dayName = (day: number) => new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, day)));
  const edit = (target: DayHours, patch: Partial<DayHours>) => setSlots((all) => all.map((slot) => slot === target ? { ...slot, ...patch } : slot));
  async function save() {
    if (load.status !== "ready" || problem) return;
    setSaving(true); setNotice("");
    try {
      const { settings } = await api.saveHours(current.id, { version: load.settings.version, timezone: zone, hours: sortSlots(slots), awayTemplate: away.trim() ? away.trim() : null });
      setLoad({ status: "ready", settings }); setSlots(sortSlots(settings.hours)); notify.success(t("saved"));
    } catch (error) {
      if (error instanceof SocialApiError && error.conflict) { setNotice("conflict"); void read(current.id); } else setNotice("failed");
    } finally { setSaving(false); }
  }

  return <div className="space-y-6" data-testid="hours-settings">
    <FormSection title={t("title")}>
      <div className="flex flex-wrap items-end gap-4">
        <label className="grid gap-1.5 text-sm font-medium"><span>{t("account")}</span>
          <NativeSelect value={current.id} className="min-h-11 lg:min-h-9" onChange={(event) => choose(event.target.value)}>
            {accounts.map((account) => <NativeSelectOption key={account.id} value={account.id}>{t("accountOption", { platform: platformLabels[account.platform], name: account.displayName ?? platformLabels[account.platform] })}</NativeSelectOption>)}</NativeSelect></label>
        <span className="flex h-11 items-center gap-2 text-sm text-muted-foreground lg:h-9"><PlatformLogo platform={current.platform} colored className="size-5" />{platformLabels[current.platform]}</span>
      </div>
      {load.status === "loading" && <div className="space-y-3" aria-busy="true" role="status" aria-label={t("loading")}>{weekdays.map((day) => <Skeleton key={day} className="h-11 w-full" />)}</div>}
      {load.status === "error" && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-2">{t("failed")}<Button type="button" variant="outline" size="responsive" onClick={() => { setLoad({ status: "loading" }); void read(current.id); }}>{t("retry")}</Button></AlertDescription></Alert>}
      {load.status === "ready" && <div className="space-y-6">
        <label className="grid max-w-sm gap-1.5 text-sm font-medium"><span>{t("timezone")}</span>
          <NativeSelect value={zone} className="min-h-11 w-full lg:min-h-9" onChange={(event) => setZone(event.target.value)}>{zones.map((name) => <NativeSelectOption key={name} value={name}>{name}</NativeSelectOption>)}</NativeSelect></label>
        <ul className="divide-y rounded-lg border" aria-label={t("week")}>
          {weekdays.map((day) => <li key={day} className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3" data-testid={`hours-day-${day}`}>
            <span className="flex min-h-11 w-28 shrink-0 items-center text-sm font-medium lg:min-h-9">{dayName(day)}</span>
            <div className="min-w-0 flex-1 space-y-2">
              {(byDay[day] ?? []).length === 0 && <p className="flex min-h-11 items-center text-sm text-muted-foreground lg:min-h-9">{t("closed")}</p>}
              {(byDay[day] ?? []).map((slot, index) => <div key={index} className="flex flex-wrap items-center gap-2">
                <Input type="time" value={slot.start} aria-label={t("from", { day: dayName(day) })} className="min-h-11 w-32 lg:min-h-9" onChange={(event) => edit(slot, { start: event.target.value })} />
                <span aria-hidden="true">{t("sep")}</span>
                <Input type="time" value={slot.end} aria-label={t("to", { day: dayName(day) })} className="min-h-11 w-32 lg:min-h-9" onChange={(event) => edit(slot, { end: event.target.value })} />
                <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("remove", { day: dayName(day) })} onClick={() => setSlots((all) => all.filter((item) => item !== slot))}><Trash2 aria-hidden="true" /></Button></div>)}
            </div>
            <Button type="button" variant="outline" size="responsive" onClick={() => setSlots((all) => [...all, { day, start: "09:00", end: "17:00" }])}><Plus aria-hidden="true" />{t("add", { day: dayName(day) })}</Button>
          </li>)}
        </ul>
        {problem && <p className="text-sm text-destructive" role="alert" data-testid="hours-problem">{t(`problem.${problem}`)}</p>}
        <label className="grid gap-1.5 text-sm font-medium"><span>{t("away")}</span>
          <Textarea value={away} maxLength={5000} rows={4} placeholder={t("awayPlaceholder")} onChange={(event) => setAway(event.target.value)} /></label>
        <p className="text-sm text-muted-foreground">{t("note")}</p>
        {notice && <Alert variant="destructive" role="alert"><AlertDescription>{notice === "conflict" ? t("conflict") : t("saveFailed")}</AlertDescription></Alert>}
        <div><Button type="button" size="responsive" disabled={saving || !!problem} onClick={() => void save()}>{saving ? t("saving") : t("save")}</Button></div>
      </div>}
    </FormSection>
  </div>;
}
