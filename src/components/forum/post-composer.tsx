/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/social-media/components/create-post-dialog.tsx. Harvest changes: the kit Create Post button becomes a card at the top of the feed (avatar, a rounded "What's on your mind?" prompt, a photo button and Photo, Attach and, for hosts, Event shortcuts); the viewer's name with the forum category as a chip in place of the audience select; title and the forum's rich text editor in place of the plain text box; the Photo, Video and Status tabs become an icon row (Photo, Location, Feeling, Tag people, Attach) with inline panels, the host item picker and Harvest's upload rules; on phones the window fills the screen (close at the top left, Post at the top right, the icon row above the keyboard); the replies and likes switches; posting and editing call the existing forum routes; catalogue strings. Notes: docs/ui-sources.md. */
"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { CalendarDays, FileText, ImageIcon, MapPin, Paperclip, Search, Smile, UserPlus, Video, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { useCrmRequest } from "@/components/crm/request";
import { uploadCommunityFile, type UploadError } from "@/components/forum/upload";
import { ItemPicker, type PickedItem } from "@/components/forum/item-picker";
import { LinkedItemCard, itemKindIcon } from "@/components/forum/post-details";
import { memberInitials } from "@/lib/community-members";
import { forumFeelings, forumItemKinds, forumLimits, type ForumItemKind, type ForumPostDetailsInput } from "@/lib/forum";
import { mapsHref } from "@/lib/maps-link";
import type { RichDoc } from "@/lib/rich-text";
import { videoEmbed } from "@/lib/video-embed";
import { cn } from "@/lib/utils";

export type ComposerCategory = { id: string; name: string; emoji: string | null; hostsOnly: boolean };
export type ComposerFile = { id: string; name: string };
export type ComposerPerson = { id: string; name: string };
type Feeling = NonNullable<ForumPostDetailsInput["feeling"]>;
export type ComposerDetails = { photos: ComposerFile[]; location: string | null; feeling: Feeling | null; mentions: ComposerPerson[]; linkedItems: PickedItem[] };
export type ComposerInitial = { id: string; categoryId: string; title: string; body: RichDoc; videoUrl: string | null; cover: ComposerFile | null; attachments: ComposerFile[];
  commentsOff: boolean; likesOff: boolean; details?: ComposerDetails };

const photoLimit = 10, mentionLimit = 10, itemLimit = 5;
const imageTypes = "image/jpeg,image/png,image/webp";
type Panel = "location" | "feeling" | "people" | "attach" | "video" | "pick" | null;
/** Where a feed-card shortcut opens the window: the composer, the photo chooser, the attach list or the event picker. */
type Start = "compose" | "photo" | "attach" | "event";

/** The window follows the visible viewport on phones, so the icon row stays just above the on-screen keyboard. */
function useVisualViewport(active: boolean) {
  const [box, setBox] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const view = typeof window === "undefined" ? null : window.visualViewport;
    if (!active || !view) return;
    const update = () => setBox({ height: view.height, top: view.offsetTop });
    update();
    view.addEventListener("resize", update); view.addEventListener("scroll", update);
    return () => { view.removeEventListener("resize", update); view.removeEventListener("scroll", update); };
  }, [active]);
  return box ? { "--composer-vh": `${box.height}px`, "--composer-top": `${box.top}px` } as CSSProperties : undefined;
}

