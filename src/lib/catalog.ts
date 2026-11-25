import type { RichDoc } from "@/lib/rich-text";
import { suggestSlug } from "@/lib/community-editor";
import { defineStatusTones } from "@/lib/status-tone";

// Pure rules for the free catalogue screens (courses and downloadable products). The server owns every decision; this file only shapes forms, steps and
// the publish checklist so the screens and their tests share one source. Free only: nothing here has a price.
export const catalogKinds = ["course", "download"] as const;
export type CatalogKind = (typeof catalogKinds)[number];
export const catalogStates = ["draft", "published", "archived"] as const;
export type CatalogState = (typeof catalogStates)[number];
export const catalogVisibilities = ["hidden", "unlisted", "listed"] as const;
export type CatalogVisibility = (typeof catalogVisibilities)[number];

export const stateTone = defineStatusTones({ draft: "neutral", published: "success", archived: "pending" });

/** Editorial metadata, as the list and the item read return it. */
export type CatalogRow = { id: string; kind: CatalogKind; slug: string; title: string; summary: string; state: CatalogState; visibility: CatalogVisibility; version: number; updatedAt: string };
export type CatalogLesson = { id: string; title: string; body: RichDoc; published: boolean };
/** The item read: owners and admins also get lessons, file ids and the communities that show it; members and viewers get the metadata only. */
export type CatalogItem = CatalogRow & { lessons?: CatalogLesson[]; fileIds?: string[]; communityIds?: string[] };
/** A ministry file as the Files API returns it. */
export type CatalogFile = { id: string; name: string; mime: string; size: number; status: "pending" | "uploaded" | "quarantined" | "ready"; visibility: "private" | "public" };

export const addressPattern = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
export const maxLessons = 50, maxFiles = 20;
export const publicPath = (kind: CatalogKind, slug: string) => `/${kind === "course" ? "courses" : "products"}/${slug}`;

export const emptyBody = (): RichDoc => ({ type: "doc", content: [{ type: "paragraph" }] });
let counter = 0;
const key = () => `lesson-${Date.now().toString(36)}-${counter++}`;

/** A lesson in the editor. `key` is stable across reorders; `id` exists once the server has stored the lesson. */
export type LessonForm = { key: string; id?: string; title: string; published: boolean; body: RichDoc };
export type CatalogForm = { title: string; slug: string; summary: string; visibility: CatalogVisibility; lessons: LessonForm[]; fileIds: string[] };

export const newLesson = (): LessonForm => ({ key: key(), title: "", published: false, body: emptyBody() });
export function formFromItem(item: Pick<CatalogItem, "title" | "slug" | "summary" | "visibility" | "lessons" | "fileIds">): CatalogForm {
  return { title: item.title, slug: item.slug, summary: item.summary, visibility: item.visibility,
    lessons: (item.lessons ?? []).map((lesson) => ({ key: lesson.id, id: lesson.id, title: lesson.title, published: lesson.published, body: lesson.body })), fileIds: item.fileIds ?? [] };
}
export const blankForm = (): CatalogForm => ({ title: "", slug: "", summary: "", visibility: "hidden", lessons: [], fileIds: [] });

/** The body the server stores for a save. Titles are trimmed; empty lesson titles are caught by `problems`. */
export function draftPayload(kind: CatalogKind, form: CatalogForm) {
  const base = { title: form.title.trim(), slug: form.slug, summary: form.summary.trim(), visibility: form.visibility };
  return kind === "course"
    ? { kind, ...base, lessons: form.lessons.map((lesson) => ({ ...(lesson.id ? { id: lesson.id } : {}), title: lesson.title.trim(), published: lesson.published, body: lesson.body })) }
    : { kind, ...base, fileIds: form.fileIds };
}

export type FormProblem = "title" | "address" | "lessonTitle";
/** What stops a save, before the request. The server repeats these checks. */
export function problems(kind: CatalogKind, form: CatalogForm): FormProblem[] {
  const found: FormProblem[] = [];
  if (!form.title.trim()) found.push("title");
  if (!addressPattern.test(form.slug)) found.push("address");
  if (kind === "course" && form.lessons.some((lesson) => !lesson.title.trim())) found.push("lessonTitle");
  return found;
}

export const sameForm = (a: CatalogForm, b: CatalogForm) => JSON.stringify(a) === JSON.stringify(b);
export const nextAddress = (current: string, title: string, follows: boolean) => follows ? suggestSlug(title).slice(0, 58) : current;
export const addressFollowsTitle = (item: { slug: string; title: string; state: CatalogState }) => item.state === "draft" && item.slug === suggestSlug(item.title).slice(0, 58);

export function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export type EditorStepId = "details" | "content" | "access" | "publish";
export const editorSteps: readonly EditorStepId[] = ["details", "content", "access", "publish"];
/** The content step is lessons for a course and files for a download. */
export const contentStep = (kind: CatalogKind) => (kind === "course" ? "lessons" : "files");

export type CheckId = "title" | "address" | "visibility" | "lessons" | "files";
export type Check = { id: CheckId; done: boolean };
/**
 * The publish checklist, mirroring the server: a published item needs a title and address, a visibility other than hidden, and either one published lesson
 * or ready private files. `ready` is the number of the selected files that are ready; every selected file must be.
 */
export function publishChecklist(kind: CatalogKind, form: CatalogForm, files: readonly CatalogFile[]): Check[] {
  const byId = new Map(files.map((file) => [file.id, file]));
  const ready = form.fileIds.length > 0 && form.fileIds.every((id) => { const file = byId.get(id); return file?.status === "ready" && file.visibility === "private"; });
  return [
    { id: "title", done: form.title.trim().length > 0 },
    { id: "address", done: addressPattern.test(form.slug) },
    { id: "visibility", done: form.visibility !== "hidden" },
    kind === "course" ? { id: "lessons", done: form.lessons.some((lesson) => lesson.published) } : { id: "files", done: ready },
  ];
}
export const stepOfCheck = (id: CheckId): EditorStepId => (id === "title" || id === "address" ? "details" : id === "visibility" ? "access" : "content");

/** A file size as a number and an Intl unit, for `format.number(value, { style: "unit", unit })`. */
export function fileSize(size: number): { value: number; unit: "byte" | "kilobyte" | "megabyte" } {
  if (size < 1024) return { value: size, unit: "byte" };
  if (size < 1024 * 1024) return { value: Math.round(size / 1024), unit: "kilobyte" };
  return { value: Math.round((size / (1024 * 1024)) * 10) / 10, unit: "megabyte" };
}
