/** "Also publish to": the article's copies on connected blogs. Built from existing Harvest parts only (FormSection, StatusBadge, NativeSelect, Field, EmptyState, PlatformLogo); no kit item. */
"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Link2, RefreshCw, Send, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EmptyState } from "@/components/empty-state";
import { FormSection } from "@/components/form-section";
import { StatusBadge } from "@/components/status-badge";
import { PlatformLogo } from "@/components/social/platform-logo";
import { useRequest } from "@/hooks/use-request";
import { platformLabels } from "@/lib/social/labels";
import { scheduleInputValue, zonedSchedule } from "@/lib/newsletter-schedule";
import { defineStatusTones } from "@/lib/status-tone";
import { notify } from "@/lib/toast";
import type { BlogOwnerPost } from "@/server/blog";
import type { ExternalBlogOptions, ExternalDeliveryView } from "@/server/external-blog";

type Destination = ExternalBlogOptions["destinations"][number];
type Mode = "draft" | "same_time" | "own_time";
const tone = defineStatusTones({ none: "neutral", queued: "pending", scheduled_on_blog: "info", published: "success", draft_on_blog: "neutral", failed: "danger", changed_on_blog: "warning" });
const defaultSlot = (zone: string) => `${scheduleInputValue(new Date(Date.now() + 86_400_000), zone).slice(0, 10)}T09:00`;

/** Copies on connected blogs. Hidden while the integration is unavailable; an empty catalog links to the account connections. */
export function ExternalBlogSection({ tenantId, post, timeZone, ensureSaved, busy }: {
  tenantId: string; post: BlogOwnerPost; timeZone: string; busy: boolean;
  /** Saves pending editor changes first; null when the save failed (the editor shows why). */
  ensureSaved: () => Promise<BlogOwnerPost | null>;
}) {
  const t = useTranslations("Blog.external"), request = useRequest();
  const api = `/api/workspaces/${tenantId}/blog/posts/${post.id}/destinations`;
  const [data, setData] = useState<ExternalBlogOptions | null | "off">(null), [reloadKey, setReloadKey] = useState(0);
  // Warnings and the "copy changed" state follow the saved version.
  useEffect(() => {
    let live = true;
    void request<ExternalBlogOptions>(api, { method: "GET" }).then((result) => { if (live) setData(result.ok ? result.data : "off"); });
    return () => { live = false; };
  }, [api, request, post.version, reloadKey]);
  const load = useCallback(async () => setReloadKey((key) => key + 1), []);
  if (data === "off") return null;
  return <FormSection title={<span className="text-base font-semibold">{t("title")}</span>}>
    <div data-blog-external aria-busy={data === null ? true : undefined}>
      {data === null ? null : data.destinations.length === 0
        ? <EmptyState size="compact" icon={Link2} title={t("empty")} action={<Button asChild variant="outline" className="min-h-11"><Link href={`/workspaces/${tenantId}/social/accounts`}>{t("connect")}</Link></Button>} />
        : <ul className="m-0 list-none space-y-3 p-0">{data.destinations.map((destination) =>
          <DestinationRow key={destination.id} destination={destination} post={post} timeZone={timeZone} disabled={busy} api={api} ensureSaved={ensureSaved} onDone={load} />)}</ul>}
    </div>
  </FormSection>;
}

