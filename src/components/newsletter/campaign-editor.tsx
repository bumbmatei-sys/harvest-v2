"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, ChevronRight, Loader2, LayoutTemplate, Palette, Redo2, Send, Undo2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FormSection } from "@/components/form-section";
import { EditorShell } from "@/components/editor/editor-shell";
import { BlockCanvas } from "@/components/newsletter/block-canvas";
import { DesignPanel } from "@/components/newsletter/design-panel";
import { EmailPreview } from "@/components/newsletter/email-preview";
import { SendStep, type ListOption, type SenderOption } from "@/components/newsletter/send-step";
import { TemplatePicker } from "@/components/newsletter/template-picker";
import { useCrmRequest } from "@/components/crm/request";
import { emailDocumentSchema, isEmailDocument, type BrandKit, type EmailBlock, type EmailDocument } from "@/lib/email/blocks";
import { inboxCheck } from "@/lib/email/inbox-check";
import { blankDocument, templateDocument, type TemplateId } from "@/lib/email/templates";
import { commit, redo, startHistory, undo } from "@/lib/crm-forms";
import { notify } from "@/lib/toast";

export type CampaignData = { id: string; name: string; version: number; subject: string; preheader: string | null; senderId: string | null; replyToId: string | null;
  content: unknown; selection: { listIds: string[]; segmentIds: string[] } };
type Draft = { name: string; subject: string; preheader: string; doc: EmailDocument; listIds: string[]; segmentIds: string[]; senderId: string | null; replyToId: string | null };
type Save = "saved" | "saving" | "error" | "conflict";
const AUTOSAVE_MS = 1200;
const copyKeys = ["title", "heading", "text", "button", "cite", "date", "time", "location", "caption", "leftHeading", "leftText", "rightHeading", "rightText", "linkOne", "linkTwo", "note"] as const;

