/** Settings panel layout reference: Shadcn UI Kit item form-layout15 (premium, founder-approved 27 Nov 2026), used as a layout reference only; built on the shared EditorShell, WizardLayout, FormSection, StickySaveBar and the Docs editor surface. Notes: docs/ui-sources.md. */
"use client";
/* eslint-disable @next/next/no-img-element -- pictures are short signed redirects from the server, not optimisable */
import "@/components/docs/docs-prose.css";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarClock, ExternalLink, ImageIcon, ImagePlus, Send, Undo2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DocEditorSurface, type SurfaceHandle } from "@/components/docs/doc-editor-surface";
import { FilePicker } from "@/components/docs/file-picker";
import { InsertDialog, type InsertMode } from "@/components/docs/insert-dialog";
import { EditorShell } from "@/components/editor/editor-shell";
import { useEditorHosted } from "@/components/editor/editor-context";
import { FormSection } from "@/components/form-section";
import { StatusBadge } from "@/components/status-badge";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { WizardLayout } from "@/components/wizard-layout";
import { BlogArticleCard } from "@/components/blog/blog-card";
import { blogImageNode } from "@/components/blog/blog-image-node";
import { SearchPreview } from "@/components/blog/search-preview";
import { useFileUrl } from "@/components/blog/use-file-url";
import { useRequest } from "@/hooks/use-request";
import { blogImageIds, blogLimits, blogPath, blogSlugProblem, derivedExcerpt, publishProblems, readingMinutes, type BlogStatus } from "@/lib/blog";
import { contentStats, type DocContent } from "@/lib/docs";
import { formatScheduled, scheduleInputValue, zonedSchedule } from "@/lib/newsletter-schedule";
import { utcOffsetLabel } from "@/lib/time-zone-label";
import type { StatusTone } from "@/lib/status-tone";
import { notify } from "@/lib/toast";
import type { BlogOwnerPost, BlogOwnerSettings } from "@/server/blog";

type Step = "write" | "settings" | "publish";
const steps: Step[] = ["write", "settings", "publish"];
type Fields = { title: string; slug: string; excerpt: string; seoTitle: string; seoDescription: string; coverFileId: string | null; shareFileId: string | null };
const fieldsOf = (post: BlogOwnerPost): Fields => ({ title: post.title, slug: post.slug, excerpt: post.excerpt ?? "", seoTitle: post.seoTitle ?? "", seoDescription: post.seoDescription ?? "", coverFileId: post.coverFileId, shareFileId: post.shareFileId });
const same = (a: Fields, b: Fields) => JSON.stringify(a) === JSON.stringify(b);
const tone: Record<BlogStatus, StatusTone> = { draft: "pending", scheduled: "info", published: "success" };
/** Slash items that make no sense in an article (pages, templates, @mentions, page outlines). */
const slashExclude = ["suggestSubpage", "suggestPage", "template", "mention", "toc", "stickyToc"];
/** Tomorrow at 9:00 in the ministry's zone, as a datetime-local value. */
const defaultSlot = (zone: string) => `${scheduleInputValue(new Date(Date.now() + 86_400_000), zone).slice(0, 10)}T09:00`;

