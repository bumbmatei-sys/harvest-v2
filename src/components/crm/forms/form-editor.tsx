"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, ChevronRight, CircleCheck, ExternalLink, Loader2, Play, Redo2, Undo2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/toast";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { useCrmRequest } from "@/components/crm/request";
import { PublicForm } from "@/components/forms/public-form";
import { BuildCanvas } from "@/components/crm/forms/build-canvas";
import { FormSettingsPanel, type Destination, type Member } from "@/components/crm/forms/form-settings";
import { commit, formIssues, formLimits, redo, startHistory, undo, type FormDefinition, type FormDestination, type FormSettings } from "@/lib/crm-forms";

type Tab = "build" | "settings" | "preview";
type Save = "saved" | "saving" | "error" | "conflict";
const AUTOSAVE_MS = 900;

function destinationOf(value: string): FormDestination | null {
  if (!value) return null;
  return value.startsWith("pipeline:") ? { type: "pipeline", pipelineId: value.slice("pipeline:".length) } : { type: value as "people" | "organizations" };
}

/**
 * The CRM forms builder. Top bar: responses, Build / Settings / Preview, open, copy link and Publish. Build edits the form on a canvas with a
 * Start page and End page rail; Settings is a collapsible sidebar beside the live form; Preview is the form as a respondent sees it.
 * Drafts autosave. Publishing and the hosted link are not available yet, so those controls say so instead of pretending.
 */
