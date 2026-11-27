"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRequest } from "@/hooks/use-request";
import { blogHandleProblem, blogLimits, blogPath } from "@/lib/blog";
import { notify } from "@/lib/toast";
import type { BlogOwnerSettings } from "@/server/blog";

/** The blog's name, intro and address (/blog/<address>). The address is fixed once an article is published. */
export function BlogSettingsDialog({ open, onOpenChange, tenantId, settings, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; tenantId: string; settings: BlogOwnerSettings; onSaved: (settings: BlogOwnerSettings) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
      {open && <SettingsForm key={settings.version} tenantId={tenantId} settings={settings} onDone={(next) => { onSaved(next); onOpenChange(false); }} />}
    </DialogContent>
  </Dialog>;
}

function SettingsForm({ tenantId, settings, onDone }: { tenantId: string; settings: BlogOwnerSettings; onDone: (settings: BlogOwnerSettings) => void }) {
  const t = useTranslations("Blog"), f = useTranslations("Blog.settingsForm"), request = useRequest();
  const [title, setTitle] = useState(settings.title), [intro, setIntro] = useState(settings.intro ?? ""), [handle, setHandle] = useState(settings.handle);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [taken, setTaken] = useState(false);
  const blogPrefix = `${blogPath("")}`;
  const problem = taken ? "taken" : blogHandleProblem(handle.trim().toLowerCase());
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (problem || !title.trim()) return;
    setBusy(true); setError(""); setTaken(false);
    const result = await request<BlogOwnerSettings>(`/api/workspaces/${tenantId}/blog`, { method: "PUT", body: { version: settings.version, handle: handle.trim().toLowerCase(), title, intro: intro.trim() || null } });
    setBusy(false);
    if (!result.ok) { if (result.details?.reason === "handle_taken") setTaken(true); else setError(result.error); return; }
    notify.success(f("saved")); onDone(result.data);
  }
  return <form onSubmit={save} className="space-y-4" noValidate>
    <DialogHeader><DialogTitle>{t("settings")}</DialogTitle></DialogHeader>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Field data-invalid={!title.trim() || undefined}><FieldLabel htmlFor="blog-name">{f("title")}</FieldLabel>
      <Input id="blog-name" className="min-h-11" maxLength={blogLimits.blogTitle} value={title} required aria-invalid={!title.trim() || undefined} onChange={(e) => setTitle(e.target.value)} /></Field>
    <Field><FieldLabel htmlFor="blog-intro">{f("intro")}</FieldLabel>
      <Textarea id="blog-intro" rows={3} maxLength={blogLimits.intro} value={intro} onChange={(e) => setIntro(e.target.value)} />
      <p className="text-xs text-muted-foreground" aria-live="polite">{f("introCount", { count: intro.length, max: blogLimits.intro })}</p></Field>
    <Field data-invalid={problem ? true : undefined}><FieldLabel htmlFor="blog-handle">{f("handle")}</FieldLabel>
      <div className="flex min-w-0 items-center gap-1 text-sm"><span className="shrink-0 text-muted-foreground" dir="ltr">{blogPrefix}</span>
        <Input id="blog-handle" dir="ltr" className="min-h-11" maxLength={30} value={handle} disabled={settings.handleLocked} aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? "blog-handle-error" : settings.handleLocked ? "blog-handle-locked" : undefined} onChange={(e) => { setTaken(false); setHandle(e.target.value.toLowerCase()); }} /></div>
      {settings.handleLocked && <FieldDescription id="blog-handle-locked">{f("handleLocked")}</FieldDescription>}
      {problem && <FieldError id="blog-handle-error">{f(`handleProblems.${problem}`)}</FieldError>}</Field>
    <DialogFooter><Button type="submit" className="min-h-11" disabled={busy || Boolean(problem) || !title.trim()}>{busy ? f("saving") : f("save")}</Button></DialogFooter>
  </form>;
}