/** One article: Write (title and the Docs editor with pictures), Settings and SEO (address, excerpt, pictures, search preview) and Publish (now or at a time). */
export function BlogEditor({ tenantId, initial, origin }: { tenantId: string; initial: { post: BlogOwnerPost; settings: BlogOwnerSettings }; origin: string }) {
  const t = useTranslations("Blog"), format = useFormatter(), request = useRequest(), hosted = useEditorHosted();
  const settings = initial.settings, api = `/api/workspaces/${tenantId}/blog/posts/${initial.post.id}`, list = `/workspaces/${tenantId}/blog`;
  const [post, setPost] = useState(initial.post), [saved, setSaved] = useState(fieldsOf(initial.post)), [fields, setFields] = useState(fieldsOf(initial.post));
  const [body, setBody] = useState<DocContent>(initial.post.body), [bodyDirty, setBodyDirty] = useState(false), [surfaceKey, setSurfaceKey] = useState(0);
  const [step, setStep] = useState<Step>("write"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [stale, setStale] = useState(false);
  const [slugIssue, setSlugIssue] = useState<"taken" | null>(null), [dialog, setDialog] = useState<"picture" | "cover" | "share" | "unpublish" | null>(null), [insertMode, setInsertMode] = useState<InsertMode | null>(null);
  const [slot, setSlot] = useState(() => post.publishAt ? scheduleInputValue(post.publishAt, settings.timeZone) : defaultSlot(settings.timeZone));
  const surface = useRef<SurfaceHandle | null>(null), readBody = useRef<(() => DocContent) | null>(null);
  const extensions = useMemo(() => [blogImageNode(tenantId)], [tenantId]);
  const dirty = bodyDirty || !same(fields, saved);
  const set = (patch: Partial<Fields>) => setFields((current) => ({ ...current, ...patch }));
  const autoSlug = !post.slugLocked && /^draft-[a-f0-9]{8}$/.test(fields.slug);
  const slugProblem = slugIssue ?? (autoSlug ? null : blogSlugProblem(fields.slug));
  const currentBody = () => readBody.current?.() ?? body;
  const [words, setWords] = useState(() => contentStats(initial.post.body).words + blogImageIds(initial.post.body).length);
  const missing = publishProblems({ title: fields.title, slug: autoSlug ? "ok" : fields.slug, body: words > 0 ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] } : null });

  function fail(result: { error: string; details?: Record<string, string | number> }) {
    if (result.details?.reason === "slug_taken") { setSlugIssue("taken"); setStep("settings"); }
    else if (result.details?.reason === "stale") setStale(true);
    setError(result.error);
  }
  /** Saves pending changes; returns the saved article, or null after showing why not. */
  async function save(): Promise<BlogOwnerPost | null> {
    if (!dirty) return post;
    setError(""); setStale(false); setSlugIssue(null);
    let slug = fields.slug;
    if (autoSlug && fields.title.trim()) {
      const suggestion = await request<{ slug: string }>(`${api}/slug?title=${encodeURIComponent(fields.title)}`, { method: "GET" });
      if (suggestion.ok) slug = suggestion.data.slug;
    }
    const content = bodyDirty ? currentBody() : undefined;
    const result = await request<BlogOwnerPost>(api, { method: "PUT", body: { version: post.version, title: fields.title, slug, excerpt: fields.excerpt || null, seoTitle: fields.seoTitle || null,
      seoDescription: fields.seoDescription || null, coverFileId: fields.coverFileId, shareFileId: fields.shareFileId, ...(content ? { body: content } : {}) } });
    if (!result.ok) { fail(result); return null; }
    const next = fieldsOf(result.data);
    setPost(result.data); setSaved(next); setFields(next); setBodyDirty(false); setBody(result.data.body);
    return result.data;
  }
  async function act(action: "save" | "publish" | "schedule" | "unschedule" | "unpublish") {
    setBusy(true);
    const current = await save();
    if (!current) { setBusy(false); return; }
    if (action === "save") { notify.success(t("saved")); setBusy(false); return; }
    let extra: Record<string, string> = {};
    if (action === "schedule") {
      const at = zonedSchedule(slot, settings.timeZone);
      if (!at) { setError(t("scheduleAt")); setBusy(false); return; }
      extra = { at: at.at };
    }
    const result = await request<BlogOwnerPost>(`${api}/state`, { method: "POST", body: { action, version: current.version, ...extra } });
    setBusy(false);
    if (!result.ok) { fail(result); return; }
    setPost(result.data); setSaved(fieldsOf(result.data));
    if (action === "publish") notify.success(t("published"));
    else if (action === "schedule") notify.success(t("scheduled", { date: formatScheduled(result.data.publishAt!, settings.timeZone) }));
    else if (action === "unschedule") notify.success(t("unscheduled"));
    else notify.success(t("unpublished"));
  }
  function discard() { setFields(saved); setBody(post.body); setBodyDirty(false); setSurfaceKey((k) => k + 1); setError(""); setSlugIssue(null); }

  const status = <StatusBadge tone={tone[post.status]} label={t(`status.${post.status}`)} dot />;
  const title = fields.title.trim() || t("untitled");
  const publicHref = blogPath(settings.handle, post.slug);
  const canPublish = missing.length === 0 && !slugProblem;
  const actions = <>
    {post.status === "published" && <Button asChild variant="outline" size="sm" className="min-h-11 max-sm:min-w-11 max-sm:px-0 lg:min-h-8"><Link href={publicHref} target="_blank" rel="noopener"><ExternalLink aria-hidden="true" /><span className="max-sm:sr-only">{t("openArticle")}</span></Link></Button>}
    {post.status !== "published" && <Button type="button" size="sm" className="min-h-11 max-sm:min-w-11 max-sm:px-0 lg:min-h-8" disabled={busy || !canPublish} onClick={() => void act("publish")}><Send aria-hidden="true" /><span className="max-sm:sr-only">{t("publishNow")}</span></Button>}
  </>;
  const done = { write: Boolean(fields.title.trim()) && !missing.includes("body"), settings: !slugProblem, publish: post.status !== "draft" };
  const stepList = steps.map((id) => ({ id, label: t(`steps.${id}`), done: done[id], attention: id === "settings" && Boolean(slugProblem) }));
  const sidebar = { typeLabel: t("typeLabel"), status: { kind: post.status === "published" ? "live" as const : "draft" as const, label: t(`status.${post.status}`) }, back: { href: list, label: t("back") }, dirty,
    openPage: post.status === "published" ? { href: publicHref, label: t("openArticle") } : undefined };

  const cover = useFileUrl(tenantId, fields.coverFileId);
  const shownSlug = autoSlug ? "" : fields.slug, slugPrefix = `${blogPath(settings.handle)}/`;
  const url = `${origin}${blogPath(settings.handle, shownSlug || t("pending"))}`;
  const previewBody = bodyDirty ? null : body;
  const preview = <div className="space-y-4" data-blog-preview>
    <p className="text-xs font-medium text-muted-foreground">{t("previewCard")}</p>
    <BlogArticleCard headingLevel={3} card={{ href: "#", title, excerpt: derivedExcerpt(fields.excerpt, previewBody ?? body), date: format.dateTime(new Date(post.publishedAt ?? post.publishAt ?? post.updatedAt), { dateStyle: "medium" }),
      dateTime: post.publishedAt ?? post.updatedAt, minutes: t("public.minutes", { count: Math.max(1, readingMinutes(previewBody ?? body)) }), coverUrl: cover.url }} />
    <p className="text-xs font-medium text-muted-foreground">{t("searchPreview")}</p>
    <SearchPreview label={t("searchPreview")} untitled={t("untitled")} title={fields.title} seoTitle={fields.seoTitle} seoDescription={fields.seoDescription} excerpt={fields.excerpt} body={previewBody ?? body} url={url} />
  </div>;

  return <EditorShell headerInShell title={title} status={status} actions={actions} steps={stepList} current={step} onStep={(id) => setStep(id as Step)}
    stepsLabel={t("stepsLabel")} previewLabel={t("preview")} sidebar={sidebar} preview={step === "write" ? undefined : preview}>
    {error && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{error}{stale && <Button type="button" variant="outline" className="min-h-11" onClick={() => location.reload()}>{t("reload")}</Button>}</AlertDescription></Alert>}
    {step === "write" && <div className="flex h-[calc(100dvh-8rem)] min-h-[30rem] flex-col overflow-hidden rounded-xl border bg-card" data-blog-write data-blog-body>
      <DocEditorSurface key={surfaceKey} content={body} readOnly={false} showToolbar handleRef={surface} label={t("body")} bodyClassName="mx-auto w-full max-w-3xl px-4 pb-16 pt-2 sm:px-8"
        extraExtensions={extensions} slashExclude={slashExclude} mentions={false} toolbarExtras={[{ label: t("addPicture"), icon: ImagePlus, onSelect: () => setDialog("picture") }]}
        above={<div className="mx-auto w-full max-w-3xl space-y-3 px-4 pb-3 pt-5 sm:px-8" data-blog-composer-head>
          <label htmlFor="blog-title" className="sr-only">{t("titleField")}</label>
          <textarea id="blog-title" rows={1} value={fields.title} maxLength={blogLimits.title} placeholder={t("titlePlaceholder")} onChange={(e) => set({ title: e.target.value.replace(/\n/g, " ") })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); surface.current?.focusStart(); } }}
            className="field-sizing-content block min-h-11 w-full resize-none bg-transparent text-3xl font-semibold leading-tight tracking-tight outline-none placeholder:text-muted-foreground focus-visible:ring-0 sm:text-4xl" />
          {fields.coverFileId && cover.url && <div className="relative overflow-hidden rounded-lg border" data-blog-cover-preview>
            <img src={cover.url} alt="" className="aspect-[16/9] max-h-64 w-full object-cover" /></div>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" className="min-h-11 px-2 text-muted-foreground lg:min-h-9" onClick={() => setDialog("cover")}><ImageIcon aria-hidden="true" />{fields.coverFileId ? t("changeCover") : t("addCover")}</Button>
            {fields.coverFileId && <Button type="button" variant="ghost" className="min-h-11 px-2 text-muted-foreground lg:min-h-9" onClick={() => set({ coverFileId: null })}>{t("removeCover")}</Button>}
          </div>
        </div>}
        onChange={(read) => { readBody.current = read; setBodyDirty(true); }} onNewPage={() => {}} onInsert={(kind) => { if (kind !== "template") setInsertMode(kind); }}
        mentionSource={async () => []} onOutline={() => {}} onStats={(stats) => setWords(stats.words + (readBody.current ? blogImageIds(readBody.current()).length : 0))} />
    </div>}
    {step !== "write" && <WizardLayout steps={stepList} current={step} onStepChange={(id) => setStep(id as Step)} stepsLabel={t("stepsLabel")} stepper={false} focusOnStepChange={hosted}>
      {step === "settings" && <>
        <FormSection title={<span className="text-base font-semibold">{t("address")}</span>}>
          <Field data-invalid={slugProblem ? true : undefined}><FieldLabel htmlFor="blog-slug">{t("address")}</FieldLabel>
            <div className="flex min-w-0 items-center gap-1 text-sm"><span className="min-w-0 shrink truncate text-muted-foreground" dir="ltr">{slugPrefix}</span>
              <Input id="blog-slug" dir="ltr" className="min-h-11 min-w-[8rem] flex-1" maxLength={80} value={shownSlug} placeholder={autoSlug ? t("pending") : undefined} disabled={post.slugLocked}
                aria-invalid={slugProblem ? true : undefined} aria-describedby={slugProblem ? "blog-slug-error" : post.slugLocked ? "blog-slug-locked" : undefined}
                onChange={(e) => { setSlugIssue(null); set({ slug: e.target.value.toLowerCase() || (/^draft-[a-f0-9]{8}$/.test(saved.slug) ? saved.slug : "") }); }} /></div>
            {post.slugLocked && <FieldDescription id="blog-slug-locked">{t("addressLocked")}</FieldDescription>}
            {slugProblem && <FieldError id="blog-slug-error">{t(`slugProblems.${slugProblem}`)}</FieldError>}</Field>
          <Field><FieldLabel htmlFor="blog-excerpt">{t("excerpt")}</FieldLabel>
            <Textarea id="blog-excerpt" rows={3} maxLength={blogLimits.excerpt} value={fields.excerpt} onChange={(e) => set({ excerpt: e.target.value })} />
            <p className="text-xs text-muted-foreground" aria-live="polite">{t("count", { count: fields.excerpt.length, max: blogLimits.excerpt })}</p></Field>
          <PictureField id="cover" label={t("cover")} tenantId={tenantId} fileId={fields.coverFileId} onChoose={() => setDialog("cover")} onRemove={() => set({ coverFileId: null })} />
        </FormSection>
        <FormSection title={<span className="text-base font-semibold">{t("searchPreview")}</span>}>
          <Field><FieldLabel htmlFor="blog-seo-title">{t("seoTitle")}</FieldLabel>
            <Input id="blog-seo-title" className="min-h-11" maxLength={blogLimits.seoTitle} value={fields.seoTitle} placeholder={fields.title} onChange={(e) => set({ seoTitle: e.target.value })} />
            <p className="text-xs text-muted-foreground" aria-live="polite">{t("count", { count: fields.seoTitle.length, max: blogLimits.seoTitle })}</p></Field>
          <Field><FieldLabel htmlFor="blog-seo-description">{t("seoDescription")}</FieldLabel>
            <Textarea id="blog-seo-description" rows={3} maxLength={blogLimits.seoDescription} value={fields.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} />
            <p className="text-xs text-muted-foreground" aria-live="polite">{t("count", { count: fields.seoDescription.length, max: blogLimits.seoDescription })}</p></Field>
          <PictureField id="share" label={t("sharePicture")} hint={t("sharesCover")} tenantId={tenantId} fileId={fields.shareFileId} onChoose={() => setDialog("share")} onRemove={() => set({ shareFileId: null })} />
          <div className="xl:hidden"><SearchPreview label={t("searchPreview")} untitled={t("untitled")} title={fields.title} seoTitle={fields.seoTitle} seoDescription={fields.seoDescription} excerpt={fields.excerpt} body={previewBody ?? body} url={url} /></div>
        </FormSection>
      </>}
      {step === "publish" && <FormSection title={<span className="text-base font-semibold">{t("steps.publish")}</span>}>
        <div className="flex flex-wrap items-center gap-2 text-sm" data-blog-state>{status}
          {post.status === "scheduled" && post.publishAt && <span>{t("scheduleFor", { date: formatScheduled(post.publishAt, settings.timeZone) })}</span>}
          {post.status === "published" && post.publishedAt && <span>{t("publishedOn", { date: formatScheduled(post.publishedAt, settings.timeZone) })}</span>}</div>
        {missing.length > 0 && post.status !== "published" && <Alert role="status"><AlertDescription>{missing.map((m) => t(`missing.${m}`)).join(" ")}</AlertDescription></Alert>}
        {post.status !== "published" && <>
          <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={busy || !canPublish} onClick={() => void act("publish")}><Send aria-hidden="true" />{t("publishNow")}</Button></div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-end">
            <Field><FieldLabel htmlFor="blog-slot">{t("scheduleAt")}</FieldLabel>
              <Input id="blog-slot" type="datetime-local" className="min-h-11" value={slot} onChange={(e) => setSlot(e.target.value)} aria-describedby="blog-slot-zone" />
              <FieldDescription id="blog-slot-zone">{t("timeZone", { zone: `${settings.timeZone} (${utcOffsetLabel(settings.timeZone, new Date())})` })}</FieldDescription></Field>
            <Button type="button" variant="outline" className="min-h-11" disabled={busy || !canPublish || !slot} onClick={() => void act("schedule")}><CalendarClock aria-hidden="true" />{t("schedule")}</Button>
          </div>
          {post.status === "scheduled" && <div><Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => void act("unschedule")}><X aria-hidden="true" />{t("unschedule")}</Button></div>}
        </>}
        {post.status === "published" && <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="min-h-11"><Link href={publicHref} target="_blank" rel="noopener"><ExternalLink aria-hidden="true" />{t("openArticle")}</Link></Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setDialog("unpublish")}><Undo2 aria-hidden="true" />{t("unpublish")}</Button></div>}
      </FormSection>}
    </WizardLayout>}
    <StickySaveBar dirty={dirty} busy={busy && dirty} onSave={() => void act("save")} onDiscard={discard} saveLabel={t("save")} savingLabel={t("saving")} />
    <FilePicker open={dialog === "picture"} onOpenChange={(o) => !o && setDialog(null)} tenantId={tenantId} title={t("choosePicture")} imagesOnly
      onPick={(file) => { surface.current?.insertContent({ type: "blogImage", attrs: { fileId: file.id, alt: "" } }); }} />
    <FilePicker open={dialog === "cover" || dialog === "share"} onOpenChange={(o) => !o && setDialog(null)} tenantId={tenantId} title={t(dialog === "share" ? "sharePicture" : "cover")} imagesOnly
      onPick={(file) => { set(dialog === "share" ? { shareFileId: file.id } : { coverFileId: file.id }); }} />
    <InsertDialog mode={insertMode} onClose={() => setInsertMode(null)} onInsert={(mode, v) => {
      if (mode === "markdown") surface.current?.insertContent(v.blocks);
      else if (mode === "button") surface.current?.insertContent({ type: "button", attrs: { label: v.label, href: v.href } });
      else surface.current?.insertLink(v.label, v.href);
      setInsertMode(null);
    }} />
    <ConfirmDialog open={dialog === "unpublish"} onOpenChange={(open) => { if (!open) setDialog(null); }} tone="neutral" title={t("unpublishTitle")} description={t("unpublishBody")}
      confirmLabel={t("unpublishConfirm")} cancelLabel={t("cancel")} busyLabel={t("saving")} onConfirm={async () => { await act("unpublish"); setDialog(null); }} />
  </EditorShell>;
}

