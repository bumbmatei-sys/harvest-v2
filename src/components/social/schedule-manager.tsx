"use client";
import { useState } from "react";
import { joinParts } from "@/lib/social/join";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { socialApi, SocialApiError, type Schedule } from "@/lib/social/api";
import { platformLabels } from "@/lib/social/labels";
import { socialPlatforms, platformCapabilities, type SocialPlatform } from "@/lib/social/platforms";
import { browserTimeZone, timeZones } from "@/lib/social/time";

type Slot = { day: number; time: string };
const postable = socialPlatforms.filter((platform) => platformCapabilities[platform].postTypes.post !== "unavailable");

/** Create, change or archive posting schedules: the ministry default, or one per platform, each a set of weekly slots in one time zone. */
export function ScheduleManager({ tenantId, open, onOpenChange, schedules, onChanged }: {
  tenantId: string; open: boolean; onOpenChange: (open: boolean) => void; schedules: readonly Schedule[]; onChanged: () => void;
}) {
  const t = useTranslations("SocialPublish.schedules"), api = socialApi(tenantId);
  const [editing, setEditing] = useState<Schedule | "new" | null>(null), [name, setName] = useState(""), [platform, setPlatform] = useState<SocialPlatform | "">("");
  const [zone, setZone] = useState(browserTimeZone()), [slots, setSlots] = useState<Slot[]>([{ day: 1, time: "09:00" }]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const days = [0, 1, 2, 3, 4, 5, 6], taken = new Set(schedules.map((item) => item.platform ?? ""));
  function begin(next: Schedule | "new") {
    setError(""); setEditing(next);
    if (next === "new") { setName(""); setPlatform(taken.has("") ? postable.find((item) => !taken.has(item)) ?? "" : ""); setZone(browserTimeZone()); setSlots([{ day: 1, time: "09:00" }]); }
    else { setName(next.name); setPlatform(next.platform ?? ""); setZone(next.timezone); setSlots(next.slots.map((slot) => ({ ...slot }))); }
  }
  const explain = (cause: unknown) => cause instanceof SocialApiError ? t.has(`errors.${cause.code}`) ? t(`errors.${cause.code}`) : t("failed") : t("failed");
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = { name, timezone: zone, slots };
      if (editing === "new") await api.createSchedule({ ...body, platform: platform || null }); else if (editing) await api.updateSchedule(editing.id, { ...body, version: editing.version });
      setEditing(null); onChanged();
    } catch (cause) { setError(explain(cause)); } finally { setBusy(false); }
  }
  async function archive(item: Schedule) {
    setBusy(true); setError("");
    try { await api.archiveSchedule(item.id, item.version); setEditing(null); onChanged(); } catch (cause) { setError(explain(cause)); } finally { setBusy(false); }
  }
  const dayName = (day: number) => new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + day)));
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) { setEditing(null); onOpenChange(next); } }}>
    <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
      <DialogHeader><DialogTitle>{t("title")}</DialogTitle><DialogDescription className="sr-only">{t("title")}</DialogDescription></DialogHeader>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {editing === null ? <div className="space-y-3">
        {schedules.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : <ul className="m-0 list-none space-y-2 p-0">
          {schedules.map((item) => <li key={item.id}><button type="button" onClick={() => begin(item)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{item.name}</span><span className="block truncate text-xs text-muted-foreground">{joinParts([item.platform ? platformLabels[item.platform] : t("everyPlatform"), t("slotCount", { count: item.slots.length }), item.timezone])}</span></span>
          </button></li>)}</ul>}
        <Button type="button" size="responsive" onClick={() => begin("new")}><Plus aria-hidden="true" />{t("new")}</Button>
      </div> : <form onSubmit={save} className="space-y-4">
        <label className="block space-y-1 text-sm font-medium">{t("name")}<Input required value={name} maxLength={120} onChange={(event) => setName(event.target.value)} className="min-h-11" /></label>
        {editing === "new" && <label className="block space-y-1 text-sm font-medium">{t("platform")}<NativeSelect value={platform} onChange={(event) => setPlatform(event.target.value as SocialPlatform | "")} className="min-h-11">
          {!taken.has("") && <NativeSelectOption value="">{t("everyPlatform")}</NativeSelectOption>}
          {postable.filter((item) => !taken.has(item)).map((item) => <NativeSelectOption key={item} value={item}>{platformLabels[item]}</NativeSelectOption>)}</NativeSelect></label>}
        <label className="block space-y-1 text-sm font-medium">{t("timeZone")}<NativeSelect value={zone} onChange={(event) => setZone(event.target.value)} className="min-h-11">
          {timeZones(zone).map((value) => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}</NativeSelect></label>
        <fieldset className="space-y-2"><legend className="text-sm font-medium">{t("slots")}</legend>
          {slots.map((slot, index) => <div key={index} className="flex items-center gap-2">
            <NativeSelect aria-label={t("day")} value={slot.day} onChange={(event) => setSlots(slots.map((entry, i) => i === index ? { ...entry, day: Number(event.target.value) } : entry))} className="min-h-11 flex-1">
              {days.map((day) => <NativeSelectOption key={day} value={day}>{dayName(day)}</NativeSelectOption>)}</NativeSelect>
            <Input type="time" required aria-label={t("time")} value={slot.time} onChange={(event) => setSlots(slots.map((entry, i) => i === index ? { ...entry, time: event.target.value } : entry))} className="min-h-11 w-32" />
            <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("removeSlot")} disabled={slots.length === 1} onClick={() => setSlots(slots.filter((_, i) => i !== index))}><Trash2 aria-hidden="true" /></Button>
          </div>)}
          <Button type="button" variant="outline" size="responsive" onClick={() => setSlots([...slots, { day: 1, time: "09:00" }])}><Plus aria-hidden="true" />{t("addSlot")}</Button>
        </fieldset>
        <DialogFooter className="gap-2 sm:justify-between">
          {editing !== "new" ? <Button type="button" variant="outline" size="responsive" disabled={busy} onClick={() => void archive(editing)}>{t("archive")}</Button> : <span />}
          <span className="flex gap-2"><Button type="button" variant="outline" size="responsive" disabled={busy} onClick={() => setEditing(null)}>{t("back")}</Button>
            <Button type="submit" size="responsive" aria-disabled={busy || undefined}>{t("save")}</Button></span>
        </DialogFooter>
      </form>}
    </DialogContent>
  </Dialog>;
}
