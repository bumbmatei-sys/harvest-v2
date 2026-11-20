"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, ChevronDown, Laugh, Save, Send, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState } from "@/components/empty-state";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/status-badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { socialApi, SocialApiError, type Delivery, type DestinationPreview, type Target } from "@/lib/social/api";
import { buildDocument, destinationOf, emptyComposer, mediaMode, ringFor, stateFromDocument, uploading, type Attachment, type ComposerState, type DestinationState } from "@/lib/social/composer-state";
import { mediaKind } from "@/lib/social/media";
import { acceptsMime, PutError, uploadMedia } from "@/lib/social/media-upload";
import { notify } from "@/lib/toast";
import { ComposerPreview } from "@/components/social/composer-preview";
import { DeliveryResults } from "@/components/social/delivery-results";
import { DestinationCard } from "@/components/social/destination-card";
import { DraftsPanel } from "@/components/social/drafts-panel";
import { MediaStrip } from "@/components/social/media-strip";
import { ConnectCircle, PlatformRing } from "@/components/social/platform-ring";
import { OptionRows } from "@/components/social/option-rows";
import { ReviewDialog } from "@/components/social/review-dialog";
import { ScheduleDialog } from "@/components/social/schedule-dialog";
import { ScheduleManager } from "@/components/social/schedule-manager";
import { SocialHeader, SocialToolbar } from "@/components/social/social-nav";
import { useReason } from "@/components/social/use-reason";
import { useSocialData } from "@/components/social/use-social-data";
import { platformLabels } from "@/lib/social/labels";
import { browserTimeZone } from "@/lib/social/time";

const emoji = ["🙏", "✝️", "❤️", "🙌", "😊", "🎉", "📖", "🕊️", "🌟", "🔥", "👏", "💛", "☀️", "🌿", "🎶", "📣", "📅", "📍", "✨", "😇", "🤝", "💬", "🙂", "😍"];

