/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/social-media/components/create-post-dialog.tsx. Harvest changes: the kit Create Post button becomes a card at the top of the feed (avatar, a rounded "What's on your mind?" prompt, a photo button and Photo and Attach shortcuts that open the window on the matching tab; an Event shortcut follows with a real event picker); the viewer's name with the forum category in place of the audience select; title and the forum's rich text editor in place of the plain text box; the Photo, Video and Status tabs become Cover (upload), Video (a link) and Files (attachments), with Harvest's upload rules; the replies and likes switches; posting and editing call the existing forum routes; catalogue strings. Notes: docs/ui-sources.md. */
"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, ImageIcon, Paperclip, Video, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { useCrmRequest } from "@/components/crm/request";
import { uploadCommunityFile, type UploadError } from "@/components/forum/upload";
import { memberInitials } from "@/lib/community-members";
import { forumLimits } from "@/lib/forum";
import type { RichDoc } from "@/lib/rich-text";
import { videoEmbed } from "@/lib/video-embed";

export type ComposerCategory = { id: string; name: string; emoji: string | null; hostsOnly: boolean };
export type ComposerFile = { id: string; name: string };
export type ComposerInitial = { id: string; categoryId: string; title: string; body: RichDoc; videoUrl: string | null; cover: ComposerFile | null; attachments: ComposerFile[];
  commentsOff: boolean; likesOff: boolean };

