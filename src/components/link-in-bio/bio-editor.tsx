"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { Check, Circle, ExternalLink, Inbox, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { useCrmRequest } from "@/components/crm/request";
import { EditorShell } from "@/components/editor/editor-shell";
import { useEditorHosted } from "@/components/editor/editor-context";
import type { CoverChange } from "@/components/events/event-cover-picker";
import { useEventCoverUrl } from "@/components/events/use-event-cover-url";
import { BioPageView } from "@/components/link-in-bio/bio-view";
import { FormSection } from "@/components/form-section";
import { StatusBadge } from "@/components/status-badge";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { WizardLayout } from "@/components/wizard-layout";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { BioTabsEditor } from "@/components/link-in-bio/bio-tabs-editor";
import { BioBlockRow } from "@/components/link-in-bio/blocks/bio-block-row";
import { BioBlockFields } from "@/components/link-in-bio/blocks/bio-block-fields";
import { BioProfileStep } from "@/components/link-in-bio/bio-profile-step";
import { bioIcons, bioLimits, bioSchemes, fieldIssues, handleProblem, isLegacyTabId, oneLine, newBlockId, moveItem, publishIssues, shownTabs,
  type BioBlock, type BioDefinition, type BioTabId, type BioView, type BioViewBlock, type HandleProblem } from "@/lib/link-in-bio";
