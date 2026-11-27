"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Check, Circle, ExternalLink, EyeOff, Eye, GripVertical, Inbox, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { useCrmRequest } from "@/components/crm/request";
import { EditorShell } from "@/components/editor/editor-shell";
import { useEditorHosted } from "@/components/editor/editor-context";
import { EventCoverPicker, type CoverChange } from "@/components/events/event-cover-picker";
import { useEventCoverUrl } from "@/components/events/use-event-cover-url";
import { BioPageView } from "@/components/link-in-bio/bio-view";
import { FormSection } from "@/components/form-section";
import { StatusBadge } from "@/components/status-badge";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { WizardLayout } from "@/components/wizard-layout";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { bioDetailKinds, bioIcons, bioLimits, bioNetworks, bioSchemes, bioTabIds, bioButtonStyles, fieldIssues, handleProblem, newBlockId, moveItem, publishIssues,
  type BioBlock, type BioDefinition, type BioDetailKind, type BioTabId, type BioView, type BioViewBlock, type HandleProblem } from "@/lib/link-in-bio";
import { cn } from "@/lib/utils";
import type { BioChoices, BioOwnerView } from "@/server/link-in-bio";

type Step = "profile" | "content" | "design" | "publish";
const steps: Step[] = ["profile", "content", "design", "publish"];
type Fields = { handle: string; definition: BioDefinition };
const same = (a: Fields, b: Fields) => JSON.stringify(a) === JSON.stringify(b);