/** The campaign editor (shared EditorShell): Write (subject, block canvas, design, templates, preview) and Send (audience with a live count, when, inbox check). */
export function CampaignEditor({ tenantId, ministryName, campaign, brandKit, lists, groups, senders }: {
  tenantId: string; ministryName: string; campaign: CampaignData; brandKit: { kit: BrandKit; version: number }; lists: ListOption[]; groups: ListOption[]; senders: SenderOption[];
}) {
  const t = useTranslations("NewsletterCampaigns"), e = useTranslations("NewsletterCampaigns.editor"), d = useTranslations("NewsletterCampaigns.defaults"), request = useCrmRequest();
  const initial = useMemo<Draft>(() => ({
    name: campaign.name, subject: campaign.subject, preheader: campaign.preheader ?? "",
    doc: isEmailDocument(campaign.content) ? (campaign.content as EmailDocument) : blankDocument(brandKit.kit),
    listIds: campaign.selection.listIds, segmentIds: campaign.selection.segmentIds, senderId: campaign.senderId, replyToId: campaign.replyToId,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  const [history, setHistory] = useState(() => startHistory(initial));
  const draft = history.present;
  const [step, setStep] = useState("write"), [selected, setSelected] = useState<string | null>(null), [panel, setPanel] = useState<"design" | "templates" | null>(null);
  const [save, setSave] = useState<Save>("saved"), [announcement, setAnnouncement] = useState(""), [kitVersion, setKitVersion] = useState(brandKit.version), [kitSaving, setKitSaving] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<TemplateId | "blank" | null>(null);
  const version = useRef(campaign.version), busy = useRef(false);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initial));
  const dirty = JSON.stringify(draft) !== savedJson;
  const parsed = useMemo(() => emailDocumentSchema.safeParse(draft.doc), [draft.doc]);
  const valid = parsed.success && draft.subject.trim().length > 0 && draft.name.trim().length > 0;
  const checks = useMemo(() => inboxCheck({ subject: draft.subject, preheader: draft.preheader, doc: draft.doc }), [draft.subject, draft.preheader, draft.doc]);
  const copy = useCallback(() => Object.fromEntries(copyKeys.map((k) => [k, d(k)])), [d]);

  const change = useCallback((fn: (draft: Draft) => Draft, key?: string) => { setSave((s) => s === "error" ? "saved" : s); setHistory((h) => commit(h, fn(h.present), Date.now(), key ?? null)); }, []);
  const changeBlocks = useCallback((fn: (blocks: EmailBlock[]) => EmailBlock[], key?: string) => change((x) => ({ ...x, doc: { ...x.doc, blocks: fn(x.doc.blocks) } }), key), [change]);
  const changeBrand = useCallback((patch: Partial<BrandKit>, key?: string) => change((x) => ({ ...x, doc: { ...x.doc, brand: { ...x.doc.brand, ...patch } } }), key ? `brand-${key}` : undefined), [change]);

  const flush = useCallback(async (value: Draft) => {
    if (busy.current) return;
    busy.current = true; setSave("saving");
    const body = JSON.stringify(value);
    const result = await request<{ version: number }>(`/api/workspaces/${tenantId}/newsletter/campaigns/${campaign.id}`, { method: "PATCH", body: {
      name: value.name.trim(), subject: value.subject.trim(), preheader: value.preheader.trim() || null, senderId: value.senderId, replyToId: value.replyToId,
      selection: { listIds: value.listIds, segmentIds: value.segmentIds }, content: value.doc, version: version.current } });
    busy.current = false;
    if (result.ok) { version.current = result.data.version; setSavedJson(body); setSave("saved"); } else setSave(result.status === 409 ? "conflict" : "error");
  }, [request, tenantId, campaign.id]);

  useEffect(() => {
    if (!dirty || !valid || save === "conflict") return;
    const timer = setTimeout(() => void flush(draft), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, dirty, valid, save, flush]);

  useEffect(() => {
    function keys(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault(); setHistory((h) => event.shiftKey ? redo(h) : undo(h));
    }
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  }, []);

  async function sendTest() {
    if (dirty && valid) await flush(draft);
    const result = await request(`/api/workspaces/${tenantId}/newsletter/campaigns/${campaign.id}/test-sink`, { method: "POST", body: {} });
    if (result.ok) notify.success(e("testSent")); else notify.error(e("testFailed"));
  }
  async function saveKit() {
    setKitSaving(true);
    const result = await request<{ version: number }>(`/api/workspaces/${tenantId}/newsletter/brand-kit`, { method: "PUT", body: { kit: draft.doc.brand, ...(kitVersion ? { version: kitVersion } : {}) } });
    setKitSaving(false);
    if (result.ok) { setKitVersion(result.data.version); notify.success(t("design.saved")); } else notify.error(t("design.saveFailed"));
  }
  function applyTemplate(id: TemplateId | "blank") {
    const doc = id === "blank" ? blankDocument(draft.doc.brand) : templateDocument(id, draft.doc.brand);
    change((x) => ({ ...x, doc }));
    setSelected(null); setPanel(null); setPendingTemplate(null);
  }

  const shown = save === "saved" && dirty ? (valid ? "saving" : "invalid") : save;
  const status = shown === "saving" ? e("saving") : shown === "saved" ? e("saved") : shown === "conflict" ? e("conflict") : shown === "invalid" ? e("fixFields") : e("saveFailed");
  const preview = <EmailPreview doc={draft.doc} preheader={draft.preheader} ministryName={ministryName} firstName={t("preview.firstName")} />;

  return <div data-newsletter-editor>
    <EditorShell
      breadcrumb={<nav aria-label={e("breadcrumb")} className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/workspaces/${tenantId}/newsletter/campaigns`} className="inline-flex min-h-11 items-center hover:underline">{e("breadcrumb")}</Link><ChevronRight className="size-4" aria-hidden="true" /><span className="truncate font-medium text-foreground">{draft.name}</span></nav>}
      title={draft.name || d("name")}
      status={<span role="status" className="inline-flex items-center gap-1 text-xs text-muted-foreground" data-save-status={shown}>
        {shown === "saving" ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : shown === "saved" ? <Check className="size-3" aria-hidden="true" /> : null}{status}</span>}
      actions={<>
        <Button type="button" variant="ghost" size="icon" className="size-11" disabled={!history.past.length} aria-label={e("undo")} onClick={() => setHistory(undo)}><Undo2 aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="icon" className="size-11" disabled={!history.future.length} aria-label={e("redo")} onClick={() => setHistory(redo)}><Redo2 aria-hidden="true" /></Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => void sendTest()}><Send aria-hidden="true" />{e("sendTest")}</Button>
      </>}
      steps={[{ id: "write", label: e("write") }, { id: "send", label: e("send") }]} current={step} onStep={setStep} stepsLabel={e("steps")}
      preview={preview} previewLabel={e("preview")}>
      {save === "conflict" && <Alert variant="destructive"><AlertDescription>{e("conflict")}</AlertDescription></Alert>}
      {step === "write" ? <>
        <FormSection title={e("write")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="nl-name">{e("name")}</Label><Input id="nl-name" className="min-h-11" maxLength={100} value={draft.name} onChange={(ev) => change((x) => ({ ...x, name: ev.target.value }), "name")} /></div>
            <div className="space-y-2"><Label htmlFor="nl-subject">{e("subject")}</Label><Input id="nl-subject" className="min-h-11" maxLength={150} aria-invalid={!draft.subject.trim() || undefined} value={draft.subject} onChange={(ev) => change((x) => ({ ...x, subject: ev.target.value }), "subject")} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="nl-preheader">{e("previewText")}</Label><Input id="nl-preheader" className="min-h-11" maxLength={200} value={draft.preheader} onChange={(ev) => change((x) => ({ ...x, preheader: ev.target.value }), "preheader")} /></div>
          </div>
        </FormSection>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setPanel("design")}><Palette aria-hidden="true" />{e("design")}</Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setPanel("templates")}><LayoutTemplate aria-hidden="true" />{e("templates")}</Button>
        </div>
        <BlockCanvas blocks={draft.doc.blocks} change={changeBlocks} selected={selected} setSelected={setSelected} notify={setAnnouncement} copy={copy} />
      </> : <SendStep tenantId={tenantId} lists={lists} groups={groups} senders={senders} listIds={draft.listIds} segmentIds={draft.segmentIds} senderId={draft.senderId} replyToId={draft.replyToId} subject={draft.subject} checks={checks}
        onSelection={(listIds, segmentIds) => change((x) => ({ ...x, listIds, segmentIds }), "selection")} onIdentity={(key, id) => change((x) => ({ ...x, [key]: id }))} />}
    </EditorShell>
    <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
    <Sheet open={panel === "design"} onOpenChange={(open) => !open && setPanel(null)}><SheetContent className="w-full overflow-y-auto sm:max-w-lg" aria-describedby={undefined}><SheetHeader><SheetTitle>{t("design.title")}</SheetTitle></SheetHeader>
      <div className="p-4"><DesignPanel brand={draft.doc.brand} onChange={changeBrand} onSave={() => void saveKit()} saving={kitSaving} /></div></SheetContent></Sheet>
    <Dialog open={panel === "templates"} onOpenChange={(open) => !open && setPanel(null)}><DialogContent className="max-h-[90dvh] w-full overflow-y-auto sm:max-w-5xl"><DialogHeader><DialogTitle>{t("pickTemplate")}</DialogTitle></DialogHeader>
      <TemplatePicker brand={draft.doc.brand} ministryName={ministryName} onPick={setPendingTemplate} /></DialogContent></Dialog>
    <Dialog open={pendingTemplate !== null} onOpenChange={(open) => !open && setPendingTemplate(null)}><DialogContent><DialogHeader><DialogTitle>{t("pickTemplateReplace")}</DialogTitle></DialogHeader>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" className="min-h-11" onClick={() => setPendingTemplate(null)}>{t("cancel")}</Button>
        <Button type="button" className="min-h-11" onClick={() => pendingTemplate && applyTemplate(pendingTemplate)}>{t("replace")}</Button></div></DialogContent></Dialog>
  </div>;
}