/** The kit's "Create Post" window for the forum. New posts open from the card at the top of the feed; edits open from a post's menu (defaultOpen and onClose, no card). */
export function PostComposer({ slug, categories, defaultCategory, initial, canModerate, author, defaultOpen = false, onClose, people = [], canLink = canModerate }: { slug: string;
  categories: ComposerCategory[]; defaultCategory?: string; initial?: ComposerInitial; canModerate: boolean; /** The viewer's name for the header. */ author: string;
  defaultOpen?: boolean; onClose?: () => void; /** Active members the viewer can tag (not the viewer). */ people?: ComposerPerson[];
  /** Hosts (owner, admin, moderator) link articles, products, courses, events and forms; the server enforces it too. */ canLink?: boolean }) {
  const t = useTranslations("CommunityForum"), request = useCrmRequest(), router = useRouter();
  const usable = categories.filter((c) => canModerate || !c.hostsOnly);
  const fresh = () => ({ categoryId: initial?.categoryId ?? (usable.find((c) => c.id === defaultCategory) ?? usable[0])?.id ?? "", title: initial?.title ?? "", body: initial?.body ?? null,
    videoUrl: initial?.videoUrl ?? "", cover: initial?.cover ?? null, attachments: initial?.attachments ?? [], commentsOff: initial?.commentsOff ?? false, likesOff: initial?.likesOff ?? false,
    photos: initial?.details?.photos ?? [], location: initial?.details?.location ?? "", feeling: initial?.details?.feeling ?? null as Feeling | null,
    mentions: initial?.details?.mentions ?? [], linked: canLink ? initial?.details?.linkedItems ?? [] : [] });
  const [open, setOpen] = useState(defaultOpen), [form, setForm] = useState(fresh), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState("");
  const [panel, setPanel] = useState<Panel>(null), [pickKind, setPickKind] = useState<ForumItemKind>("event"), [personQuery, setPersonQuery] = useState("");
  const photoInput = useRef<HTMLInputElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const viewport = useVisualViewport(open);
  const set = <K extends keyof ReturnType<typeof fresh>>(key: K, value: ReturnType<typeof fresh>[K]) => setForm((f) => ({ ...f, [key]: value }));
  const videoValid = !form.videoUrl.trim() || videoEmbed(form.videoUrl.trim()) !== null;
  const uploadError = (e: UploadError) => t(`uploadErrors.${e}`);
  const toggle = (next: Exclude<Panel, null>) => setPanel((current) => current === next ? null : next);
  // An opened panel (location, feeling, people, attach, picker) is brought into view above the icon row.
  useEffect(() => {
    if (!panel) return;
    const frame = requestAnimationFrame(() => document.getElementById("post-panel")?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [panel]);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen); setError("");
    if (isOpen) { setForm(fresh()); setPanel(null); setPersonQuery(""); }
    else onClose?.();
  };
  /** The feed card's shortcuts open the same window: Photo opens the photo chooser, Attach the attach list, Event the event picker. */
  const openAt = (start: Start) => {
    handleOpenChange(true);
    if (start === "attach") setPanel("attach");
    if (start === "event") { setPickKind("event"); setPanel("pick"); }
    if (start === "photo") photoInput.current?.click();
  };
  const pick = (kind: ForumItemKind) => { setPickKind(kind); setPanel("pick"); };

  async function upload(file: File, kind: "photo" | "attachment") {
    const result = await uploadCommunityFile(slug, file, "attachment");
    if (!result.ok) { setError(uploadError(result.error)); return; }
    const added = { id: result.file.id, name: result.file.name };
    setForm((f) => kind === "photo" ? { ...f, photos: f.photos.length < photoLimit ? [...f.photos, added] : f.photos } : { ...f, attachments: [...f.attachments, added] });
  }
  async function uploadAll(files: FileList | null, kind: "photo" | "attachment") {
    const list = Array.from(files ?? []).slice(0, kind === "photo" ? Math.max(0, photoLimit - form.photos.length) : 1);
    if (!list.length) return;
    setUploading(true); setError("");
    for (const file of list) await upload(file, kind);
    setUploading(false);
  }
  async function submit() {
    setBusy(true); setError("");
    const postDetails: ForumPostDetailsInput = { photoIds: form.photos.map((p) => p.id), location: form.location.trim() || null, feeling: form.feeling,
      mentionIds: form.mentions.map((m) => m.id), linkedItems: canLink ? form.linked.map(({ kind, id }) => ({ kind, id })) : [] };
    const payload = { categoryId: form.categoryId, title: form.title.trim(), body: form.body ?? { type: "doc", content: [{ type: "paragraph" }] }, videoUrl: form.videoUrl.trim() || null,
      coverFileId: form.cover?.id ?? null, attachmentIds: form.attachments.map((a) => a.id), commentsOff: form.commentsOff, likesOff: form.likesOff, postDetails };
    const result = await request<{ id: string }>(initial ? `/api/communities/${slug}/posts/${initial.id}` : `/api/communities/${slug}/posts`, { method: initial ? "PATCH" : "POST", body: payload });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    handleOpenChange(false); setForm(fresh());
    if (initial) router.refresh(); else router.push(`/communities/${slug}/posts/${result.data.id}`);
  }
  const hasText = Boolean(form.body?.content?.some((b) => "content" in b && b.content?.length));
  const canSubmit = !busy && !uploading && Boolean(form.title.trim()) && hasText && videoValid && Boolean(form.categoryId);
  const submitLabel = t(initial ? "save" : "publish");
  const isLinked = (kind: ForumItemKind, id: string) => form.linked.some((item) => item.kind === kind && item.id === id);
  const toggleLinked = (item: PickedItem) => setForm((f) => f.linked.some((x) => x.kind === item.kind && x.id === item.id) ? { ...f, linked: f.linked.filter((x) => !(x.kind === item.kind && x.id === item.id)) }
    : f.linked.length < itemLimit ? { ...f, linked: [...f.linked, item] } : f);
  const matches = people.filter((p) => !personQuery.trim() || p.name.toLowerCase().includes(personQuery.trim().toLowerCase())).slice(0, 50);
  const mapLink = mapsHref(form.location);

  const tools: [Exclude<Panel, null> | "photo", typeof ImageIcon, string][] = [["photo", ImageIcon, "toolPhoto"], ["location", MapPin, "toolLocation"], ["feeling", Smile, "toolFeeling"],
    ["people", UserPlus, "toolPeople"], ["attach", Paperclip, "toolAttach"]];
  const chip = "inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border bg-muted/50 pl-3 text-sm lg:min-h-9";
  const removeChip = "size-11 shrink-0 rounded-full lg:size-9";
  const shortcuts: [Start, typeof ImageIcon, string][] = [["photo", ImageIcon, "shortcutPhoto"], ["attach", Paperclip, "shortcutAttach"], ...(canLink ? [["event", CalendarDays, "shortcutEvent"] as [Start, typeof ImageIcon, string]] : [])];
  const attachOpen = panel === "attach" || panel === "pick" || panel === "video";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!onClose && (
        <Card className="gap-0 py-0 shadow-sm">
          <div className="flex items-center gap-3 p-4 pb-3">
            <Avatar className="size-10">
              <AvatarFallback aria-hidden="true">{memberInitials(author)}</AvatarFallback>
            </Avatar>
            <DialogTrigger asChild>
              <Button variant="ghost" className="bg-muted text-muted-foreground hover:bg-accent hover:text-foreground min-h-11 min-w-0 flex-1 justify-start rounded-full px-4 font-normal">
                <span className="truncate">{t("mindPrompt")}</span>
              </Button>
            </DialogTrigger>
            <Button variant="ghost" size="icon-responsive" className="text-primary rounded-full" aria-label={t("addPhoto")} onClick={() => openAt("photo")}>
              <ImageIcon aria-hidden="true" />
            </Button>
          </div>
          <div role="group" aria-label={t("shortcuts")} className={cn("grid border-t p-1", shortcuts.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
            {shortcuts.map(([start, Icon, label]) =>
              <Button key={label} variant="ghost" className="text-muted-foreground hover:text-foreground min-h-11 min-w-0 rounded-md px-2 lg:min-h-9" onClick={() => openAt(start)}>
                <Icon className="text-primary" aria-hidden="true" />
                {t(label)}
              </Button>)}
          </div>
        </Card>
      )}
      {/* The choosers live outside the window so a feed shortcut can open them in the same tap. */}
      <input ref={photoInput} type="file" multiple accept={imageTypes} className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={(e) => { void uploadAll(e.target.files, "photo"); e.target.value = ""; }} />
      <input ref={fileInput} type="file" accept={`${imageTypes},application/pdf,text/plain`} className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={(e) => { void uploadAll(e.target.files, "attachment"); e.target.value = ""; }} />
      <DialogContent showCloseButton={false} style={viewport} aria-describedby={undefined}
        className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl max-sm:top-[var(--composer-top,0px)] max-sm:left-0 max-sm:h-[var(--composer-vh,100dvh)] max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0">
        {/* Phone: close at the top left, Post at the top right. Desktop: the title with close at the right; Post stays at the bottom. */}
        <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1 sm:px-4 sm:py-2">
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="icon" className="size-11 rounded-full sm:order-last" aria-label={t("close")}><X aria-hidden="true" /></Button>
          </DialogClose>
          <DialogTitle className="min-w-0 flex-1 truncate text-base">{t(initial ? "editPost" : "newPost")}</DialogTitle>
          <Button type="button" className="min-h-11 rounded-full px-5 sm:hidden" disabled={!canSubmit} onClick={() => void submit()}>{submitLabel}</Button>
        </div>

        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
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
                  className="text-muted-foreground max-w-full gap-1 rounded-full bg-transparent px-3 text-xs shadow-none data-[size=sm]:h-11 lg:data-[size=sm]:h-7 dark:bg-transparent [&_svg:not([class*='size-'])]:size-3.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {usable.map((c) => <SelectItem key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ""}{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {(form.feeling || form.mentions.length > 0 || (form.location.trim() && panel !== "location")) &&
            <ul aria-label={t("toolbar")} className="flex flex-wrap gap-2">
              {form.feeling && <li className={chip}><Smile className="size-4 shrink-0" aria-hidden="true" /><span className="truncate">{t("feelingLine", { feeling: t(`feelings.${form.feeling}`) })}</span>
                <Button type="button" variant="ghost" size="icon" className={removeChip} aria-label={t("removeFeeling")} onClick={() => set("feeling", null)}><X aria-hidden="true" /></Button></li>}
              {form.location.trim() && panel !== "location" && <li className={chip}><MapPin className="size-4 shrink-0" aria-hidden="true" /><span className="truncate">{form.location.trim()}</span>
                <Button type="button" variant="ghost" size="icon" className={removeChip} aria-label={t("removeLocation")} onClick={() => set("location", "")}><X aria-hidden="true" /></Button></li>}
              {form.mentions.map((m) => <li key={m.id} className={chip}><UserPlus className="size-4 shrink-0" aria-hidden="true" /><span className="truncate">{m.name.trim() || t("unnamed")}</span>
                <Button type="button" variant="ghost" size="icon" className={removeChip} aria-label={t("removeMention", { name: m.name.trim() || t("unnamed") })}
                  onClick={() => set("mentions", form.mentions.filter((x) => x.id !== m.id))}><X aria-hidden="true" /></Button></li>)}
            </ul>}

          <div className="space-y-2">
            <Label htmlFor="post-title">{t("title")}</Label>
            <Input id="post-title" className="min-h-11" value={form.title} maxLength={forumLimits.title} placeholder={t("titlePlaceholder")} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="space-y-2">
            <span className="text-sm font-medium">{t("post")}</span>
            <RichTextEditor value={form.body} onChange={(doc) => set("body", doc)} label={t("post")} />
          </div>

          {form.photos.length > 0 && <section aria-label={t("photos")} className="space-y-2">
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">{form.photos.map((p, i) => <li key={p.id} className="relative overflow-hidden rounded-md ring-1 ring-foreground/10">
              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated redirect to a short-lived signed URL; not optimisable */}
              <img src={`/api/communities/${slug}/files/${p.id}`} alt={t("photoAlt", { n: i + 1, total: form.photos.length })} className="aspect-square w-full bg-muted object-cover" />
              <Button type="button" variant="secondary" size="icon" className="absolute top-1 right-1 size-11 rounded-full lg:size-8" aria-label={t("removePhoto", { n: i + 1 })}
                onClick={() => set("photos", form.photos.filter((x) => x.id !== p.id))}><X aria-hidden="true" /></Button></li>)}</ul>
            {form.photos.length >= photoLimit && <p className="text-muted-foreground text-xs">{t("photoLimit")}</p>}
          </section>}

          {form.cover && <div className="flex min-h-11 items-center gap-3 rounded-md border px-3"><ImageIcon className="size-4" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-sm">{form.cover.name}</span>
            <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("removeCover")} onClick={() => set("cover", null)}><X aria-hidden="true" /></Button></div>}

          {(panel === "video" || form.videoUrl) && <div id={panel === "video" ? "post-panel" : undefined} className="space-y-2">
            <Label htmlFor="post-video">{t("video")}</Label>
            <Input id="post-video" type="url" className="min-h-11" value={form.videoUrl} maxLength={500} placeholder={t("videoPlaceholder")} aria-invalid={!videoValid}
              onChange={(e) => set("videoUrl", e.target.value)} />
            {!videoValid && <p className="text-sm text-destructive">{t("videoInvalid")}</p>}
          </div>}

          {form.attachments.length > 0 && <ul className="space-y-2" aria-label={t("attachments")}>{form.attachments.map((a) => <li key={a.id} className="flex min-h-11 items-center gap-3 rounded-md border px-3">
            <FileText className="size-4" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
            <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("removeAttachment", { name: a.name })}
              onClick={() => set("attachments", form.attachments.filter((x) => x.id !== a.id))}><X aria-hidden="true" /></Button></li>)}</ul>}

          {form.linked.length > 0 && <ul className="space-y-2" aria-label={t("linkedItems")}>{form.linked.map((item) => <li key={`${item.kind}:${item.id}`}>
            <LinkedItemCard item={item} action={<Button type="button" variant="ghost" size="icon" className="size-11 lg:size-9" aria-label={t("removeLinked", { name: item.title })}
              onClick={() => toggleLinked(item)}><X aria-hidden="true" /></Button>} /></li>)}</ul>}

          {uploading && <p className="text-muted-foreground text-sm" role="status">{t("uploading")}</p>}

          {panel === "location" && <div id="post-panel" className="space-y-2">
            <Label htmlFor="post-location">{t("location")}</Label>
            <Input id="post-location" className="min-h-11" value={form.location} maxLength={240} autoComplete="street-address" placeholder={t("locationPlaceholder")}
              onChange={(e) => set("location", e.target.value)} />
            {mapLink && <a href={mapLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline">
              <MapPin className="size-4" aria-hidden="true" />{t("openInMaps")}</a>}
          </div>}

          {panel === "feeling" && <section id="post-panel" aria-label={t("feeling")} className="space-y-2">
            <h3 className="text-sm font-semibold">{t("feeling")}</h3>
            <ToggleGroup type="single" variant="outline" value={form.feeling ?? ""} onValueChange={(value) => { set("feeling", (value || null) as Feeling | null); if (value) setPanel(null); }}
              aria-label={t("feeling")} spacing={2} className="grid w-full grid-cols-2 sm:grid-cols-3">
              {forumFeelings.map((f) => <ToggleGroupItem key={f} value={f} className="min-h-11 justify-start px-3 capitalize lg:min-h-9">{t(`feelings.${f}`)}</ToggleGroupItem>)}
            </ToggleGroup>
          </section>}

          {panel === "people" && <section id="post-panel" aria-label={t("people")} className="space-y-2">
            <h3 className="text-sm font-semibold">{t("people")}</h3>
            <InputGroup className="h-11 lg:h-9">
              <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
              <InputGroupInput className="h-11 lg:h-9" type="search" aria-label={t("searchPeople")} placeholder={t("searchPeople")} value={personQuery} maxLength={80} onChange={(e) => setPersonQuery(e.target.value)} />
            </InputGroup>
            {form.mentions.length >= mentionLimit && <p className="text-muted-foreground text-xs">{t("mentionLimit")}</p>}
            {matches.length === 0 ? <p className="text-muted-foreground text-sm">{t("noPeople")}</p>
              : <ul className="space-y-1">{matches.map((p) => { const checked = form.mentions.some((m) => m.id === p.id), name = p.name.trim() || t("unnamed");
                return <li key={p.id}><Label htmlFor={`mention-${p.id}`} className="flex min-h-11 items-center gap-3 rounded-md px-2 font-normal hover:bg-muted">
                  <Checkbox id={`mention-${p.id}`} checked={checked} disabled={!checked && form.mentions.length >= mentionLimit}
                    onCheckedChange={(on) => set("mentions", on === true ? [...form.mentions, p] : form.mentions.filter((m) => m.id !== p.id))} />
                  <Avatar className="size-8"><AvatarFallback aria-hidden="true" className="text-xs">{memberInitials(p.name)}</AvatarFallback></Avatar>
                  <span className="min-w-0 truncate">{name}</span></Label></li>; })}</ul>}
          </section>}

          {panel === "attach" && <section id="post-panel" aria-label={t("attachTitle")} className="space-y-2">
            <h3 className="text-sm font-semibold">{t("attachTitle")}</h3>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <li><Button type="button" variant="outline" className="min-h-11 w-full justify-start" disabled={uploading || form.photos.length >= photoLimit} onClick={() => photoInput.current?.click()}>
                <ImageIcon className="text-primary" aria-hidden="true" />{t("attachKinds.photo")}</Button></li>
              <li><Button type="button" variant="outline" className="min-h-11 w-full justify-start" onClick={() => setPanel("video")}>
                <Video className="text-primary" aria-hidden="true" />{t("attachKinds.video")}</Button></li>
              <li><Button type="button" variant="outline" className="min-h-11 w-full justify-start" disabled={uploading || form.attachments.length >= forumLimits.attachments} onClick={() => fileInput.current?.click()}>
                <FileText className="text-primary" aria-hidden="true" />{t("attachKinds.file")}</Button></li>
              {canLink && forumItemKinds.map((kind) => { const Icon = itemKindIcon[kind]; return <li key={kind}>
                <Button type="button" variant="outline" className="min-h-11 w-full justify-start" onClick={() => pick(kind)}><Icon className="text-primary" aria-hidden="true" />{t(`attachKinds.${kind}`)}</Button></li>; })}
            </ul>
          </section>}

          {panel === "pick" && canLink && <div id="post-panel" className="space-y-3">
            <ItemPicker key={pickKind} slug={slug} kind={pickKind} onKind={setPickKind} isSelected={isLinked} onToggle={toggleLinked} full={form.linked.length >= itemLimit} />
            <Button type="button" variant="secondary" className="min-h-11 w-full" onClick={() => setPanel(null)}>{t("pickerDone")}</Button>
          </div>}

          <Label htmlFor="post-comments-off" className="flex min-h-11 items-center justify-between gap-3 font-normal">{t("commentsOff")}
            <Switch id="post-comments-off" checked={form.commentsOff} onCheckedChange={(v) => set("commentsOff", v)} /></Label>
          <Label htmlFor="post-likes-off" className="flex min-h-11 items-center justify-between gap-3 font-normal">{t("likesOff")}
            <Switch id="post-likes-off" checked={form.likesOff} onCheckedChange={(v) => set("likesOff", v)} /></Label>
        </div>

        {/* Action Icons: pinned at the bottom (above the keyboard on phones); Post on the right from 640px. */}
        <div className="flex shrink-0 items-center gap-1 border-t bg-popover px-2 py-1 sm:px-4 sm:py-3">
          <div role="group" aria-label={t("toolbar")} className="flex min-w-0 flex-1 items-center gap-0.5">
            {tools.map(([tool, Icon, label]) => tool === "photo"
              ? <Button key={tool} type="button" variant="ghost" size="icon" className="text-primary size-11 rounded-full" aria-label={t(label)} disabled={uploading || form.photos.length >= photoLimit}
                onClick={() => photoInput.current?.click()}><Icon aria-hidden="true" /></Button>
              : <Button key={tool} type="button" variant="ghost" size="icon" aria-label={t(label)} aria-expanded={tool === "attach" ? attachOpen : panel === tool}
                className={cn("text-primary size-11 rounded-full", (tool === "attach" ? attachOpen : panel === tool) && "bg-accent")} onClick={() => toggle(tool)}><Icon aria-hidden="true" /></Button>)}
          </div>
          <Button type="button" className="hidden min-h-11 sm:inline-flex lg:min-h-9" disabled={!canSubmit} onClick={() => void submit()}>{submitLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