function DestinationRow({ destination, post, timeZone, disabled, api, ensureSaved, onDone }: {
  destination: Destination; post: BlogOwnerPost; timeZone: string; disabled: boolean; api: string;
  ensureSaved: () => Promise<BlogOwnerPost | null>; onDone: () => Promise<void>;
}) {
  const t = useTranslations("Blog.external"), request = useRequest();
  const delivery: ExternalDeliveryView | null = destination.delivery;
  const harvestTime = post.status !== "draft";
  const nativeSchedule = destination.capabilities.nativeSchedule;
  // A blog without its own scheduler takes only drafts and live copies.
  const modeAllowed = (value: Mode) => value === "draft" || (value === "same_time" ? harvestTime && (nativeSchedule || post.status === "published") : nativeSchedule);
  const [mode, setMode] = useState<Mode>(() => delivery?.mode ?? (modeAllowed("same_time") ? "same_time" : "draft"));
  const [slot, setSlot] = useState(() => delivery?.mode === "own_time" && delivery.requestedAt ? scheduleInputValue(delivery.requestedAt, timeZone) : defaultSlot(timeZone));
  const [working, setWorking] = useState(false);
  const name = destination.title, platform = platformLabels[destination.platform];
  const ready = destination.authorization === "authorized" && destination.health !== "failing";
  const queued = delivery?.status === "queued";
  const status = delivery?.status ?? "none";
  const copyChanged = Boolean(delivery?.remote) && (delivery!.pushedVersion !== post.version || delivery!.scheduleUpdateAvailable || status === "changed_on_blog");
  const needsCheck = delivery?.reason === "outcome_unknown";
  const id = `blog-external-${destination.id}`;

  async function send(operation: "push" | "update" | "check") {
    setWorking(true);
    const current = await ensureSaved();
    if (!current) { setWorking(false); return; }
    let timing: Record<string, string> | undefined;
    if (operation !== "check") {
      if (mode === "own_time") {
        const at = zonedSchedule(slot, timeZone);
        if (!at) { notify.error(t("pickTime")); setWorking(false); return; }
        timing = { mode, at: at.at };
      } else timing = { mode };
    }
    const result = await request(api, { method: "POST", body: { version: current.version, destinationId: destination.id, operation, ...(timing ? { timing } : {}) } });
    setWorking(false);
    if (!result.ok) { notify.error(result.error); return; }
    notify.success(t(operation === "check" ? "checking" : "queued", { blog: name }));
    await onDone();
  }

  return <li className="space-y-3 rounded-lg border bg-card p-3" data-blog-destination={destination.platform} data-status={status}>
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <PlatformLogo platform={destination.platform} className="size-4 shrink-0" />
      <span className="min-w-0 truncate text-sm font-medium">{name}</span>
      <span className="text-xs text-muted-foreground">{platform}</span>
      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        <StatusBadge tone={tone(status)} label={t(`status.${status}`)} dot />
        {!ready && <StatusBadge tone="danger" label={t("reconnect")} />}
      </span>
    </div>
    {delivery?.remoteUrl && <Button asChild variant="link" className="h-auto min-h-11 justify-start px-0">
      <a href={delivery.remoteUrl} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />{t("open")}<span className="sr-only"> {t("on", { blog: name })}</span></a></Button>}
    {ready && (!delivery?.remote || copyChanged || needsCheck) && <div className="flex flex-wrap items-end gap-2">
      <Field className="w-auto min-w-40 flex-1 basis-40"><FieldLabel htmlFor={`${id}-mode`}>{t("timing")}<span className="sr-only"> {t("on", { blog: name })}</span></FieldLabel>
        <NativeSelect id={`${id}-mode`} value={mode} disabled={disabled || working || queued} onChange={(e) => setMode(e.target.value as Mode)} className="min-h-11 w-full">
          {(["draft", "same_time", "own_time"] as const).map((value) => <NativeSelectOption key={value} value={value} disabled={!modeAllowed(value)}>{t(`modes.${value}`)}</NativeSelectOption>)}
        </NativeSelect></Field>
      {mode === "own_time" && <Field className="w-auto min-w-0 flex-1 basis-48"><FieldLabel htmlFor={`${id}-at`}>{t("at")}<span className="sr-only"> {t("on", { blog: name })}</span></FieldLabel>
        <Input id={`${id}-at`} type="datetime-local" className="min-h-11" value={slot} disabled={disabled || working || queued} onChange={(e) => setSlot(e.target.value)} /></Field>}
      <div className="flex flex-wrap gap-2 max-sm:w-full">
        {!delivery?.remote && !needsCheck && <Button type="button" className="min-h-11 max-sm:flex-1" disabled={disabled || working || queued || !modeAllowed(mode)} onClick={() => void send("push")}>
          <Send aria-hidden="true" />{t("send")}<span className="sr-only"> {t("on", { blog: name })}</span></Button>}
        {copyChanged && <Button type="button" className="min-h-11 max-sm:flex-1" disabled={disabled || working || queued || !modeAllowed(mode)} onClick={() => void send("update")}>
          <RefreshCw aria-hidden="true" />{t("update", { blog: name })}</Button>}
        {needsCheck && <Button type="button" variant="outline" className="min-h-11 max-sm:flex-1" disabled={disabled || working || queued} onClick={() => void send("check")}>
          {t("check")}<span className="sr-only"> {t("on", { blog: name })}</span></Button>}
      </div>
    </div>}
    {destination.warnings.length > 0 && <ul className="m-0 list-none space-y-1 p-0 text-xs text-muted-foreground" aria-label={t("warnings", { blog: name })} data-blog-warnings>
      {destination.warnings.map((warning) => <li key={warning} className="flex items-start gap-1.5"><TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />{t(`warning.${warning}`)}</li>)}
    </ul>}
  </li>;
}
