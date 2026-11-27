"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Circle, CircleCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EditorShell } from "@/components/editor/editor-shell";
import { useEditorHosted } from "@/components/editor/editor-context";
import { Field, FieldLabel } from "@/components/ui/field";
import { FormSection } from "@/components/form-section";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { StatusBadge } from "@/components/status-badge";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { WizardLayout } from "@/components/wizard-layout";
import { CatalogFilePicker } from "@/components/catalog/catalog-file-picker";
import { CatalogPreview } from "@/components/catalog/catalog-preview";
import { LessonListEditor } from "@/components/catalog/lesson-list-editor";
import { ProgressSummaryCard } from "@/components/catalog/progress-summary";
import type { ProgressSummary } from "@/lib/course-progress";
import { useRequest } from "@/hooks/use-request";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import {
  addressFollowsTitle, blankForm, catalogVisibilities, draftPayload, editorSteps, formFromItem, nextAddress, problems, publicPath, publishChecklist, sameForm, stateTone, stepOfCheck,
  type CatalogFile, type CatalogForm, type CatalogItem, type CatalogKind, type CatalogState, type EditorStepId,
} from "@/lib/catalog";

type Shelf = { id: string; name: string };
const contentProblems: readonly string[] = ["lessonTitle", "videoLink", "label"];
type Saved = { id: string; version: number };
type Moved = { id: string; version: number; state: CatalogState };

/**
 * Create and edit one free course or download in the shared EditorShell: Details, Lessons or Files, Access, Publish. The form is the whole draft; Save
 * sends it with the expected version (a stale version is "changed elsewhere, reload"), and Publish saves first. Creating the draft opens the editor for it.
 * Owners and admins edit; everyone else reads. Free only: there is no price, checkout or coupon. The server decides everything; this only guides.
 */
