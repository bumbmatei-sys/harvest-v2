"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, ImagePlus, Paperclip, Plus, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { useCrmRequest } from "@/components/crm/request";
import { uploadCommunityFile, type UploadError } from "@/components/forum/upload";
import { forumLimits } from "@/lib/forum";
import type { RichDoc } from "@/lib/rich-text";
import { videoEmbed } from "@/lib/video-embed";

export type ComposerCategory = { id: string; name: string; emoji: string | null; hostsOnly: boolean };
export type ComposerFile = { id: string; name: string };
export type ComposerInitial = { id: string; categoryId: string; title: string; body: RichDoc; videoUrl: string | null; cover: ComposerFile | null; attachments: ComposerFile[];
  commentsOff: boolean; likesOff: boolean };

/** Eden-style "New post" window: title, cover, video link, attachments, rich text, and the comments/likes switches. */
export function PostComposer({ slug, categories, defaultCategory, initial, canModerate }: { slug: string; categories: ComposerCategory[]; defaultCategory?: string;
  initial?: ComposerInitial; canModerate: boolean }) {
  const t = useTranslations("CommunityForum"), request = useCrmRequest(), router = useRouter();
  const usable = categories.filter((c) => canModerate || !c.hostsOnly);
  const fresh = () => ({ categoryId: initial?.categoryId ?? (usable.find((c) => c.id === defaultCategory) ?? usable[0])?.id ?? "", title: initial?.title ?? "", body: initial?.body ?? null,
    videoUrl: initial?.videoUrl ?? "", cover: initial?.cover ?? null, attachments: initial?.attachments ?? [], commentsOff: initial?.commentsOff ?? false, likesOff: initial?.likesOff ?? false });
  const [open, setOpen] = useState(false), [form, setForm] = useState(fresh), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState("");
  const coverInput = useRef<HTMLInputElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof ReturnType<typeof fresh>>(key: K, value: ReturnType<typeof fresh>[K]) => setForm((f) => ({ ...f, [key]: value }));
  const videoValid = !form.videoUrl.trim() || videoEmbed(form.videoUrl.trim()) !== null;
  const uploadError = (e: UploadError) => t(`uploadErrors.${e}`);
  async function upload(file: File | undefined, kind: "cover" | "attachment") {
    if (!file) return;
    setUploading(true); setError("");
    const result = await uploadCommunityFile(slug, file, kind);
    setUploading(false);
    if (!result.ok) { setError(uploadError(result.error)); return; }
    if (kind === "cover") set("cover", { id: result.file.id, name: result.file.name });
    else setForm((f) => ({ ...f, attachments: [...f.attachments, { id: result.file.id, name: result.file.name }] }));
  }
  async function submit() {
    setBusy(true); setError("");
    const payload = { categoryId: form.categoryId, title: form.title.trim(), body: form.body ?? { type: "doc", content: [{ type: "paragraph" }] }, videoUrl: form.videoUrl.trim() || null,
      coverFileId: form.cover?.id ?? null, attachmentIds: form.attachments.map((a) => a.id), commentsOff: form.commentsOff, likesOff: form.likesOff };
    const result = await request<{ id: string }>(initial ? `/api/communities/${slug}/posts/${initial.id}` : `/api/communities/${slug}/posts`, { method: initial ? "PATCH" : "POST", body: payload });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setOpen(false); setForm(fresh());
    if (initial) router.refresh(); else router.push(`/communities/${slug}/posts/${result.data.id}`);
  }
  const hasText = Boolean(form.body?.content?.some((b) => "content" in b && b.content?.length));
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setForm(fresh()); setError(""); }}>
    <DialogTrigger asChild>{initial
      ? <Button variant="outline" className="min-h-11">{t("edit")}</Button>
      : <Button className="min-h-11"><Plus aria-hidden="true" />{t("newPost")}</Button>}</DialogTrigger>
    <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{t(initial ? "editPost" : "newPost")}</DialogTitle></DialogHeader>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="space-y-4">
        <div className="space-y-2"><Label htmlFor="post-title">{t("title")}</Label>
          <Input id="post-title" className="min-h-11" value={form.title} maxLength={forumLimits.title} placeholder={t("titlePlaceholder")} onChange={(e) => set("title", e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="post-category">{t("category")}</Label>
          <Select value={form.categoryId} onValueChange={(value) => set("categoryId", value)}>
            <SelectTrigger id="post-category" className="min-h-11 w-full sm:w-72"><SelectValue /></SelectTrigger>
            <SelectContent>{usable.map((c) => <SelectItem key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ""}{c.name}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="space-y-2"><span className="text-sm font-medium" id="post-cover-label">{t("cover")}</span>
          {form.cover
            ? <div className="flex min-h-11 items-center gap-3 rounded-md border px-3"><ImagePlus className="size-4" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-sm">{form.cover.name}</span>
              <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("removeCover")} onClick={() => set("cover", null)}><X aria-hidden="true" /></Button></div>
            : <Button type="button" variant="outline" className="min-h-11 w-full" disabled={uploading} aria-describedby="post-cover-label" onClick={() => coverInput.current?.click()}>
              <ImagePlus aria-hidden="true" />{t("addCover")}</Button>}
          <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { void upload(e.target.files?.[0], "cover"); e.target.value = ""; }} /></div>
        <div className="space-y-2"><Label htmlFor="post-video">{t("video")}</Label>
          <Input id="post-video" type="url" className="min-h-11" value={form.videoUrl} maxLength={500} placeholder={t("videoPlaceholder")} aria-invalid={!videoValid}
            onChange={(e) => set("videoUrl", e.target.value)} />
          {!videoValid && <p className="text-sm text-destructive">{t("videoInvalid")}</p>}</div>
        <div className="space-y-2"><span className="text-sm font-medium" id="post-attachments-label">{t("attachments")}</span>
          {form.attachments.length > 0 && <ul className="space-y-2" aria-labelledby="post-attachments-label">{form.attachments.map((a) => <li key={a.id} className="flex min-h-11 items-center gap-3 rounded-md border px-3">
            <FileText className="size-4" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
            <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("removeAttachment", { name: a.name })}
              onClick={() => set("attachments", form.attachments.filter((x) => x.id !== a.id))}><X aria-hidden="true" /></Button></li>)}</ul>}
          {form.attachments.length < forumLimits.attachments && <Button type="button" variant="outline" className="min-h-11" disabled={uploading} aria-describedby="post-attachments-label"
            onClick={() => fileInput.current?.click()}><Paperclip aria-hidden="true" />{t(uploading ? "uploading" : "addAttachment")}</Button>}
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,text/plain" className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { void upload(e.target.files?.[0], "attachment"); e.target.value = ""; }} /></div>
        <div className="space-y-2"><span className="text-sm font-medium">{t("post")}</span>
          <RichTextEditor value={form.body} onChange={(doc) => set("body", doc)} label={t("post")} /></div>
        <Label htmlFor="post-comments-off" className="flex min-h-11 items-center justify-between gap-3 font-normal">{t("commentsOff")}
          <Switch id="post-comments-off" checked={form.commentsOff} onCheckedChange={(v) => set("commentsOff", v)} /></Label>
        <Label htmlFor="post-likes-off" className="flex min-h-11 items-center justify-between gap-3 font-normal">{t("likesOff")}
          <Switch id="post-likes-off" checked={form.likesOff} onCheckedChange={(v) => set("likesOff", v)} /></Label>
      </div>
      <DialogFooter><Button type="button" className="min-h-11" disabled={busy || uploading || !form.title.trim() || !hasText || !videoValid || !form.categoryId}
        onClick={() => void submit()}>{t(initial ? "save" : "publish")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