/** The kit's "Create Post" window for the forum. New posts open from the card at the top of the feed ("What's on your mind?", Photo, Attach); edits open from a post's menu (defaultOpen and onClose, no card). */
export function PostComposer({ slug, categories, defaultCategory, initial, canModerate, author, defaultOpen = false, onClose }: { slug: string; categories: ComposerCategory[];
  defaultCategory?: string; initial?: ComposerInitial; canModerate: boolean; /** The viewer's name for the header. */ author: string; defaultOpen?: boolean; onClose?: () => void }) {
  const t = useTranslations("CommunityForum"), request = useCrmRequest(), router = useRouter();
  const usable = categories.filter((c) => canModerate || !c.hostsOnly);
  const fresh = () => ({ categoryId: initial?.categoryId ?? (usable.find((c) => c.id === defaultCategory) ?? usable[0])?.id ?? "", title: initial?.title ?? "", body: initial?.body ?? null,
    videoUrl: initial?.videoUrl ?? "", cover: initial?.cover ?? null, attachments: initial?.attachments ?? [], commentsOff: initial?.commentsOff ?? false, likesOff: initial?.likesOff ?? false });
  const [open, setOpen] = useState(defaultOpen), [form, setForm] = useState(fresh), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState("");
  const [newPostType, setNewPostType] = useState("image");
  const coverInput = useRef<HTMLInputElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof ReturnType<typeof fresh>>(key: K, value: ReturnType<typeof fresh>[K]) => setForm((f) => ({ ...f, [key]: value }));
  const videoValid = !form.videoUrl.trim() || videoEmbed(form.videoUrl.trim()) !== null;
  const uploadError = (e: UploadError) => t(`uploadErrors.${e}`);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen); setError("");
    if (isOpen) { setForm(fresh()); setNewPostType("image"); }
    else onClose?.();
  };
  /** The feed card's shortcuts open the same window on the matching tab (the attachment picker comes later; Attach opens the Files tab for now). */
  const openAt = (tab: string) => { handleOpenChange(true); setNewPostType(tab); };

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
    handleOpenChange(false); setForm(fresh());
    if (initial) router.refresh(); else router.push(`/communities/${slug}/posts/${result.data.id}`);
  }
  const hasText = Boolean(form.body?.content?.some((b) => "content" in b && b.content?.length));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!onClose && (
        <Card className="gap-0 py-0 shadow-sm">
          <div className="flex items-center gap-3 p-4 pb-3">
            <Avatar className="size-10">
              <AvatarFallback aria-hidden="true">{memberInitials(author)}</AvatarFallback>
            </Avatar>
            <DialogTrigger asChild>
              <Button variant="ghost" className="bg-muted text-muted-foreground hover:bg-accent hover:text-foreground min-h-11 flex-1 justify-start rounded-full px-4 font-normal">
                {t("mindPrompt")}
              </Button>
            </DialogTrigger>
            <Button variant="ghost" size="icon-responsive" className="text-primary rounded-full" aria-label={t("addPhoto")} onClick={() => openAt("image")}>
              <ImageIcon aria-hidden="true" />
            </Button>
          </div>
          <div role="group" aria-label={t("shortcuts")} className="grid grid-cols-2 border-t p-1">
            {([["image", ImageIcon, "shortcutPhoto"], ["files", Paperclip, "shortcutAttach"]] as const).map(([tab, Icon, label]) =>
              <Button key={label} variant="ghost" className="text-muted-foreground hover:text-foreground min-h-11 rounded-md lg:min-h-9" onClick={() => openAt(tab)}>
                <Icon className="text-primary" aria-hidden="true" />
                {t(label)}
              </Button>)}
          </div>
        </Card>
      )}
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t(initial ? "editPost" : "newPost")}</DialogTitle>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          {/* User Header */}
          <div className="flex items-center gap-3">
            <Avatar className="size-10">
              <AvatarFallback aria-hidden="true">{memberInitials(author)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 space-y-1">
              <p className="truncate font-semibold">{author}</p>
              {/* Category */}
              <Label htmlFor="post-category" className="sr-only">{t("category")}</Label>
              <Select value={form.categoryId} onValueChange={(value) => set("categoryId", value)}>
                <SelectTrigger
                  id="post-category"
                  size="sm"
                  className="text-muted-foreground h-11 gap-1 border-0 bg-transparent p-0 text-xs shadow-none lg:h-6 dark:bg-transparent dark:hover:bg-transparent [&_svg:not([class*='size-'])]:size-3.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {usable.map((c) => <SelectItem key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ""}{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="post-title">{t("title")}</Label>
            <Input id="post-title" className="min-h-11" value={form.title} maxLength={forumLimits.title} placeholder={t("titlePlaceholder")} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="space-y-2">
            <span className="text-sm font-medium">{t("post")}</span>
            <RichTextEditor value={form.body} onChange={(doc) => set("body", doc)} label={t("post")} />
          </div>

          {/* Post Type */}
          <Tabs value={newPostType} onValueChange={setNewPostType} className="gap-4">
            <TabsList className="h-auto w-full" aria-label={t("extras")}>
              <TabsTrigger value="image" className="min-h-11 lg:min-h-0">
                <ImageIcon aria-hidden="true" />
                {t("tabCover")}
              </TabsTrigger>
              <TabsTrigger value="video" className="min-h-11 lg:min-h-0">
                <Video aria-hidden="true" />
                {t("tabVideo")}
              </TabsTrigger>
              <TabsTrigger value="files" className="min-h-11 lg:min-h-0">
                <Paperclip aria-hidden="true" />
                {t("tabFiles")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="image" className="space-y-4">
              <span className="sr-only" id="post-cover-label">{t("cover")}</span>
              {form.cover
                ? <div className="flex min-h-11 items-center gap-3 rounded-md border px-3"><ImageIcon className="size-4" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-sm">{form.cover.name}</span>
                  <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("removeCover")} onClick={() => set("cover", null)}><X aria-hidden="true" /></Button></div>
                : <div className="rounded-lg border border-dashed p-8 text-center">
                  <ImageIcon className="text-muted-foreground/50 mx-auto size-8" aria-hidden="true" />
                  <Button type="button" variant="outline" size="sm" className="mt-2 min-h-11" disabled={uploading} aria-describedby="post-cover-label" onClick={() => coverInput.current?.click()}>
                    {t(uploading ? "uploading" : "addCover")}
                  </Button>
                </div>}
              <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true"
                onChange={(e) => { void upload(e.target.files?.[0], "cover"); e.target.value = ""; }} />
            </TabsContent>

            <TabsContent value="video" className="space-y-2">
              <Label htmlFor="post-video">{t("video")}</Label>
              <Input id="post-video" type="url" className="min-h-11" value={form.videoUrl} maxLength={500} placeholder={t("videoPlaceholder")} aria-invalid={!videoValid}
                onChange={(e) => set("videoUrl", e.target.value)} />
              {!videoValid && <p className="text-sm text-destructive">{t("videoInvalid")}</p>}
            </TabsContent>

            <TabsContent value="files" className="space-y-4">
              <span className="sr-only" id="post-attachments-label">{t("attachments")}</span>
              {form.attachments.length > 0 && <ul className="space-y-2" aria-labelledby="post-attachments-label">{form.attachments.map((a) => <li key={a.id} className="flex min-h-11 items-center gap-3 rounded-md border px-3">
                <FileText className="size-4" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
                <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("removeAttachment", { name: a.name })}
                  onClick={() => set("attachments", form.attachments.filter((x) => x.id !== a.id))}><X aria-hidden="true" /></Button></li>)}</ul>}
              {form.attachments.length < forumLimits.attachments && <div className="rounded-lg border border-dashed p-8 text-center">
                <Paperclip className="text-muted-foreground/50 mx-auto size-8" aria-hidden="true" />
                <Button type="button" variant="outline" size="sm" className="mt-2 min-h-11" disabled={uploading} aria-describedby="post-attachments-label" onClick={() => fileInput.current?.click()}>
                  {t(uploading ? "uploading" : "addAttachment")}
                </Button>
              </div>}
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,text/plain" className="sr-only" tabIndex={-1} aria-hidden="true"
                onChange={(e) => { void upload(e.target.files?.[0], "attachment"); e.target.value = ""; }} />
            </TabsContent>
          </Tabs>

          <Label htmlFor="post-comments-off" className="flex min-h-11 items-center justify-between gap-3 font-normal">{t("commentsOff")}
            <Switch id="post-comments-off" checked={form.commentsOff} onCheckedChange={(v) => set("commentsOff", v)} /></Label>
          <Label htmlFor="post-likes-off" className="flex min-h-11 items-center justify-between gap-3 font-normal">{t("likesOff")}
            <Switch id="post-likes-off" checked={form.likesOff} onCheckedChange={(v) => set("likesOff", v)} /></Label>

          {/* Action Icons */}
          <div className="flex items-center justify-end gap-4">
            <Button type="button" className="min-h-11" disabled={busy || uploading || !form.title.trim() || !hasText || !videoValid || !form.categoryId}
              onClick={() => void submit()}>{t(initial ? "save" : "publish")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