/** The preview's data: the draft as a visitor would see it (hidden blocks, details and tabs left out), with the owner's own community names. */
export function draftView(definition: BioDefinition, choices: BioChoices, ministryName: string, brandTheme: string | null, hasPhoto: boolean, hasCover: boolean): BioView {
  const project = (block: BioBlock): BioViewBlock[] => {
    if (block.hidden) return [];
    switch (block.type) {
      case "link": return [{ type: "link", id: block.id, label: block.label || "…", url: block.url, icon: block.icon }];
      case "event": return [{ type: "event", id: block.id, title: block.title || "…", when: block.when, url: block.url }];
      case "community": { const c = choices.communities.find((x) => x.id === block.communityId); return c ? [{ type: "community", id: block.id, name: c.name, tagline: null, slug: "" }] : []; }
      case "newsletter": return [{ type: "newsletter", id: block.id, slug: block.slug }];
      case "message": return [{ type: "message", id: block.id, title: block.title || "…" }];
      case "giving": return choices.giving?.length ? [{ type: "giving", id: block.id, title: block.title || "…", methods: choices.giving }] : [];
    }
  };
  const details = definition.details.filter((d) => !d.hidden && d.value.trim()).map(({ id, kind, value }) => ({ id, kind, value }));
  const tabs = definition.tabs.filter((t) => !t.hidden).map((t) => ({ id: t.id, blocks: definition.blocks.filter((b) => b.tab === t.id).flatMap(project) }))
    .filter((t) => t.blocks.length > 0 || (t.id === "home" && details.length > 0));
  return { ministryName, name: definition.name || "…", subtitle: definition.subtitle, bio: definition.bio, details, tabs, hasPhoto, hasCover, scheme: definition.scheme, buttons: definition.buttons,
    brandTheme: brandTheme as BioView["brandTheme"], socials: definition.socials.filter((s) => /^https:\/\//.test(s.url)) };
}

function Row({ block, index, count, label, issue, clicks, children, onMove, onToggle, onRemove, onTab }: {
  onTab: (tab: BioTabId) => void; block: BioBlock; index: number; count: number; label: string; issue?: "url" | "required"; clicks?: number; children: React.ReactNode;
  onMove: (by: number) => void; onToggle: () => void; onRemove: () => void;
}) {
  const t = useTranslations("LinkInBio");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} data-bio-row={block.id} data-block-type={block.type}
    className={cn("rounded-xl border bg-card", block.hidden && "opacity-70", isDragging && "relative z-10 opacity-80 shadow-lg")}>
    <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1">
      <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={t("links.drag", { label })}
        className="flex size-11 touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"><GripVertical aria-hidden="true" /></button>
      <Badge variant="secondary">{t(block.type === "link" ? "links.label" : `blocks.${block.type}`)}</Badge>
      {block.hidden && <Badge variant="outline">{t("blocks.hiddenBadge")}</Badge>}
      {clicks !== undefined && <span className="text-xs text-muted-foreground">{t("links.clicks", { count: clicks })}</span>}
      <span className="ms-auto flex flex-wrap items-center">
        <Button type="button" variant="ghost" size="icon" className="size-11" disabled={index === 0} aria-label={t("links.moveUp", { label })} onClick={() => onMove(-1)}><ArrowUp aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="icon" className="size-11" disabled={index === count - 1} aria-label={t("links.moveDown", { label })} onClick={() => onMove(1)}><ArrowDown aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="icon" className="size-11" aria-pressed={block.hidden} aria-label={t(block.hidden ? "links.showLabel" : "links.hideLabel", { label })} onClick={onToggle}>{block.hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</Button>
        <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("links.removeLabel", { label })} onClick={onRemove}><Trash2 aria-hidden="true" /></Button>
      </span>
    </div>
    <div className="grid gap-4 p-4 sm:grid-cols-2" data-invalid={issue ? true : undefined}>{children}
      <Field><FieldLabel htmlFor={`t-${block.id}`}>{t("links.tab")}</FieldLabel>
        <NativeSelect id={`t-${block.id}`} className="min-h-11 w-full" value={block.tab} onChange={(e) => onTab(e.target.value as BioTabId)}>{bioTabIds.map((id) => <option key={id} value={id}>{t(`tabs.${id}`)}</option>)}</NativeSelect></Field></div>
  </li>;
}

export function BioEditor({ origin, tenantId, initial, choices, ministryName, brandTheme, base, messagesHref }: { origin: string;
  tenantId: string; initial: BioOwnerView; choices: BioChoices; ministryName: string; brandTheme: string | null; base: string; messagesHref: string;
}) {
  const t = useTranslations("LinkInBio"), request = useCrmRequest(), hosted = useEditorHosted();
  const endpoint = `/api/workspaces/${tenantId}/link-in-bio`;
  const initialFields: Fields = { handle: initial.handle, definition: initial.draft };
  const [data, setData] = useState(initial), [saved, setSaved] = useState(initialFields), [fields, setFields] = useState(initialFields);
  const [step, setStep] = useState<Step>("profile"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [stale, setStale] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false), [confirmUnpublish, setConfirmUnpublish] = useState(false), [touched, setTouched] = useState(false);
  const [handleState, setHandleState] = useState<{ value: string; problem: HandleProblem | "taken" | null; checking: boolean }>({ value: initial.handle, problem: null, checking: false });
  const dirty = !same(fields, saved), published = data.status === "published";
  const { destination, setDestination, leave } = useUnsavedChangesGuard(dirty || busy || coverBusy);
  const photo = useEventCoverUrl(`${endpoint}/photo`, data.photoFileId), banner = useEventCoverUrl(`${endpoint}/banner`, data.coverFileId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const { definition } = fields, issues = fieldIssues(definition), checklist = publishIssues(definition);
  const setDefinition = (patch: Partial<BioDefinition>) => { setNotice(""); setFields((previous) => ({ ...previous, definition: { ...previous.definition, ...patch } })); };
  const setDetails = (change: (list: BioDefinition["details"]) => BioDefinition["details"]) => setDefinition({ details: change(definition.details) });
  const setBlocks = (change: (blocks: BioBlock[]) => BioBlock[]) => setDefinition({ blocks: change(definition.blocks) });
  const patchBlock = (id: string, patch: Record<string, unknown>) => setBlocks((blocks) => blocks.map((b) => b.id === id ? { ...b, ...patch } as BioBlock : b));
  const path = `${base}/l/${fields.handle}`;

  // Handle availability: checked shortly after the person stops typing.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const value = fields.handle;
    if (value === saved.handle || published) return;
    const local = handleProblem(value);
    if (timer.current) clearTimeout(timer.current);
    if (local) { timer.current = setTimeout(() => setHandleState({ value, problem: local, checking: false }), 0); return; }
    timer.current = setTimeout(async () => {
      setHandleState({ value, problem: null, checking: true });
      const result = await request<{ available: boolean; problem: HandleProblem | "taken" | null }>(`${endpoint}/handle?handle=${encodeURIComponent(value)}`, { method: "GET" });
      setHandleState({ value, problem: result.ok ? result.data.problem : null, checking: false });
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [fields.handle, saved.handle, published, endpoint, request]);
  const handleProblemNow = fields.handle !== saved.handle ? (handleProblem(fields.handle) ?? (handleState.value === fields.handle ? handleState.problem : null)) : null;

  function fail(result: { status: number; error: string }) { setStale(result.status === 409); setError(result.error); }
  async function save(): Promise<BioOwnerView | null> {
    setTouched(true);
    if (Object.keys(issues).length || handleProblemNow) { setError(t("publishing.checkFields")); return null; }
    if (!dirty) return data;
    const result = await request<BioOwnerView>(endpoint, { method: "PUT", body: { version: data.version, handle: fields.handle, definition } });
    if (!result.ok) { fail(result); return null; }
    setData(result.data); const next = { handle: result.data.handle, definition: result.data.draft }; setSaved(next); setFields(next);
    return result.data;
  }
  async function run(action: "save" | "publish" | "unpublish") {
    setBusy(true); setError(""); setNotice(""); setStale(false);
    if (action === "unpublish") {
      const result = await request<BioOwnerView>(`${endpoint}/publication`, { method: "POST", body: { action, version: data.version } });
      if (result.ok) { setData(result.data); setNotice(t("unpublishedNotice")); } else fail(result);
      setConfirmUnpublish(false); setBusy(false); return;
    }
    const view = await save();
    if (view && action === "publish") {
      const result = await request<BioOwnerView>(`${endpoint}/publication`, { method: "POST", body: { action, version: view.version } });
      if (result.ok) { setData(result.data); setNotice(t("publishedNotice")); } else fail(result);
    } else if (view) setNotice(t("savedNotice"));
    setBusy(false);
  }
  const photoChanged = ({ coverFileId, version }: CoverChange) => { setNotice(""); setData((previous) => ({ ...previous, photoFileId: coverFileId, version })); };
  const bannerChanged = ({ coverFileId, version }: CoverChange) => { setNotice(""); setData((previous) => ({ ...previous, coverFileId, version })); };

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBlocks((blocks) => moveItem(blocks, blocks.findIndex((b) => b.id === active.id), blocks.findIndex((b) => b.id === over.id)));
  }
  const addBlock = (block: BioBlock) => setBlocks((blocks) => [...blocks, block]);
  const ids = () => definition.blocks.map((b) => b.id);
  const full = definition.blocks.length >= bioLimits.blocks;
  const hasMessage = definition.blocks.some((b) => b.type === "message"), hasGiving = definition.blocks.some((b) => b.type === "giving");
  const label = (b: BioBlock) => b.type === "link" ? (b.label || t("links.untitled")) : b.type === "event" ? (b.title || t("blocks.event")) : t(`blocks.${b.type}`);

  const done = { profile: Boolean(definition.name.trim()), content: definition.blocks.some((b) => !b.hidden) && !Object.keys(issues).length, design: true, publish: published && !data.unpublishedChanges };
  const stepList = steps.map((id) => ({ id, label: t(`steps.${id}`), done: done[id], attention: touched && ((id === "profile" && !done.profile) || (id === "content" && Object.keys(issues).length > 0) || (id === "publish" && Boolean(handleProblemNow))) }));
  const phase = published ? (data.unpublishedChanges || dirty ? "changes" : "published") : "draft";
  const status = <StatusBadge tone={published ? "success" : "pending"} label={t(`status.${phase}`)} dot />;
  const title = t("title");
  const actions = <>
    <Button asChild variant="outline" className="min-h-11"><Link href={messagesHref}><Inbox aria-hidden="true" />{data.newMessages ? t("messagesNew", { count: data.newMessages }) : t("messages")}</Link></Button>
    {published && <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setConfirmUnpublish(true)}>{t("unpublish")}</Button>}
    <Button type="button" className="min-h-11" disabled={busy || (published && !dirty && !data.unpublishedChanges)} onClick={() => void run("publish")}>{published ? t("publishChanges") : t("publish")}</Button>
  </>;
  const breadcrumb = <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><span>{t("title")}</span></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{ministryName}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>;
  const sidebar = { typeLabel: t("typeLabel"), status: { kind: published ? "live" as const : "draft" as const, label: t(`status.${phase}`) }, back: { href: `/workspaces/${tenantId}`, label: t("back") }, dirty,
    openPage: published ? { href: path, label: t("openPage") } : undefined };

  const view = useMemo(() => draftView(definition, choices, ministryName, brandTheme, Boolean(photo.url && data.photoFileId), Boolean(banner.url && data.coverFileId)), [definition, choices, ministryName, brandTheme, photo.url, data.photoFileId, banner.url, data.coverFileId]);
  const forced = definition.scheme === "auto" ? undefined : definition.scheme;
  const preview = <div className="mx-auto w-full max-w-[22rem]" data-bio-preview>
    <div className="overflow-hidden rounded-[2rem] border-[6px] border-foreground/80 shadow-sm">
      <div data-theme={forced} className={forced === "dark" ? "dark" : undefined}>
        <div className={cn("theme-preview max-h-[40rem] min-h-[28rem] overflow-y-auto bg-background text-foreground")} data-preview-brand={brandTheme ?? "harvest"} aria-label={t("previewHeading")} role="group">
          <BioPageView view={view} handle={fields.handle} preview photoUrl={photo.url && data.photoFileId ? photo.url : null} coverUrl={banner.url && data.coverFileId ? banner.url : null} />
        </div>
      </div>
    </div>
  </div>;

  const invalid = (id: string) => (touched && issues[id]) || undefined;
  const updateSocial = (index: number, patch: Partial<BioDefinition["socials"][number]>) => setDefinition({ socials: definition.socials.map((s, i) => i === index ? { ...s, ...patch } : s) });
  const takenNetworks = definition.socials.map((s) => s.network);

  return <EditorShell breadcrumb={breadcrumb} title={title} status={status} actions={actions} steps={stepList} current={step} onStep={(id) => setStep(id as Step)}
    stepsLabel={t("stepsLabel")} previewLabel={t("preview")} sidebar={sidebar} preview={preview}>
    {error && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{error}{stale && <Button type="button" variant="outline" className="min-h-11" onClick={() => location.reload()}>{t("reload")}</Button>}</AlertDescription></Alert>}
    {notice && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
    <WizardLayout steps={stepList} current={step} onStepChange={(id) => setStep(id as Step)} stepsLabel={t("stepsLabel")} stepper={false} focusOnStepChange={hosted}>
      {step === "profile" && <FormSection title={<span className="sr-only">{t("steps.profile")}</span>}>
        <EventCoverPicker namespace="LinkInBio.banner" endpoint={`${endpoint}/banner`} saved coverFileId={data.coverFileId} version={data.version} url={banner.url} onUrlFailed={banner.failed} onChange={bannerChanged} onBusyChange={setCoverBusy} />
        <EventCoverPicker namespace="LinkInBio.cover" endpoint={`${endpoint}/photo`} saved coverFileId={data.photoFileId} version={data.version} url={photo.url} onUrlFailed={photo.failed} onChange={photoChanged} onBusyChange={setCoverBusy} />
        <Field data-invalid={touched && !definition.name.trim() ? true : undefined}><FieldLabel htmlFor="bio-name">{t("profile.name")}</FieldLabel>
          <Input id="bio-name" className="min-h-11" maxLength={bioLimits.name} value={definition.name} aria-invalid={touched && !definition.name.trim() ? true : undefined} onChange={(e) => setDefinition({ name: e.target.value })} />
          {touched && !definition.name.trim() && <FieldError>{t("publishing.checkName")}</FieldError>}</Field>
        <Field><FieldLabel htmlFor="bio-subtitle">{t("profile.subtitle")}</FieldLabel>
          <Input id="bio-subtitle" className="min-h-11" maxLength={bioLimits.subtitle} value={definition.subtitle} onChange={(e) => setDefinition({ subtitle: e.target.value })} /></Field>
        <Field><FieldLabel htmlFor="bio-bio">{t("profile.bio")}</FieldLabel>
          <Textarea id="bio-bio" rows={4} maxLength={bioLimits.bio} value={definition.bio} onChange={(e) => setDefinition({ bio: e.target.value })} />
          <p className="text-xs text-muted-foreground" aria-live="polite">{t("profile.bioCount", { count: definition.bio.length, max: bioLimits.bio })}</p></Field>
      </FormSection>}
      {step === "profile" && <FormSection title={<span className="text-base font-semibold">{t("details.heading")}</span>}>
        <ul className="space-y-3" data-bio-details-editor>{definition.details.map((detail, index) => { const kindLabel = t(`details.kinds.${detail.kind}`), bad = touched ? issues[`detail:${detail.id}`] : undefined; return <li key={detail.id} className="grid items-end gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto]" data-bio-detail={detail.id}>
          <Field><FieldLabel htmlFor={`dk-${detail.id}`}>{t("details.kind")}</FieldLabel>
            <NativeSelect id={`dk-${detail.id}`} className="min-h-11 w-full" value={detail.kind} onChange={(e) => setDetails((list) => list.map((x) => x.id === detail.id ? { ...x, kind: e.target.value as BioDetailKind } : x))}>{bioDetailKinds.map((k) => <option key={k} value={k}>{t(`details.kinds.${k}`)}</option>)}</NativeSelect></Field>
          <Field data-invalid={bad ? true : undefined}><FieldLabel htmlFor={`dv-${detail.id}`}>{t("details.value")}</FieldLabel>
            <Input id={`dv-${detail.id}`} className="min-h-11" maxLength={bioLimits.detailValue} value={detail.value} aria-invalid={bad ? true : undefined} onChange={(e) => setDetails((list) => list.map((x) => x.id === detail.id ? { ...x, value: e.target.value } : x))} />
            {bad && <FieldError>{t(bad === "url" ? "details.urlProblem" : "details.requiredProblem")}</FieldError>}</Field>
          <span className="flex"><Button type="button" variant="ghost" size="icon" className="size-11" aria-pressed={detail.hidden} aria-label={t(detail.hidden ? "details.show" : "details.hide", { label: kindLabel })} onClick={() => setDetails((list) => list.map((x) => x.id === detail.id ? { ...x, hidden: !x.hidden } : x))}>{detail.hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</Button>
            <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("details.remove", { label: kindLabel })} disabled={index < 0} onClick={() => setDetails((list) => list.filter((x) => x.id !== detail.id))}><Trash2 aria-hidden="true" /></Button></span>
        </li>; })}</ul>
        <div><Button type="button" variant="outline" className="min-h-11" disabled={definition.details.length >= bioLimits.details} onClick={() => setDetails((list) => [...list, { id: newBlockId(list.map((x) => x.id)), kind: bioDetailKinds.find((k) => !list.some((x) => x.kind === k)) ?? "location", value: "", hidden: false }])}><Plus aria-hidden="true" />{t("details.add")}</Button></div>
      </FormSection>}

      {step === "content" && <div className="space-y-6">
        <FormSection title={<span className="text-base font-semibold">{t("links.heading")}</span>}>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" className="min-h-11" disabled={full} onClick={() => addBlock({ type: "link", id: newBlockId(ids()), hidden: false, tab: "home", label: "", url: "https://", icon: null })}><Plus aria-hidden="true" />{t("links.add")}</Button>
            <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="min-h-11" disabled={full}><Plus aria-hidden="true" />{t("blocks.addBlock")}</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem className="min-h-11" disabled={hasMessage} onSelect={() => addBlock({ type: "message", id: newBlockId(ids()), hidden: false, tab: "partnership", title: t("blocks.message") })}>{t("blocks.message")}{hasMessage && <span className="ms-2 text-xs text-muted-foreground">{t("blocks.already")}</span>}</DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" onSelect={() => addBlock({ type: "event", id: newBlockId(ids()), hidden: false, tab: "home", title: "", when: "", url: "https://" })}>{t("blocks.event")}</DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" disabled={!choices.communities.length} onSelect={() => addBlock({ type: "community", id: newBlockId(ids()), hidden: false, tab: "home", communityId: choices.communities[0].id })}>{t("blocks.community")}{!choices.communities.length && <span className="ms-2 text-xs text-muted-foreground">{t("blocks.noCommunities")}</span>}</DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" disabled={hasGiving} onSelect={() => addBlock({ type: "giving", id: newBlockId(ids()), hidden: false, tab: "partnership", title: t("blocks.giving") })}>{t("blocks.giving")}{hasGiving && <span className="ms-2 text-xs text-muted-foreground">{t("blocks.already")}</span>}</DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" disabled={!choices.signups.length} onSelect={() => addBlock({ type: "newsletter", id: newBlockId(ids()), hidden: false, tab: "partnership", slug: choices.signups[0].slug })}>{t("blocks.newsletter")}{!choices.signups.length && <span className="ms-2 text-xs text-muted-foreground">{t("blocks.noSignups")}</span>}</DropdownMenuItem>
              </DropdownMenuContent></DropdownMenu>
            {full && <span className="text-sm text-muted-foreground">{t("links.maxBlocks", { max: bioLimits.blocks })}</span>}
          </div>
          {definition.blocks.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground" data-bio-empty>{t("links.empty")}</p>
            : <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={onDragEnd}>
              <SortableContext items={ids()} strategy={verticalListSortingStrategy}>
                <ol className="space-y-3" aria-label={t("links.heading")}>{definition.blocks.map((block, index) => {
                  const common = { block, index, count: definition.blocks.length, label: label(block), issue: issues[block.id], clicks: published ? (data.clicks[block.id] ?? 0) : undefined,
                    onMove: (by: number) => setBlocks((list) => moveItem(list, index, index + by)), onToggle: () => patchBlock(block.id, { hidden: !block.hidden }), onTab: (tab: BioTabId) => patchBlock(block.id, { tab }), onRemove: () => setBlocks((list) => list.filter((b) => b.id !== block.id)) };
                  const bad = invalid(block.id);
                  switch (block.type) {
                    case "link": return <Row key={block.id} {...common}>
                      <Field data-invalid={bad === "required" || undefined}><FieldLabel htmlFor={`l-${block.id}`}>{t("links.label")}</FieldLabel>
                        <Input id={`l-${block.id}`} className="min-h-11" maxLength={bioLimits.label} value={block.label} aria-invalid={bad === "required" || undefined} onChange={(e) => patchBlock(block.id, { label: e.target.value })} />{bad === "required" && <FieldError>{t("links.labelProblem")}</FieldError>}</Field>
                      <Field data-invalid={bad === "url" || undefined}><FieldLabel htmlFor={`u-${block.id}`}>{t("links.url")}</FieldLabel>
                        <Input id={`u-${block.id}`} type="url" inputMode="url" className="min-h-11" maxLength={bioLimits.url} value={block.url} aria-invalid={bad === "url" || undefined} onChange={(e) => patchBlock(block.id, { url: e.target.value })} />{bad === "url" && <FieldError>{t("links.urlProblem")}</FieldError>}</Field>
                      <Field><FieldLabel htmlFor={`i-${block.id}`}>{t("links.icon")}</FieldLabel>
                        <NativeSelect id={`i-${block.id}`} className="min-h-11 w-full" value={block.icon ?? ""} onChange={(e) => patchBlock(block.id, { icon: e.target.value || null })}>
                          <option value="">{t("links.noIcon")}</option>{bioIcons.map((icon) => <option key={icon} value={icon}>{t(`icons.${icon}`)}</option>)}</NativeSelect></Field></Row>;
                    case "message": return <Row key={block.id} {...common}>
                      <Field><FieldLabel htmlFor={`m-${block.id}`}>{t("blocks.messageTitle")}</FieldLabel>
                        <Input id={`m-${block.id}`} className="min-h-11" maxLength={bioLimits.messageTitle} value={block.title} onChange={(e) => patchBlock(block.id, { title: e.target.value })} /></Field>
                      <p className="self-end text-sm text-muted-foreground">{data.messagesAvailable ? t("blocks.messageHint") : t("blocks.messageOff")}</p></Row>;
                    case "giving": return <Row key={block.id} {...common}>
                      <Field data-invalid={bad === "required" || undefined}><FieldLabel htmlFor={`g-${block.id}`}>{t("blocks.messageTitle")}</FieldLabel>
                        <Input id={`g-${block.id}`} className="min-h-11" maxLength={bioLimits.messageTitle} value={block.title} aria-invalid={bad === "required" || undefined} onChange={(e) => patchBlock(block.id, { title: e.target.value })} />{bad === "required" && <FieldError>{t("links.labelProblem")}</FieldError>}</Field>
                      <p className="flex flex-wrap items-center gap-2 self-end text-sm text-muted-foreground"><span>{t("blocks.givingCount", { count: choices.giving?.length ?? 0 })}</span>
                        <Link href={`/workspaces/${tenantId}/giving/ways-to-give`} className="inline-flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline">{t("blocks.givingManage")}</Link></p></Row>;
                    case "event": return <Row key={block.id} {...common}>
                      <Field data-invalid={bad === "required" || undefined}><FieldLabel htmlFor={`et-${block.id}`}>{t("blocks.eventTitle")}</FieldLabel>
                        <Input id={`et-${block.id}`} className="min-h-11" maxLength={bioLimits.eventTitle} value={block.title} aria-invalid={bad === "required" || undefined} onChange={(e) => patchBlock(block.id, { title: e.target.value })} /></Field>
                      <Field data-invalid={bad === "required" || undefined}><FieldLabel htmlFor={`ew-${block.id}`}>{t("blocks.eventWhen")}</FieldLabel>
                        <Input id={`ew-${block.id}`} className="min-h-11" maxLength={bioLimits.eventWhen} value={block.when} aria-invalid={bad === "required" || undefined} onChange={(e) => patchBlock(block.id, { when: e.target.value })} />{bad === "required" && <FieldError>{t("links.labelProblem")}</FieldError>}</Field>
                      <Field data-invalid={bad === "url" || undefined} className="sm:col-span-2"><FieldLabel htmlFor={`eu-${block.id}`}>{t("blocks.eventUrl")}</FieldLabel>
                        <Input id={`eu-${block.id}`} type="url" inputMode="url" className="min-h-11" maxLength={bioLimits.url} value={block.url} aria-invalid={bad === "url" || undefined} onChange={(e) => patchBlock(block.id, { url: e.target.value })} />{bad === "url" && <FieldError>{t("links.urlProblem")}</FieldError>}</Field></Row>;
                    case "community": { const c = choices.communities.find((x) => x.id === block.communityId); return <Row key={block.id} {...common}>
                      <Field><FieldLabel htmlFor={`c-${block.id}`}>{t("blocks.communityPick")}</FieldLabel>
                        <NativeSelect id={`c-${block.id}`} className="min-h-11 w-full" value={block.communityId} onChange={(e) => patchBlock(block.id, { communityId: e.target.value })}>
                          {choices.communities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect></Field>
                      {c && c.status !== "published" && <p className="self-end text-sm text-muted-foreground">{t("blocks.communityDraft")}</p>}</Row>; }
                    case "newsletter": return <Row key={block.id} {...common}>
                      <Field><FieldLabel htmlFor={`n-${block.id}`}>{t("blocks.newsletterPick")}</FieldLabel>
                        <NativeSelect id={`n-${block.id}`} className="min-h-11 w-full" value={block.slug} onChange={(e) => patchBlock(block.id, { slug: e.target.value })}>
                          {!choices.signups.some((s) => s.slug === block.slug) && <option value={block.slug}>{block.slug}</option>}
                          {choices.signups.map((s) => <option key={s.slug} value={s.slug}>{s.title}</option>)}</NativeSelect></Field></Row>;
                  }
                })}</ol>
              </SortableContext></DndContext>}
        </FormSection>
        <FormSection title={<span className="text-base font-semibold">{t("links.socials")}</span>}>
          <ul className="space-y-3">{definition.socials.map((social, index) => <li key={social.network} className="grid items-end gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto]" data-bio-social={social.network}>
            <Field><FieldLabel htmlFor={`sn-${index}`}>{t("links.network")}</FieldLabel>
              <NativeSelect id={`sn-${index}`} className="min-h-11 w-full" value={social.network} onChange={(e) => updateSocial(index, { network: e.target.value as typeof social.network })}>
                {bioNetworks.filter((n) => n === social.network || !takenNetworks.includes(n)).map((n) => <option key={n} value={n}>{t(`networks.${n}`)}</option>)}</NativeSelect></Field>
            <Field data-invalid={invalid(`social:${social.network}`) ? true : undefined}><FieldLabel htmlFor={`su-${index}`}>{t("links.socialUrl")}</FieldLabel>
              <Input id={`su-${index}`} type="url" inputMode="url" className="min-h-11" maxLength={bioLimits.url} value={social.url} aria-invalid={invalid(`social:${social.network}`) ? true : undefined} onChange={(e) => updateSocial(index, { url: e.target.value })} />
              {invalid(`social:${social.network}`) && <FieldError>{t("links.urlProblem")}</FieldError>}</Field>
            <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("links.removeSocial", { network: t(`networks.${social.network}`) })} onClick={() => setDefinition({ socials: definition.socials.filter((_, i) => i !== index) })}><Trash2 aria-hidden="true" /></Button>
          </li>)}</ul>
          <div><Button type="button" variant="outline" className="min-h-11" disabled={definition.socials.length >= bioLimits.socials} onClick={() => { const next = bioNetworks.find((n) => !takenNetworks.includes(n)); if (next) setDefinition({ socials: [...definition.socials, { network: next, url: "https://" }] }); }}><Plus aria-hidden="true" />{t("links.addSocial")}</Button></div>
        </FormSection>
      </div>}

      {step === "design" && <FormSection title={<span className="sr-only">{t("steps.design")}</span>}>
        <Field><FieldLabel htmlFor="bio-scheme">{t("design.scheme")}</FieldLabel>
          <NativeSelect id="bio-scheme" className="min-h-11 w-full" value={definition.scheme} onChange={(e) => setDefinition({ scheme: e.target.value as BioDefinition["scheme"] })}>
            {bioSchemes.map((s) => <option key={s} value={s}>{t(`design.schemes.${s}`)}</option>)}</NativeSelect></Field>
        <Field><FieldLabel htmlFor="bio-buttons">{t("design.buttons")}</FieldLabel>
          <NativeSelect id="bio-buttons" className="min-h-11 w-full" value={definition.buttons} onChange={(e) => setDefinition({ buttons: e.target.value as BioDefinition["buttons"] })}>
            {bioButtonStyles.map((s) => <option key={s} value={s}>{t(`design.buttonStyles.${s}`)}</option>)}</NativeSelect></Field>
        <fieldset className="space-y-2"><legend className="text-sm font-medium">{t("design.tabsHeading")}</legend>
          <ul className="space-y-2" data-bio-tabs-editor>{definition.tabs.map((tabItem, index) => <li key={tabItem.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3">
            <label className="flex min-h-11 flex-1 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={!tabItem.hidden} onChange={() => setDefinition({ tabs: definition.tabs.map((x) => x.id === tabItem.id ? { ...x, hidden: !x.hidden } : x) })} /><span>{t("design.tabShow", { tab: t(`tabs.${tabItem.id}`) })}</span></label>
            <Button type="button" variant="ghost" size="icon" className="size-11" disabled={index === 0} aria-label={t("design.tabMoveUp", { tab: t(`tabs.${tabItem.id}`) })} onClick={() => setDefinition({ tabs: moveItem(definition.tabs, index, index - 1) })}><ArrowUp aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon" className="size-11" disabled={index === definition.tabs.length - 1} aria-label={t("design.tabMoveDown", { tab: t(`tabs.${tabItem.id}`) })} onClick={() => setDefinition({ tabs: moveItem(definition.tabs, index, index + 1) })}><ArrowDown aria-hidden="true" /></Button>
          </li>)}</ul></fieldset>
        <p className="text-sm text-muted-foreground">{t("design.brandNote")}</p>
      </FormSection>}

      {step === "publish" && <FormSection title={<span className="sr-only">{t("steps.publish")}</span>}>
        <Field data-invalid={handleProblemNow ? true : undefined}><FieldLabel htmlFor="bio-handle">{t("publishing.handle")}</FieldLabel>
          <div className="flex min-h-11 items-stretch rounded-md border border-input has-[input:focus-visible]:ring-[3px] has-[input:focus-visible]:ring-ring/50">
            <span className="flex items-center whitespace-nowrap rounded-l-md bg-muted px-3 text-sm text-muted-foreground" data-testid="bio-prefix">{base}{t("publishing.prefix")}</span>
            <input id="bio-handle" className="min-h-11 min-w-0 flex-1 rounded-r-md bg-transparent px-3 text-base outline-none disabled:opacity-60" value={fields.handle} maxLength={30} disabled={published}
              aria-invalid={handleProblemNow ? true : undefined} aria-describedby="bio-handle-status" autoCapitalize="none" spellCheck={false}
              onChange={(e) => { setNotice(""); setFields((previous) => ({ ...previous, handle: e.target.value.toLowerCase() })); }} />
          </div>
          <p id="bio-handle-status" className="text-sm" role="status">{published ? <span className="text-muted-foreground">{t("publishing.handleLocked")}</span>
            : handleProblemNow ? <span className="text-destructive">{t(`publishing.problems.${handleProblemNow}`)}</span>
            : fields.handle !== saved.handle ? <span className="text-muted-foreground">{handleState.checking || handleState.value !== fields.handle ? t("publishing.handleChecking") : t("publishing.handleAvailable")}</span> : null}</p></Field>
        {published && <div className="flex flex-wrap items-center gap-2"><Button asChild variant="outline" className="min-h-11"><a href={path} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />{t("openPage")}</a></Button>
          <CopyButton value={`${origin}/l/${data.handle}`} label={t("copyLink")} /></div>}
        <div className="space-y-2"><p className="text-sm font-medium">{t("publishing.checklist")}</p>
          <ul className="space-y-1 text-sm text-muted-foreground" data-bio-checklist>
            <li className="flex items-center gap-2">{checklist.includes("name") ? <Circle className="size-4" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}<span>{t("publishing.checkName")}</span></li>
            <li className="flex items-center gap-2">{checklist.includes("empty") ? <Circle className="size-4" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}<span>{t("publishing.checkBlock")}</span></li>
            <li className="flex items-center gap-2">{Object.keys(issues).length ? <Circle className="size-4" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}<span>{t("publishing.checkFields")}</span></li>
            <li className="flex items-center gap-2">{dirty ? <Circle className="size-4" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}<span>{t("publishing.checkSaved")}</span></li></ul></div>
      </FormSection>}
    </WizardLayout>
    <StickySaveBar guard={false} dirty={dirty} busy={busy && dirty} onSave={() => void run("save")} onDiscard={() => { setFields(saved); setError(""); setNotice(""); setTouched(false); }} saveLabel={t("saveDraft")} savingLabel={t("saving")} />
    <ConfirmDialog tone="destructive" open={confirmUnpublish} onOpenChange={setConfirmUnpublish} title={t("unpublishTitle")} description={t("unpublishBody")} cancelLabel={t("keepPublished")} confirmLabel={t("unpublish")} onConfirm={() => run("unpublish")} />
    <ConfirmDialog tone="neutral" open={destination !== null} onOpenChange={(open) => { if (!open) setDestination(null); }} title={t("leaveTitle")} description={t("leaveBody")} cancelLabel={t("stay")} confirmLabel={t("leave")} onConfirm={leave} />
  </EditorShell>;
}