import { cn } from "@/lib/utils";
import { validVideo } from "@/lib/lesson-video";
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
      case "catalog": case "files": {
        const items = block.itemIds.flatMap((id) => { const c = choices.catalog?.find((x) => x.id === id); return c && (block.type === "catalog" || c.kind === "download") ? [{ id, kind: c.kind, slug: c.slug, title: c.title, summary: c.summary }] : []; });
        return items.length ? [{ type: block.type, id: block.id, title: block.title, items }] : [];
      }
      case "form": return [{ type: "form", id: block.id, title: block.title || "…", slug: block.slug }];
      case "video": return validVideo({ provider: block.provider, id: block.videoId }) ? [{ type: "video", id: block.id, title: block.title, video: { provider: block.provider, id: block.videoId } }] : [];
      case "contact": return block.email || block.phone || block.whatsapp ? [{ type: "contact", id: block.id, email: block.email, phone: block.phone, whatsapp: block.whatsapp }] : [];
      case "location": return [{ type: "location", id: block.id, label: block.label, address: block.address || "…" }];
      case "live": return block.on ? [{ type: "live", id: block.id, title: block.title || "…", url: block.url }] : [];
      case "testimonials": return [{ type: "testimonials", id: block.id, items: block.items.map((x) => ({ ...x, quote: x.quote || "…", name: x.name || "…" })) }];
    }
  };
  const tabs = shownTabs(definition, definition.blocks).map((t) => ({ ...t, blocks: t.blocks.flatMap(project) })).filter((t) => t.blocks.length > 0);
  return { ministryName, name: definition.name || "…", bio: oneLine(definition.bio), tabs, layout: definition.layout, showCover: definition.cover, photoAlign: definition.photoAlign,
    iconStyle: definition.iconStyle, hasPhoto, hasCover: definition.cover && hasCover, scheme: definition.scheme, buttons: definition.buttons,
    brandTheme: brandTheme as BioView["brandTheme"], socials: definition.socials.filter((s) => /^https:\/\//.test(s.url)) };
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
  const { definition } = fields, issues = fieldIssues(definition), checklist = publishIssues(definition, { hasPhoto: data.photoFileId !== null });
  const tabName = (x: BioDefinition["tabs"][number]) => x.label.trim() || (isLegacyTabId(x.id) ? t(`tabs.${x.id}`) : "");
  const tabOptions = definition.layout === "tabs" ? definition.tabs.map((x, i) => ({ id: x.id, name: tabName(x) || t("tabsEditor.untitled", { position: i + 1 }) })) : null;
  // New blocks land on the first tab; Message me, giving and sign-up blocks on Partnership while it exists (as before the rework), else the second tab.
  const firstTab = definition.tabs[0]?.id ?? "home", secondTab = definition.tabs.find((x) => x.id === "partnership")?.id ?? definition.tabs[1]?.id ?? firstTab;
  const setDefinition = (patch: Partial<BioDefinition>) => { setNotice(""); setFields((previous) => ({ ...previous, definition: { ...previous.definition, ...patch } })); };
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
  const label = (b: BioBlock) => b.type === "link" ? (b.label || t("links.untitled")) : b.type === "event" ? (b.title || t("blocks.event"))
    : (b.type === "live" || b.type === "form") && b.title ? b.title : t(`blocks.${b.type}`);
  const catalog = choices.catalog ?? [], downloads = catalog.filter((x) => x.kind === "download"), forms = choices.forms ?? [];
  // Rework PR 2 blocks: each starts on the first tab with empty fields the owner fills in (the publish check marks what is missing).
  const newBlocks: { type: BioBlock["type"]; disabled?: string; make: (id: string) => BioBlock }[] = [
    { type: "catalog", disabled: catalog.length ? undefined : "noCatalog", make: (id) => ({ type: "catalog", id, hidden: false, tab: firstTab, title: "", itemIds: [catalog[0].id] }) },
    { type: "files", disabled: downloads.length ? undefined : "noDownloads", make: (id) => ({ type: "files", id, hidden: false, tab: firstTab, title: "", itemIds: [downloads[0].id] }) },
    { type: "form", disabled: forms.length ? undefined : "noForms", make: (id) => ({ type: "form", id, hidden: false, tab: firstTab, title: forms[0].title.slice(0, bioLimits.messageTitle), slug: forms[0].slug }) },
    { type: "video", make: (id) => ({ type: "video", id, hidden: false, tab: firstTab, title: "", provider: "youtube", videoId: "" }) },
    { type: "contact", make: (id) => ({ type: "contact", id, hidden: false, tab: firstTab, email: "", phone: "", whatsapp: "" }) },
    { type: "location", make: (id) => ({ type: "location", id, hidden: false, tab: firstTab, label: "", address: "" }) },
    { type: "live", make: (id) => ({ type: "live", id, hidden: false, tab: firstTab, title: t("blocks.live"), url: "https://", on: false }) },
    { type: "testimonials", make: (id) => ({ type: "testimonials", id, hidden: false, tab: firstTab, items: [{ id: newBlockId([]), quote: "", name: "", role: "" }] }) },
  ];

  const contentIssue = Object.keys(issues).some((key) => !key.startsWith("social:"));
  const done = { profile: Boolean(definition.name.trim()) && data.photoFileId !== null, content: definition.blocks.some((b) => !b.hidden) && !contentIssue, design: true, publish: published && !data.unpublishedChanges };
  const profileIssue = !done.profile || Object.keys(issues).some((key) => key.startsWith("social:"));
  const stepList = steps.map((id) => ({ id, label: t(`steps.${id}`), done: done[id], attention: touched && ((id === "profile" && profileIssue) || (id === "content" && contentIssue) || (id === "publish" && Boolean(handleProblemNow))) }));
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

  return <EditorShell breadcrumb={breadcrumb} title={title} status={status} actions={actions} steps={stepList} current={step} onStep={(id) => setStep(id as Step)}
    stepsLabel={t("stepsLabel")} previewLabel={t("preview")} sidebar={sidebar} preview={preview}>
    {error && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{error}{stale && <Button type="button" variant="outline" className="min-h-11" onClick={() => location.reload()}>{t("reload")}</Button>}</AlertDescription></Alert>}
    {notice && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
    <WizardLayout steps={stepList} current={step} onStepChange={(id) => setStep(id as Step)} stepsLabel={t("stepsLabel")} stepper={false} focusOnStepChange={hosted}>
      {step === "profile" && <BioProfileStep definition={definition} setDefinition={setDefinition} endpoint={endpoint} version={data.version} onBusyChange={setCoverBusy} touched={touched} issues={issues}
        cover={{ fileId: data.coverFileId, url: banner.url, failed: banner.failed, onChange: bannerChanged }} photo={{ fileId: data.photoFileId, url: photo.url, failed: photo.failed, onChange: photoChanged }} />}

      {step === "content" && <div className="space-y-6">
        <FormSection title={<span className="text-base font-semibold">{t("tabsEditor.heading")}</span>}>
          <BioTabsEditor definition={definition} issues={touched ? issues : {}} onChange={setDefinition} tabName={tabName} />
        </FormSection>
        <FormSection title={<span className="text-base font-semibold">{t("links.heading")}</span>}>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" className="min-h-11" disabled={full} onClick={() => addBlock({ type: "link", id: newBlockId(ids()), hidden: false, tab: firstTab, label: "", url: "https://", icon: null })}><Plus aria-hidden="true" />{t("links.add")}</Button>
            <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="min-h-11" disabled={full}><Plus aria-hidden="true" />{t("blocks.addBlock")}</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem className="min-h-11" disabled={hasMessage} onSelect={() => addBlock({ type: "message", id: newBlockId(ids()), hidden: false, tab: secondTab, title: t("blocks.message") })}>{t("blocks.message")}{hasMessage && <span className="ms-2 text-xs text-muted-foreground">{t("blocks.already")}</span>}</DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" onSelect={() => addBlock({ type: "event", id: newBlockId(ids()), hidden: false, tab: firstTab, title: "", when: "", url: "https://" })}>{t("blocks.event")}</DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" disabled={!choices.communities.length} onSelect={() => addBlock({ type: "community", id: newBlockId(ids()), hidden: false, tab: firstTab, communityId: choices.communities[0].id })}>{t("blocks.community")}{!choices.communities.length && <span className="ms-2 text-xs text-muted-foreground">{t("blocks.noCommunities")}</span>}</DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" disabled={hasGiving} onSelect={() => addBlock({ type: "giving", id: newBlockId(ids()), hidden: false, tab: secondTab, title: t("blocks.giving") })}>{t("blocks.giving")}{hasGiving && <span className="ms-2 text-xs text-muted-foreground">{t("blocks.already")}</span>}</DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" disabled={!choices.signups.length} onSelect={() => addBlock({ type: "newsletter", id: newBlockId(ids()), hidden: false, tab: secondTab, slug: choices.signups[0].slug })}>{t("blocks.newsletter")}{!choices.signups.length && <span className="ms-2 text-xs text-muted-foreground">{t("blocks.noSignups")}</span>}</DropdownMenuItem>
                {newBlocks.map((item) => <DropdownMenuItem key={item.type} className="min-h-11" disabled={Boolean(item.disabled)} onSelect={() => addBlock(item.make(newBlockId(ids())))}>
                  {t(`blocks.${item.type}`)}{item.disabled && <span className="ms-2 text-xs text-muted-foreground">{t(`blocks.${item.disabled}`)}</span>}</DropdownMenuItem>)}
              </DropdownMenuContent></DropdownMenu>
            {full && <span className="text-sm text-muted-foreground">{t("links.maxBlocks", { max: bioLimits.blocks })}</span>}
          </div>
          {definition.blocks.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground" data-bio-empty>{t("links.empty")}</p>
            : <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={onDragEnd}>
              <SortableContext items={ids()} strategy={verticalListSortingStrategy}>
                <ol className="space-y-3" aria-label={t("links.heading")}>{definition.blocks.map((block, index) => {
                  const common = { block, index, count: definition.blocks.length, label: label(block), issue: issues[block.id], clicks: published ? (data.clicks[block.id] ?? 0) : undefined,
                    onMove: (by: number) => setBlocks((list) => moveItem(list, index, index + by)), onToggle: () => patchBlock(block.id, { hidden: !block.hidden }), onTab: (tab: BioTabId) => patchBlock(block.id, { tab }), tabs: tabOptions, onRemove: () => setBlocks((list) => list.filter((b) => b.id !== block.id)) };
                  const bad = invalid(block.id);
                  switch (block.type) {
                    case "link": return <BioBlockRow key={block.id} {...common}>
                      <Field data-invalid={bad === "required" || undefined}><FieldLabel htmlFor={`l-${block.id}`}>{t("links.label")}</FieldLabel>
                        <Input id={`l-${block.id}`} className="min-h-11" maxLength={bioLimits.label} value={block.label} aria-invalid={bad === "required" || undefined} onChange={(e) => patchBlock(block.id, { label: e.target.value })} />{bad === "required" && <FieldError>{t("links.labelProblem")}</FieldError>}</Field>
                      <Field data-invalid={bad === "url" || undefined}><FieldLabel htmlFor={`u-${block.id}`}>{t("links.url")}</FieldLabel>
                        <Input id={`u-${block.id}`} type="url" inputMode="url" className="min-h-11" maxLength={bioLimits.url} value={block.url} aria-invalid={bad === "url" || undefined} onChange={(e) => patchBlock(block.id, { url: e.target.value })} />{bad === "url" && <FieldError>{t("links.urlProblem")}</FieldError>}</Field>
                      <Field><FieldLabel htmlFor={`i-${block.id}`}>{t("links.icon")}</FieldLabel>
                        <NativeSelect id={`i-${block.id}`} className="min-h-11 w-full" value={block.icon ?? ""} onChange={(e) => patchBlock(block.id, { icon: e.target.value || null })}>
                          <option value="">{t("links.noIcon")}</option>{bioIcons.map((icon) => <option key={icon} value={icon}>{t(`icons.${icon}`)}</option>)}</NativeSelect></Field></BioBlockRow>;
                    case "message": return <BioBlockRow key={block.id} {...common}>
                      <Field><FieldLabel htmlFor={`m-${block.id}`}>{t("blocks.messageTitle")}</FieldLabel>
                        <Input id={`m-${block.id}`} className="min-h-11" maxLength={bioLimits.messageTitle} value={block.title} onChange={(e) => patchBlock(block.id, { title: e.target.value })} /></Field>
                      <p className="self-end text-sm text-muted-foreground">{data.messagesAvailable ? t("blocks.messageHint") : t("blocks.messageOff")}</p></BioBlockRow>;
                    case "giving": return <BioBlockRow key={block.id} {...common}>
                      <Field data-invalid={bad === "required" || undefined}><FieldLabel htmlFor={`g-${block.id}`}>{t("blocks.messageTitle")}</FieldLabel>
                        <Input id={`g-${block.id}`} className="min-h-11" maxLength={bioLimits.messageTitle} value={block.title} aria-invalid={bad === "required" || undefined} onChange={(e) => patchBlock(block.id, { title: e.target.value })} />{bad === "required" && <FieldError>{t("links.labelProblem")}</FieldError>}</Field>
                      <p className="flex flex-wrap items-center gap-2 self-end text-sm text-muted-foreground"><span>{t("blocks.givingCount", { count: choices.giving?.length ?? 0 })}</span>
                        <Link href={`/workspaces/${tenantId}/giving/ways-to-give`} className="inline-flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline">{t("blocks.givingManage")}</Link></p></BioBlockRow>;
                    case "event": return <BioBlockRow key={block.id} {...common}>
                      <Field data-invalid={bad === "required" || undefined}><FieldLabel htmlFor={`et-${block.id}`}>{t("blocks.eventTitle")}</FieldLabel>
                        <Input id={`et-${block.id}`} className="min-h-11" maxLength={bioLimits.eventTitle} value={block.title} aria-invalid={bad === "required" || undefined} onChange={(e) => patchBlock(block.id, { title: e.target.value })} /></Field>
                      <Field data-invalid={bad === "required" || undefined}><FieldLabel htmlFor={`ew-${block.id}`}>{t("blocks.eventWhen")}</FieldLabel>
                        <Input id={`ew-${block.id}`} className="min-h-11" maxLength={bioLimits.eventWhen} value={block.when} aria-invalid={bad === "required" || undefined} onChange={(e) => patchBlock(block.id, { when: e.target.value })} />{bad === "required" && <FieldError>{t("links.labelProblem")}</FieldError>}</Field>
                      <Field data-invalid={bad === "url" || undefined} className="sm:col-span-2"><FieldLabel htmlFor={`eu-${block.id}`}>{t("blocks.eventUrl")}</FieldLabel>
                        <Input id={`eu-${block.id}`} type="url" inputMode="url" className="min-h-11" maxLength={bioLimits.url} value={block.url} aria-invalid={bad === "url" || undefined} onChange={(e) => patchBlock(block.id, { url: e.target.value })} />{bad === "url" && <FieldError>{t("links.urlProblem")}</FieldError>}</Field></BioBlockRow>;
                    case "community": { const c = choices.communities.find((x) => x.id === block.communityId); return <BioBlockRow key={block.id} {...common}>
                      <Field><FieldLabel htmlFor={`c-${block.id}`}>{t("blocks.communityPick")}</FieldLabel>
                        <NativeSelect id={`c-${block.id}`} className="min-h-11 w-full" value={block.communityId} onChange={(e) => patchBlock(block.id, { communityId: e.target.value })}>
                          {choices.communities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect></Field>
                      {c && c.status !== "published" && <p className="self-end text-sm text-muted-foreground">{t("blocks.communityDraft")}</p>}</BioBlockRow>; }
                    case "newsletter": return <BioBlockRow key={block.id} {...common}>
                      <Field><FieldLabel htmlFor={`n-${block.id}`}>{t("blocks.newsletterPick")}</FieldLabel>
                        <NativeSelect id={`n-${block.id}`} className="min-h-11 w-full" value={block.slug} onChange={(e) => patchBlock(block.id, { slug: e.target.value })}>
                          {!choices.signups.some((s) => s.slug === block.slug) && <option value={block.slug}>{block.slug}</option>}
                          {choices.signups.map((s) => <option key={s.slug} value={s.slug}>{s.title}</option>)}</NativeSelect></Field></BioBlockRow>;
                    default: return <BioBlockRow key={block.id} {...common}><BioBlockFields block={block} choices={choices} issue={bad} patch={(change) => patchBlock(block.id, change)} /></BioBlockRow>;
                  }
                })}</ol>
              </SortableContext></DndContext>}
        </FormSection>
      </div>}

      {step === "design" && <FormSection title={<span className="sr-only">{t("steps.design")}</span>}>
        <Field><FieldLabel htmlFor="bio-scheme">{t("design.scheme")}</FieldLabel>
          <NativeSelect id="bio-scheme" className="min-h-11 w-full" value={definition.scheme} onChange={(e) => setDefinition({ scheme: e.target.value as BioDefinition["scheme"] })}>
            {bioSchemes.map((s) => <option key={s} value={s}>{t(`design.schemes.${s}`)}</option>)}</NativeSelect></Field>
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
            <li className="flex items-center gap-2">{checklist.includes("photo") ? <Circle className="size-4" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}<span>{t("publishing.checkPhoto")}</span></li>
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