export function Composer({ tenantId, initialDraftId }: { tenantId: string; initialDraftId: string | null }) {
  const t = useTranslations("SocialPublish.composer"), reason = useReason(), router = useRouter(), params = useSearchParams();
  const data = useSocialData(tenantId), api = useMemo(() => socialApi(tenantId), [tenantId]);
  const [state, setState] = useState<ComposerState>(() => emptyComposer()), [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  const [previews, setPreviews] = useState<DestinationPreview[]>([]), [previewing, setPreviewing] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({}), [busy, setBusy] = useState<"" | "save" | "schedule" | "publish">("");
  const [error, setError] = useState(""), [notice, setNotice] = useState<{ kind: "saved" | "scheduled"; id?: string } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false), [manageOpen, setManageOpen] = useState(false), [draftsOpen, setDraftsOpen] = useState(false);
  const [review, setReview] = useState<{ token: string; expiresAt: string; destinations: DestinationPreview[]; version: number } | null>(null);
  const [result, setResult] = useState<{ id: string; version: number; deliveries: Delivery[] } | null>(null), [retrying, setRetrying] = useState<string | null>(null);
  const [schedule, setSchedule] = useState(params.get("schedule") ?? "");
  const controllers = useRef(new Map<string, AbortController>());
  const urls = useRef(new Set<string>());
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });

  // Load a stored draft once its connections are known.
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (!initialDraftId || data.state !== "ready" || loaded.current === initialDraftId) return;
    loaded.current = initialDraftId;
    void api.draft(initialDraftId).then(({ draft: stored }) => {
      if (stored.status !== "draft") { setError(t("notEditable")); return; }
      setState(stateFromDocument(stored.document)); setDraft({ id: stored.id, version: stored.version });
    }).catch(() => setError(t("draftMissing")));
  }, [api, data.state, initialDraftId, t]);

  const selected = data.connections.filter((connection) => state.connectionIds.includes(connection.id));
  const document = useMemo(() => buildDocument(state, data.connections), [state, data.connections]);
  const documentKey = JSON.stringify(document);
  useEffect(() => {
    if (data.state !== "ready" || document.connectionIds.length === 0) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the check as running while the debounced call is pending
    setPreviewing(true);
    const timer = setTimeout(() => {
      void api.preview(document, controller.signal).then((response) => setPreviews(response.destinations)).catch((cause: unknown) => { if (!controller.signal.aborted && !(cause instanceof DOMException)) setPreviews([]); })
        .finally(() => { if (!controller.signal.aborted) setPreviewing(false); });
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
    // The document is compared by value so typing does not restart the call twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, data.state, documentKey]);
  useEffect(() => () => { for (const controller of controllers.current.values()) controller.abort(); for (const url of urls.current) URL.revokeObjectURL(url); }, []);

  const patchAttachment = useCallback((key: string, patch: Partial<Attachment>) => setState((current) => ({ ...current, attachments: current.attachments.map((item) => item.key === key ? { ...item, ...patch } : item) })), []);
  const describe = useCallback((cause: unknown) => {
    if (cause instanceof SocialApiError) {
      if (cause.unavailable) return t("unavailable");
      if (cause.conflict && cause.code !== "REVIEW_REQUIRED") return t("changed");
      const destinations = cause.details.destinations as { errors: string[] }[] | undefined;
      return reason(destinations?.[0]?.errors[0] ?? cause.code ?? "UNKNOWN");
    }
    return t("failed");
  }, [reason, t]);

  function addFiles(files: File[]) {
    for (const file of files) {
      const key = crypto.randomUUID(), previewUrl = URL.createObjectURL(file), kind = mediaKind(file.type);
      urls.current.add(previewUrl);
      const base: Attachment = { key, fileId: null, name: file.name, mime: file.type, size: file.size, kind, previewUrl, altText: "", phase: "hashing", progress: 0, error: null };
      if (!acceptsMime(file.type)) { setState((current) => ({ ...current, attachments: [...current.attachments, { ...base, phase: "failed", error: t("typeNotAllowed") }] })); continue; }
      const controller = new AbortController(); controllers.current.set(key, controller);
      setState((current) => ({ ...current, attachments: [...current.attachments, base] }));
      void uploadMedia(tenantId, file, { signal: controller.signal, phase: (phase) => patchAttachment(key, { phase }), progress: (progress) => patchAttachment(key, { progress }) })
        .then((stored) => patchAttachment(key, { fileId: stored.id, phase: stored.status === "ready" ? "ready" : "quarantined", progress: 100,
          ...(stored.mediaMetadata ?? {}), error: null }))
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          patchAttachment(key, { phase: "failed", error: cause instanceof PutError ? t(cause.code === "CONNECTION" ? "uploadConnection" : "uploadFailed") : describe(cause) });
        }).finally(() => controllers.current.delete(key));
    }
  }
  const removeAttachment = (key: string) => {
    controllers.current.get(key)?.abort(); controllers.current.delete(key);
    setState((current) => ({ ...current, attachments: current.attachments.filter((item) => item.key !== key),
      destinations: Object.fromEntries(Object.entries(current.destinations).map(([platform, own]) => [platform, own && own.mediaKeys ? { ...own, mediaKeys: own.mediaKeys.filter((entry) => entry !== key) } : own])) }));
  };
  const moveAttachment = (from: number, to: number) => setState((current) => {
    const next = [...current.attachments], [moved] = next.splice(from, 1); next.splice(to, 0, moved); return { ...current, attachments: next };
  });
  const setDestination = (platform: keyof ComposerState["destinations"], next: DestinationState) => setState((current) => ({ ...current, destinations: { ...current.destinations, [platform]: next } }));
  const toggle = (id: string) => setState((current) => ({ ...current, connectionIds: current.connectionIds.includes(id) ? current.connectionIds.filter((entry) => entry !== id) : [...current.connectionIds, id] }));
  const insertEmoji = (value: string) => setState((current) => ({ ...current, content: current.content + value }));

  const shownPreviews = document.connectionIds.length === 0 ? [] : previews;
  const issues = shownPreviews.flatMap((preview) => preview.errors.map((code) => ({ id: preview.account.id, platform: preview.account.platform, code })));
  const blocked = uploading(state) || selected.length === 0 || (!state.content.trim() && state.attachments.length === 0) || previewing || issues.length > 0;
  const blockedText = uploading(state) ? t("blockedUploading") : selected.length === 0 ? t("blockedNoAccount") : !state.content.trim() && state.attachments.length === 0 ? t("blockedEmpty") : previewing ? t("blockedChecking")
    : issues.length ? t("blockedIssues", { count: issues.length }) : "";

  async function persist() {
    const body = buildDocument(stateRef.current, data.connections);
    if (!draft) { const created = await api.saveDraft(body); setDraft({ id: created.draft.id, version: created.draft.version }); return { id: created.draft.id, version: created.draft.version }; }
    const saved = await api.change(draft.id, { action: "save", version: draft.version, document: body });
    setDraft({ id: saved.draft.id, version: saved.draft.version }); return { id: saved.draft.id, version: saved.draft.version };
  }
  async function run(kind: "save" | "schedule" | "publish", work: () => Promise<void>) {
    setBusy(kind); setError(""); setNotice(null);
    try { await work(); } catch (cause) { setError(describe(cause)); throw cause; } finally { setBusy(""); }
  }
  const saveDraft = () => void run("save", async () => { await persist(); setNotice({ kind: "saved" }); data.reload(); }).catch(() => undefined);
  const reset = () => { setState(emptyComposer(state.type)); setDraft(null); setPreviews([]); data.reload(); if (initialDraftId) router.replace(`/workspaces/${tenantId}/social/compose`); };
  async function doSchedule(target: Target) {
    await run("schedule", async () => { const saved = await persist(); const done = await api.change(saved.id, { action: "schedule", version: saved.version, target }); reset(); setNotice({ kind: "scheduled", id: done.draft.id });
      notify.success(t("scheduledToast")); });
  }
  const startPublish = () => void run("publish", async () => {
    const saved = await persist(); const reviewed = await api.change(saved.id, { action: "review", version: saved.version });
    setDraft({ id: reviewed.draft.id, version: reviewed.draft.version });
    setReview({ ...reviewed.review!, version: reviewed.draft.version });
  }).catch(() => undefined);
  async function confirmPublish() {
    if (!review || !draft) return;
    try {
      const done = await api.change(draft.id, { action: "publishNow", version: review.version, reviewToken: review.token, timezone: browserTimeZone() });
      setResult({ id: done.draft.id, version: done.draft.version, deliveries: done.draft.destinations }); setReview(null); setState(emptyComposer(state.type)); setDraft(null); setPreviews([]); data.reload();
    } catch (cause) { throw new Error(describe(cause)); }
  }
  // Results of a publish arrive from the worker: keep the list fresh while anything is still going out.
  useEffect(() => {
    if (!result || !result.deliveries.some((delivery) => delivery.status === "scheduled" || delivery.status === "publishing")) return;
    const timer = setInterval(() => void api.draft(result.id).then(({ draft: fresh }) => setResult({ id: fresh.id, version: fresh.version, deliveries: fresh.destinations })).catch(() => undefined), 4000);
    return () => clearInterval(timer);
  }, [api, result]);
  async function retry(delivery: Delivery) {
    if (!result) return; setRetrying(delivery.id);
    try { const next = await api.change(result.id, { action: "retry", version: result.version, deliveries: [{ id: delivery.id, version: delivery.version }] });
      setResult({ id: next.draft.id, version: next.draft.version, deliveries: next.draft.destinations }); } catch (cause) { setError(describe(cause)); } finally { setRetrying(null); }
  }
  async function duplicateDraft(summary: { id: string; version: number }) {
    try { const copy = await api.change(summary.id, { action: "duplicate", version: summary.version }); setDraftsOpen(false); router.push(`/workspaces/${tenantId}/social/compose?draft=${copy.draft.id}`); data.reload(); }
    catch (cause) { notify.error(describe(cause)); }
  }

  const tz = browserTimeZone();
  const toolbarProps = { schedules: data.schedules, schedule, onSchedule: setSchedule, onManage: () => setManageOpen(true), draftCount: data.drafts.length, onDrafts: () => setDraftsOpen(true) };
  if (data.state === "loading") return <div className="space-y-4" aria-busy="true"><Skeleton className="h-16 w-full" /><Skeleton className="h-64 w-full" /></div>;
  const frame = (body: React.ReactNode) => <div className="min-w-0 space-y-4"><SocialHeader tenantId={tenantId} active="compose" zone={tz} />{body}</div>;
  if (data.state === "unavailable") return frame(<EmptyState icon={ShieldAlert} title={t("unavailableTitle")} description={t("unavailable")} solid />);
  if (data.state === "error") return frame(<Alert variant="destructive" role="alert"><AlertDescription>{t("loadFailed")} <Button type="button" variant="link" onClick={data.reload}>{t("retry")}</Button></AlertDescription></Alert>);
  if (data.connections.length === 0) return frame(<EmptyState icon={ShieldAlert} title={t("noAccounts")} solid action={<Button asChild size="responsive"><Link href={`/workspaces/${tenantId}/social/accounts`} prefetch={false}>{t("goToAccounts")}</Link></Button>} />);

  const typeSupported = (type: ComposerState["type"]) => data.connections.some((connection) => connection.availability === "available" && connection.capabilities.postTypes[type] !== "unavailable");
  const off = blocked || busy !== "";
  const actions = <>
    <Button type="button" variant="outline" size="responsive" aria-disabled={busy !== "" || undefined} onClick={saveDraft}><Save aria-hidden="true" />{t("saveDraft")}</Button>
    <div className="inline-flex" role="group" aria-label={t("schedule")}>
      <Button type="button" variant="outline" size="responsive" className="rounded-r-none" aria-disabled={off || undefined} onClick={() => { if (!off) setScheduleOpen(true); }}><CalendarClock aria-hidden="true" />{t("schedule")}</Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" size="icon-responsive" className="-ml-px rounded-l-none" aria-label={t("scheduleMore")} aria-disabled={off || undefined}><ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuItem disabled={off} className="min-h-11 lg:min-h-8" onSelect={() => setScheduleOpen(true)}>{t("pickTime")}</DropdownMenuItem>
          <DropdownMenuItem disabled={off} className="min-h-11 lg:min-h-8" onSelect={() => void doSchedule({ kind: "next", ...(schedule ? { scheduleId: schedule } : {}) })}>{t("nextSlot")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </div>
    <Button type="button" size="responsive" aria-disabled={off || undefined} onClick={() => { if (!off) startPublish(); }}><Send aria-hidden="true" />{t("publishNow")}</Button>
  </>;
  const tiktok = selected.find((connection) => connection.platform === "tiktok");
  const mode = mediaMode(state.attachments.filter((item) => item.phase === "ready"));
  return <div className="min-w-0 space-y-4">
    <SocialHeader tenantId={tenantId} active="compose" zone={tz} />
    <SocialToolbar {...toolbarProps}>{draft && <StatusBadge tone="neutral" label={t("draft")} />}{actions}</SocialToolbar>
    {blockedText && <p role="status" className="text-sm text-muted-foreground" data-testid="blocked-reason">{blockedText}</p>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <Alert role="status" data-testid="composer-notice"><AlertDescription>{notice.kind === "saved" ? t("savedNotice") : <>{t("scheduledNotice")} <Link href={`/workspaces/${tenantId}/social/planner?view=queue`} prefetch={false} className="underline">{t("viewQueue")}</Link></>}</AlertDescription></Alert>}
    {result && <section className="space-y-2 rounded-xl border bg-card p-4"><h2 className="text-sm font-semibold">{t("results")}</h2><DeliveryResults deliveries={result.deliveries} connections={data.connections} retrying={retrying} onRetry={(delivery) => void retry(delivery)} /></section>}
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4" aria-label={t("title")} data-testid="composer">
        <div className="space-y-1">
          <ToggleGroup type="single" variant="outline" value={state.type} aria-label={t("postType")} onValueChange={(value) => { if (value) setState((current) => ({ ...current, type: value as ComposerState["type"] })); }}>
            <ToggleGroupItem value="post" className="min-h-11 px-4 lg:min-h-9">{t("types.post")}</ToggleGroupItem>
            <ToggleGroupItem value="article" disabled className="min-h-11 px-4 lg:min-h-9">{t("types.article")}</ToggleGroupItem>
            <ToggleGroupItem value="story" disabled={!typeSupported("story")} className="min-h-11 px-4 lg:min-h-9">{t("types.story")}</ToggleGroupItem>
          </ToggleGroup>
          <p className="text-xs text-muted-foreground" data-testid="type-note">{t("articleNote")}{!typeSupported("story") && ` ${t("storyNote")}`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("postTo")}>
          <span className="mr-1 text-sm font-medium" id="post-to">{t("postTo")}</span>
          {data.connections.map((connection) => {
            const name = connection.displayName ?? platformLabels[connection.platform];
            const disabledReason = connection.availability === "unavailable" ? t("accountNeedsAttention") : connection.capabilities.postTypes[state.type] === "unavailable" ? t("typeUnsupported", { platform: platformLabels[connection.platform] }) : undefined;
            return <PlatformRing key={connection.id} platform={connection.platform} accountName={name} count={ringFor(state, connection.platform)} selected={state.connectionIds.includes(connection.id)} disabledReason={disabledReason} onToggle={() => toggle(connection.id)} />;
          })}
          <ConnectCircle href={`/workspaces/${tenantId}/social/accounts`} label={t("connectAnother")} />
        </div>
        <MediaStrip attachments={state.attachments} onFiles={addFiles} onMove={moveAttachment} onRemove={removeAttachment} onCancel={removeAttachment} onAlt={(key, altText) => patchAttachment(key, { altText })}
          toolbar={<Popover><PopoverTrigger asChild><Button type="button" variant="ghost" size="icon-responsive" aria-label={t("emoji")}><Laugh aria-hidden="true" /></Button></PopoverTrigger>
            <PopoverContent className="w-64"><div className="grid grid-cols-6 gap-1" role="group" aria-label={t("emoji")}>{emoji.map((value) => <button key={value} type="button" onClick={() => insertEmoji(value)} className="min-h-11 rounded-md text-xl outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-9">{value}</button>)}</div></PopoverContent></Popover>}>
          <Textarea id="post-text" aria-label={t("text")} placeholder={t("placeholder")} value={state.content} onChange={(event) => setState((current) => ({ ...current, content: event.target.value }))}
            className="min-h-32 resize-y border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent" />
        </MediaStrip>
        <OptionRows connections={selected} type={state.type} mode={mode} shared={state.shared} onShared={(shared) => setState((current) => ({ ...current, shared }))}
          tiktok={tiktok ? destinationOf(state, "tiktok").options : undefined} onTiktok={(patch) => setDestination("tiktok", { ...destinationOf(state, "tiktok"), options: { ...destinationOf(state, "tiktok").options, ...patch } })} />
      </section>
      <aside className="min-w-0 space-y-4" aria-label={t("preview")}>
        <ComposerPreview state={state} connections={data.connections} previews={shownPreviews} />
        <section className="space-y-2" aria-labelledby="each-platform"><h2 id="each-platform" className="text-sm font-semibold">{t("eachPlatform")}</h2>
          {selected.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{t("noneSelected")}</p> : <div className="space-y-2">
            {selected.map((connection) => <DestinationCard key={connection.id} connection={connection} type={state.type} state={destinationOf(state, connection.platform)} count={ringFor(state, connection.platform)}
              attachments={state.attachments} preview={shownPreviews.find((item) => item.account.id === connection.id)} open={open[connection.id] ?? false}
              onOpenChange={(value) => setOpen((current) => ({ ...current, [connection.id]: value }))} onChange={(next) => setDestination(connection.platform, next)} />)}</div>}
        </section>
      </aside>
    </div>
    <ScheduleDialog key={String(scheduleOpen)} open={scheduleOpen} onOpenChange={setScheduleOpen} title={t("scheduleTitle")} confirmLabel={t("scheduleConfirm")} schedules={data.schedules} scheduleId={schedule || undefined} onConfirm={doSchedule} />
    <ReviewDialog open={review !== null} onOpenChange={(next) => { if (!next) setReview(null); }} destinations={review?.destinations ?? []} expiresAt={review?.expiresAt} onConfirm={confirmPublish} />
    <ScheduleManager tenantId={tenantId} open={manageOpen} onOpenChange={setManageOpen} schedules={data.schedules} onChanged={data.reload} />
    <Sheet open={draftsOpen} onOpenChange={setDraftsOpen}><SheetContent className="w-full overflow-y-auto sm:max-w-md" aria-describedby={undefined}>
      <SheetHeader><SheetTitle>{t("draftsTitle")}</SheetTitle></SheetHeader>
      <div className="p-4 pt-0"><DraftsPanel tenantId={tenantId} drafts={data.drafts} connections={data.connections} onDuplicate={(item) => void duplicateDraft(item)} /></div>
    </SheetContent></Sheet>
  </div>;
}