export function CatalogEditor({ tenantId, kind, initial, communities, files: initialFiles, host, writable, progress = null }: {
  tenantId: string; kind: CatalogKind; initial: CatalogItem | null; communities: Shelf[]; files: CatalogFile[]; host: string; writable: boolean;
  /** Owners and admins of a course: aggregate learner progress, counts only. */ progress?: ProgressSummary | null;
}) {
  const t = useTranslations("Catalog.editor"), shared = useTranslations("Catalog"), request = useRequest(), router = useRouter(), hosted = useEditorHosted();
  const [item, setItem] = useState(initial), [files, setFiles] = useState(initialFiles);
  const [form, setForm] = useState<CatalogForm>(() => (initial ? formFromItem(initial) : blankForm()));
  const [saved, setSaved] = useState<CatalogForm>(() => (initial ? formFromItem(initial) : blankForm()));
  const [shelves, setShelves] = useState<string[]>(initial?.communityIds ?? []);
  const [step, setStep] = useState<EditorStepId>("details");
  const [follows, setFollows] = useState(() => (initial ? addressFollowsTitle(initial) : true));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [conflict, setConflict] = useState(false), [attempted, setAttempted] = useState(false);
  const [archiving, setArchiving] = useState(false), [shelfBusy, setShelfBusy] = useState<string | null>(null);
  const dirty = !sameForm(form, saved);
  const { destination, setDestination, leave } = useUnsavedChangesGuard(dirty || busy);
  const state: CatalogState = item?.state ?? "draft", editable = writable && state !== "archived";
  const found = problems(kind, form), checklist = useMemo(() => publishChecklist(kind, form, files), [kind, form, files]);
  const listLabel = shared(kind === "course" ? "coursesTitle" : "productsTitle");
  const listHref = `/workspaces/${tenantId}/${kind === "course" ? "courses" : "products"}`, endpoint = `/api/workspaces/${tenantId}/catalog`;
  const set = <K extends keyof CatalogForm>(key: K, value: CatalogForm[K]) => { setNotice(""); setForm((current) => ({ ...current, [key]: value })); };
  const label = (id: EditorStepId) => (id === "content" ? t(kind === "course" ? "steps.lessons" : "steps.files") : t(`steps.${id}`));
  const title = form.title.trim() || t(kind === "course" ? "newCourse" : "newDownload");

  function fail(result: { status: number; error: string }) { setConflict(result.status === 409); setError(result.error); }
  /** Saves the draft: creates it (and opens its editor) or replaces it with the expected version. Returns the current item, or null on a failure. */
  async function save(): Promise<CatalogItem | null> {
    setAttempted(true);
    if (found.length) { setStep(contentProblems.includes(found[0]) ? "content" : "details"); setError(t(`problems.${found[0]}`)); return null; }
    if (!item) {
      const created = await request<Saved>(endpoint, { method: "POST", body: draftPayload(kind, form) });
      if (!created.ok) { fail(created); if (created.details?.reason === "address_unavailable") setStep("details"); return null; }
      setSaved(form); router.replace(`/workspaces/${tenantId}/products/${created.data.id}`);
      return null;
    }
    if (!dirty) return item;
    const result = await request<Saved>(`${endpoint}/${item.id}`, { method: "PUT", body: { version: item.version, draft: draftPayload(kind, form) } });
    if (!result.ok) { fail(result); if (result.details?.reason === "address_unavailable") setStep("details"); return null; }
    // Re-read so a new lesson carries the id the server gave it.
    const fresh = await request<CatalogItem>(`${endpoint}/${item.id}`, { method: "GET" });
    if (fresh.ok) {
      const synced = formFromItem(fresh.data);
      setItem(fresh.data); setSaved(synced); setForm(synced); setShelves(fresh.data.communityIds ?? shelves);
      return fresh.data;
    }
    const next = { ...item, title: form.title.trim(), slug: form.slug, summary: form.summary.trim(), visibility: form.visibility, version: result.data.version };
    setItem(next); setSaved(form);
    return next;
  }
  async function run(action: "save" | CatalogState) {
    setBusy(true); setError(""); setNotice(""); setConflict(false);
    const current = await save();
    if (current && action !== "save" && action !== current.state) {
      const moved = await request<Moved>(`${endpoint}/${current.id}/state`, { method: "PUT", body: { version: current.version, state: action } });
      if (moved.ok) { setItem({ ...current, state: moved.data.state, version: moved.data.version }); setNotice(t(`done.${action}`)); }
      else { fail(moved); setStep("publish"); }
    } else if (current) setNotice(t("saved"));
    setBusy(false);
  }
  function discard() { setForm(saved); setFollows(item ? addressFollowsTitle(item) : true); setNotice(""); setError(""); setConflict(false); setAttempted(false); }

  async function toggleShelf(community: Shelf, on: boolean) {
    if (!item) return;
    setShelfBusy(community.id); setError("");
    const result = await request<{ linked: boolean }>(`/api/workspaces/${tenantId}/communities/${community.id}/catalog/${item.id}`,
      on ? { method: "PUT", body: { position: 0 } } : { method: "DELETE" });
    setShelfBusy(null);
    if (!result.ok) { setError(result.error); return; }
    setShelves((current) => (on ? [...current, community.id] : current.filter((id) => id !== community.id)));
  }

  const steps = editorSteps.map((id) => ({ id, label: label(id), disabled: id === "publish" && !item,
    done: id === "details" ? checklist[0].done && checklist[1].done : id === "content" ? checklist[2].done : id === "access" ? true : state === "published",
    attention: attempted && ((id === "details" && (found.includes("title") || found.includes("address"))) || (id === "content" && found.some((problem) => contentProblems.includes(problem)))) }));
  const sidebar = { typeLabel: shared(`kinds.${kind}`), status: { kind: state === "published" ? "live" as const : "draft" as const, label: shared(`states.${state}`) }, back: { href: listHref, label: listLabel },
    openPage: state === "published" && item ? { href: publicPath(kind, form.slug), label: t("openPage") } : undefined, dirty };
  const status = <StatusBadge tone={stateTone(state)} label={shared(`states.${state}`)} dot />;
  const actions = editable && item && <>
    {state === "published"
      ? <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void run("draft")}>{t("unpublish")}</Button>
      : <Button className="min-h-11" disabled={busy || !checklist.every((check) => check.done)} onClick={() => void run("published")}>{t("publish")}</Button>}
    <ConfirmDialog tone="destructive" open={archiving} onOpenChange={setArchiving} title={t("archiveTitle")} description={t("archiveBody")} cancelLabel={t("cancel")} confirmLabel={t("archive")}
      trigger={<Button variant="outline" className="min-h-11" disabled={busy}>{t("archive")}</Button>} onConfirm={async () => { await run("archived"); setArchiving(false); }} />
  </>;
  const breadcrumb = <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><Link href={listHref}>{listLabel}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbPage>{title}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>;

  return <EditorShell breadcrumb={breadcrumb} title={title} status={status} actions={actions} steps={steps} current={step} onStep={(id) => setStep(id as EditorStepId)}
    stepsLabel={t("stepsLabel")} previewLabel={t("preview")} sidebar={sidebar} preview={<CatalogPreview kind={kind} title={form.title} summary={form.summary} slug={form.slug} host={host} />}>
    {!writable && <Alert><AlertDescription>{t("readOnly")}</AlertDescription></Alert>}
    {state === "archived" && <Alert><AlertDescription>{t("archived")}</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{error}
      {conflict && <Button variant="outline" className="min-h-11" onClick={() => { if (dirty) setDestination(location.href); else location.reload(); }}>{t("reload")}</Button>}</AlertDescription></Alert>}
    {notice && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
    <WizardLayout steps={steps} current={step} onStepChange={(id) => setStep(id as EditorStepId)} stepsLabel={t("stepsLabel")} stepper={false} focusOnStepChange={hosted}>
      {step === "details" && <FormSection title={t("detailsTitle")}>
        <Field><FieldLabel htmlFor="catalog-title">{t("fields.title")}</FieldLabel>
          <Input id="catalog-title" className="min-h-11" value={form.title} maxLength={120} required disabled={!editable} aria-invalid={attempted && found.includes("title") ? true : undefined}
            onChange={(event) => { const value = event.target.value; set("title", value); if (follows && state === "draft") set("slug", nextAddress(form.slug, value, true)); }} /></Field>
        <Field><FieldLabel htmlFor="catalog-address">{t("fields.address")}</FieldLabel>
          <InputGroup className="min-h-11"><InputGroupAddon><InputGroupText>{publicPath(kind, "")}</InputGroupText></InputGroupAddon>
            <InputGroupInput id="catalog-address" dir="ltr" value={form.slug} maxLength={60} required readOnly={!editable || state === "published"} aria-invalid={attempted && found.includes("address") ? true : undefined}
              onChange={(event) => { setFollows(false); set("slug", event.target.value.toLowerCase()); }} /></InputGroup></Field>
        <Field><FieldLabel htmlFor="catalog-summary">{t("fields.summary")}</FieldLabel>
          <Textarea id="catalog-summary" rows={4} value={form.summary} maxLength={2000} disabled={!editable} onChange={(event) => set("summary", event.target.value)} /></Field>
      </FormSection>}
      {step === "content" && (kind === "course"
        ? <LessonListEditor value={form} onChange={(next) => { setNotice(""); setForm((current) => ({ ...current, ...next })); }} onLabels={(next) => set("labels", next)}
          disabled={!editable} problems={attempted} />
        : <CatalogFilePicker tenantId={tenantId} value={form.fileIds} onChange={(next) => set("fileIds", next)} files={files} onFiles={setFiles} disabled={!editable} />)}
      {step === "access" && <>
        <FormSection as="fieldset" title={t("visibility")}>
          <RadioGroup value={form.visibility} onValueChange={(value) => set("visibility", value as CatalogForm["visibility"])} disabled={!editable} className="gap-2" aria-label={t("visibility")}>
            {catalogVisibilities.map((value) => <Label key={value} htmlFor={`catalog-visibility-${value}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal">
              <RadioGroupItem id={`catalog-visibility-${value}`} value={value} />{t(`visibilityOptions.${value}`)}</Label>)}
          </RadioGroup>
        </FormSection>
        <Card><CardHeader><CardTitle><h3 className="text-base font-semibold">{t("shelfTitle")}</h3></CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {communities.length === 0 ? <p className="text-sm text-muted-foreground">{t("shelfNone")}</p>
              : state !== "published" || !item ? <p className="text-sm text-muted-foreground">{t("shelfPublishFirst")}</p>
              : <ul aria-label={t("shelfTitle")} className="space-y-2">{communities.map((community) => <li key={community.id}>
                <Label htmlFor={`shelf-${community.id}`} className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 font-normal">
                  <span className="min-w-0 break-words">{community.name}</span>
                  <Switch id={`shelf-${community.id}`} checked={shelves.includes(community.id)} disabled={!writable || shelfBusy === community.id} onCheckedChange={(on) => void toggleShelf(community, on)} /></Label></li>)}</ul>}
            {communities.length > 0 && state === "published" && <p className="text-sm text-muted-foreground">{t("shelfNote")}</p>}
          </CardContent></Card>
      </>}
      {step === "publish" && progress && <ProgressSummaryCard summary={progress} />}
      {step === "publish" && <ul className="space-y-2" aria-label={t("checklist")}>
        {checklist.map((check) => <li key={check.id} className="flex min-h-11 flex-wrap items-center gap-3 rounded-md border px-3">
          {check.done ? <CircleCheck className="size-4 text-success" aria-hidden="true" /> : <Circle className="size-4 text-muted-foreground" aria-hidden="true" />}
          <span className="flex-1">{t(`checks.${check.id}`)}</span><span className="sr-only">{t(check.done ? "checkDone" : "checkOpen")}</span>
          {!check.done && <Button type="button" variant="outline" size="sm" className="min-h-11 lg:min-h-8" onClick={() => setStep(stepOfCheck(check.id))}>{t("goToStep", { step: label(stepOfCheck(check.id)) })}</Button>}</li>)}
      </ul>}
    </WizardLayout>
    {editable && <StickySaveBar guard={false} dirty={dirty || !item} busy={busy} onSave={() => void run("save")} onDiscard={discard} saveLabel={t(item ? "saveDraft" : "createDraft")} savingLabel={t("saving")} />}
    <ConfirmDialog tone="neutral" open={destination !== null} onOpenChange={(open) => { if (!open) setDestination(null); }} title={t("leaveTitle")} description={t("leaveBody")} cancelLabel={t("stay")} confirmLabel={t("leave")} onConfirm={leave} />
  </EditorShell>;
}
