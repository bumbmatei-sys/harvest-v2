"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { autoDmApi, type HoursSettings, type HoursSlot } from "@/lib/social/auto-dm-api";
import { weekdays } from "@/lib/social/auto-dm-ui";
import { useAutoDmReason } from "@/components/social/auto-dm/use-auto-dm";

/** Same overlap and order rule as the server: a range ends after it starts and does not overlap the next one on its day. */
export function hoursProblem(slots: readonly HoursSlot[]) {
  const sorted = [...slots].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  return sorted.some((slot, index) => !slot.start || !slot.end || slot.start >= slot.end || (index > 0 && sorted[index - 1].day === slot.day && sorted[index - 1].end > slot.start));
}
const zones = () => { try { return Intl.supportedValuesOf("timeZone"); } catch { return ["UTC"]; } };

/** The account's working hours and away message: the same record the Inbox settings use, so a change here is the change there. */
export function HoursForm({ tenantId, connectionId, onSaved }: { tenantId: string; connectionId: string; onSaved: (settings: HoursSettings) => void }) {
  const t = useTranslations("SocialAutoDm.hours"), reason = useAutoDmReason(), api = useMemo(() => autoDmApi(tenantId), [tenantId]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading"), [settings, setSettings] = useState<HoursSettings | null>(null);
  const [zone, setZone] = useState("UTC"), [slots, setSlots] = useState<HoursSlot[]>([]), [away, setAway] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api.hours(connectionId, controller.signal).then(({ settings: loaded }) => { setSettings(loaded); setZone(loaded.timezone); setSlots(loaded.hours); setAway(loaded.awayTemplate ?? ""); setState("ready"); })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [api, connectionId]);
  const options = useMemo(() => { const all = zones(); return all.includes(zone) ? all : [zone, ...all]; }, [zone]);
  const names = useMemo(() => weekdays.map((day) => new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, day)))), []);
  if (state === "loading") return <div className="space-y-3" aria-busy="true"><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /></div>;
  if (state === "error" || !settings) return <Alert variant="destructive" role="alert"><AlertDescription>{t("loadFailed")}</AlertDescription></Alert>;
  const invalid = hoursProblem(slots), edit = (index: number, patch: Partial<HoursSlot>) => { setSaved(false); setSlots((current) => current.map((slot, at) => at === index ? { ...slot, ...patch } : slot)); };
  async function save() {
    if (!settings) return; setBusy(true); setError(""); setSaved(false);
    try { const next = await api.saveHours(connectionId, { version: settings.version, timezone: zone, hours: slots, awayTemplate: away.trim() ? away.trim() : null }); setSettings(next.settings); setSlots(next.settings.hours); setSaved(true); onSaved(next.settings); }
    catch (cause) { setError(reason(cause)); } finally { setBusy(false); }
  }
  const field = "min-h-11 lg:min-h-9";
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!invalid && slots.length <= 28 && !busy) void save(); }} data-testid="hours-form">
    <label className="block space-y-1 text-sm font-medium">{t("timezone")}
      <NativeSelect value={zone} onChange={(event) => { setSaved(false); setZone(event.target.value); }} className={field}>{options.map((name) => <NativeSelectOption key={name} value={name}>{name}</NativeSelectOption>)}</NativeSelect></label>
    <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">{t("open")}</legend>
      {slots.length === 0 && <p className="text-sm text-muted-foreground" data-testid="hours-none">{t("none")}</p>}
      {slots.map((slot, index) => <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 sm:grid-cols-[minmax(0,1.4fr)_1fr_1fr_auto]" data-testid="hours-row">
        <label className="col-span-3 space-y-1 text-xs text-muted-foreground sm:col-span-1">{t("day")}
          <NativeSelect value={slot.day} onChange={(event) => edit(index, { day: Number(event.target.value) })} className={field}>{weekdays.map((day, at) => <NativeSelectOption key={day} value={day}>{names[at]}</NativeSelectOption>)}</NativeSelect></label>
        <label className="space-y-1 text-xs text-muted-foreground">{t("from")}<Input type="time" value={slot.start} onChange={(event) => edit(index, { start: event.target.value })} className={field} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">{t("to")}<Input type="time" value={slot.end} onChange={(event) => edit(index, { end: event.target.value })} className={field} /></label>
        <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("remove", { day: names[slot.day - 1] })} onClick={() => { setSaved(false); setSlots((current) => current.filter((_, at) => at !== index)); }}><Trash2 aria-hidden="true" /></Button>
      </div>)}
      <Button type="button" variant="outline" size="responsive" aria-disabled={slots.length >= 28 || undefined} onClick={() => { if (slots.length < 28) { setSaved(false); setSlots((current) => [...current, { day: 1, start: "09:00", end: "17:00" }]); } }}><Plus aria-hidden="true" />{t("add")}</Button>
      {invalid && <p role="alert" className="text-sm text-destructive">{t("invalid")}</p>}
    </fieldset>
    <label className="block space-y-1 text-sm font-medium">{t("away")}
      <Textarea value={away} maxLength={1000} onChange={(event) => { setSaved(false); setAway(event.target.value); }} className="min-h-24" /></label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {saved && <p role="status" className="text-sm text-muted-foreground" data-testid="hours-saved">{t("saved")}</p>}
    <Button type="submit" size="responsive" aria-disabled={invalid || busy || undefined}>{busy && <Spinner />}{t("save")}</Button>
  </form>;
}