function PictureField({ id, label, hint, tenantId, fileId, onChoose, onRemove }: { id: string; label: string; hint?: string; tenantId: string; fileId: string | null; onChoose: () => void; onRemove: () => void }) {
  const t = useTranslations("Blog"), { url, failed } = useFileUrl(tenantId, fileId);
  return <div className="space-y-2" role="group" aria-labelledby={`blog-${id}-label`} data-blog-picture={id}>
    <p id={`blog-${id}-label`} className="text-sm font-medium">{label}</p>
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex aspect-[16/9] w-40 items-center justify-center overflow-hidden rounded-lg border bg-muted text-muted-foreground">
        {fileId && url ? <img src={url} alt="" className="size-full object-cover" /> : <span className="flex items-center gap-1.5 text-xs"><ImageIcon className="size-4" aria-hidden="true" />{fileId ? (failed ? t("pictureUnavailable") : t("pictureLoading")) : t("noPicture")}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-11 lg:min-h-9" onClick={onChoose}>{fileId ? t("change") : t("choose")}<span className="sr-only"> {label}</span></Button>
        {fileId && <Button type="button" variant="ghost" className="min-h-11 lg:min-h-9" onClick={onRemove}>{t("remove")}<span className="sr-only"> {label}</span></Button>}
      </div>
    </div>
    {hint && !fileId && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>;
}