export function FormEditor({ tenantId, formId, initial, revision, destinations, members }: {
  tenantId: string; formId: string; initial: FormDefinition; revision: number; destinations: Destination[]; members: Member[];
}) {
  const t = useTranslations("CrmForms"), tb = useTranslations("CrmForms.bar");
  const request = useCrmRequest();
  const [history, setHistory] = useState(() => startHistory(initial)), form = history.present;
  const [tab, setTab] = useState<Tab>(initial.settings.landing === "preview" ? "preview" : "build");
  const [page, setPage] = useState<"start" | "end">("start"), [selected, setSelected] = useState<string | null>(null);
  const [save, setSave] = useState<Save>("saved"), [live, setLive] = useState("");
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(strip(initial))), rev = useRef(revision), busy = useRef(false);
  const dirty = useMemo(() => JSON.stringify(strip(form)) !== savedJson, [form, savedJson]);
  // Edits wait a moment before they are sent; until they have been saved the form shows Saving and leaving asks first.
  const shown: Save = save === "saved" && dirty ? "saving" : save;
  const { destination, setDestination, leave } = useUnsavedChangesGuard(shown !== "saved");
  const issues = useMemo(() => formIssues(form), [form]);

  const change = useCallback((fn: (f: FormDefinition) => FormDefinition, key?: string) => setHistory((h) => commit(h, fn(h.present), Date.now(), key ?? null)), []);
  const changeSettings = useCallback((fn: (s: FormSettings) => FormSettings, key?: string) => change((f) => ({ ...f, settings: fn(f.settings) }), key), [change]);

  const flush = useCallback(async (definition: FormDefinition) => {
    if (busy.current) return;
    busy.current = true; setSave("saving");
    const body = JSON.stringify(strip(definition));
    const result = await request<{ revision: number }>(`/api/workspaces/${tenantId}/crm/forms/${formId}`, { method: "PUT", body: { definition, revision: rev.current } });
    busy.current = false;
    if (result.ok) { rev.current = result.data.revision; setSavedJson(body); setSave("saved"); }
    else setSave(result.status === 409 ? "conflict" : "error");
  }, [request, tenantId, formId]);

  useEffect(() => {
    if (save === "conflict" || !dirty) return;
    const timer = setTimeout(() => void flush(form), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [form, flush, save, dirty]);

  useEffect(() => {
    function keys(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable=true]"))) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault(); setHistory((h) => event.shiftKey ? redo(h) : undo(h));
    }
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  }, []);

  const unavailable = () => notify.info(t("bar.unavailable"));
  const destinationChange = (value: string) => change((f) => ({ ...f, destination: destinationOf(value) }));
  const status = shown === "saving" ? tb("saving") : shown === "saved" ? tb("saved") : shown === "conflict" ? tb("conflictShort") : tb("saveFailed");

  return <div className="min-w-0 space-y-4" data-crm-form-editor>
    <header className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label={t("breadcrumb")} className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/workspaces/${tenantId}/crm/forms`} className="inline-flex min-h-11 items-center hover:underline">{t("forms")}</Link><ChevronRight className="size-4" aria-hidden="true" /><span className="truncate font-medium text-foreground">{form.title}</span></nav>
      <div className="flex items-center gap-1">
        <span role="status" className={cn("me-2 inline-flex items-center gap-1 text-xs", shown === "error" || shown === "conflict" ? "text-destructive" : "text-muted-foreground")} data-save-status={shown}>
          {shown === "saving" ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : shown === "saved" ? <Check className="size-3" aria-hidden="true" /> : null}{status}</span>
        <Button type="button" variant="ghost" size="icon" className="size-11" disabled={!history.past.length} aria-label={tb("undo")} onClick={() => setHistory(undo)}><Undo2 aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="icon" className="size-11" disabled={!history.future.length} aria-label={tb("redo")} onClick={() => setHistory(redo)}><Redo2 aria-hidden="true" /></Button>
      </div>
    </header>
    {save === "conflict" && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{t("errors.conflict")}<Button type="button" variant="outline" className="min-h-11" onClick={() => location.reload()}>{t("errors.reload")}</Button></AlertDescription></Alert>}
    {save === "error" && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{t("errors.saveFailed")}<Button type="button" variant="outline" className="min-h-11" onClick={() => void flush(form)}>{t("errors.retry")}</Button></AlertDescription></Alert>}

    <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
      <Badge variant="outline" className="h-8 rounded-md px-3 text-sm font-normal" data-responses>{tb("responses", { count: 0 })}</Badge>
      <TabsList className="order-last w-full sm:order-none sm:w-auto" aria-label={tb("views")}>{(["build", "settings", "preview"] as const).map((value) => <TabsTrigger key={value} value={value} className="min-h-11 flex-1 sm:flex-none sm:px-5">{tb(value)}</TabsTrigger>)}</TabsList>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon" className="size-11" aria-disabled="true" aria-label={tb("open")} onClick={unavailable}><ExternalLink aria-hidden="true" /></Button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="min-h-11">{tb("copy")}<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem className="min-h-11" onSelect={unavailable}>{tb("copyLink")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        <Button type="button" variant="outline" className="min-h-11" aria-disabled="true" onClick={unavailable} data-publish>{tb("publish")}</Button>
      </div>
    </div>

    <TabsContent value="build" className="min-w-0 space-y-4"><div className="grid min-w-0 gap-6 lg:grid-cols-[11rem_minmax(0,1fr)]">
      <nav aria-label={t("pages.label")} className="flex gap-2 lg:sticky lg:top-4 lg:flex-col lg:self-start" data-page-rail>
        {(["start", "end"] as const).map((value) => <button key={value} type="button" aria-current={page === value ? "page" : undefined} onClick={() => setPage(value)}
          className={cn("flex min-h-11 items-center gap-3 rounded-md px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", page === value ? "font-medium text-foreground" : "text-muted-foreground hover:bg-accent/50")}>
          <span className={cn("hidden h-6 w-1 rounded-full lg:block", page === value ? "bg-foreground" : "bg-muted")} aria-hidden="true" />{value === "start" ? <Play className="size-4" aria-hidden="true" /> : <CircleCheck className="size-4" aria-hidden="true" />}{t(`pages.${value}`)}</button>)}</nav>
      {page === "start"
        ? <BuildCanvas form={form} change={change} selected={selected} setSelected={setSelected} notify={setLive} />
        : <div className="mx-auto w-full max-w-3xl space-y-4" data-end-page>
          <Input aria-label={t("end.title")} className="h-auto min-h-12 border-0 border-b rounded-none px-0 text-3xl font-semibold shadow-none focus-visible:ring-0 md:text-3xl" value={form.endTitle} maxLength={formLimits.title} onChange={(e) => change((f) => ({ ...f, endTitle: e.target.value }), "end-title")} />
          <Textarea aria-label={t("end.body")} rows={4} className="min-h-0 resize-none border-0 border-b rounded-none px-0 shadow-none focus-visible:ring-0" value={form.endBody} maxLength={formLimits.description} onChange={(e) => change((f) => ({ ...f, endBody: e.target.value }), "end-body")} />
          <Button type="button" variant="outline" className="min-h-11" onClick={() => change((f) => ({ ...f, endBody: `${f.endBody}${f.endBody && !f.endBody.endsWith(" ") ? " " : ""}{name}` }))}>{t("end.insertName")}</Button>
        </div>}
    </div>
    {issues.length > 0 && <ul className="mx-auto flex max-w-3xl flex-wrap gap-2" aria-label={t("issues.label")}>{issues.map((issue) => <li key={issue}><Badge variant="outline">{t(`issues.${issue}`)}</Badge></li>)}</ul>}
    </TabsContent>

    <TabsContent value="settings" className="min-w-0"><div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div inert className="min-w-0 max-lg:hidden" aria-hidden="true"><PublicForm form={form} idPrefix="settings-preview" /></div>
      <FormSettingsPanel form={form} destinations={destinations} members={members} onSettings={changeSettings} onDestination={destinationChange} />
    </div></TabsContent>

    <TabsContent value="preview"><div className="mx-auto w-full max-w-3xl" data-preview-tab><PublicForm form={form} idPrefix="preview" /></div></TabsContent>
    </Tabs>
    <p className="sr-only" role="status" aria-live="polite">{live}</p>

    <AlertDialog open={destination !== null} onOpenChange={(open) => { if (!open) setDestination(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("leave.title")}</AlertDialogTitle><AlertDialogDescription>{t("leave.body")}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel className="min-h-11">{t("leave.stay")}</AlertDialogCancel><AlertDialogAction className="min-h-11" onClick={leave}>{t("leave.leave")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

/** What autosave compares: the revision and timestamp are the server's, not the editor's. */
function strip(form: FormDefinition) { const copy: Partial<FormDefinition> = { ...form }; delete copy.revision; delete copy.updatedAt; return copy; }
