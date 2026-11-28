import type { RichDoc } from "@/lib/rich-text";
import { suggestSlug } from "@/lib/community-editor";
import { defineStatusTones } from "@/lib/status-tone";
import { parseVideoLink, videoLink, type LessonVideo } from "@/lib/lesson-video";
import { labelKinds, ordered, validLabel, type CourseLabels, type LevelForm, type SectionForm, type Structure } from "@/lib/course-structure";

// Pure rules for the free catalogue screens (courses and downloadable products). The server owns every decision; this file only shapes forms, steps and
// the publish checklist so the screens and their tests share one source. Free only: nothing here has a price.
export const catalogKinds = ["course", "download"] as const;
export type CatalogKind = (typeof catalogKinds)[number];
export const catalogStates = ["draft", "published", "archived"] as const;
export type CatalogState = (typeof catalogStates)[number];
export const catalogVisibilities = ["hidden", "unlisted", "listed"] as const;
export type CatalogVisibility = (typeof catalogVisibilities)[number];

/** Legacy editor spellings and the four publication states exposed to new callers. */
export const catalogPublicationVisibilities = ["public", "community", "unlisted", "draft"] as const;
export type CatalogPublicationVisibility = (typeof catalogPublicationVisibilities)[number];
export const legacyCatalogVisibility = (value: CatalogVisibility | "public" | "community"): CatalogVisibility =>
  value === "public" ? "listed" : value === "community" ? "hidden" : value;

export const stateTone = defineStatusTones({ draft: "neutral", published: "success", archived: "pending" });

/** Editorial metadata, as the list and the item read return it. */
export type CatalogRow = { id: string; kind: CatalogKind; slug: string; title: string; summary: string; state: CatalogState; visibility: CatalogVisibility; publicationVisibility?: CatalogPublicationVisibility; coverFileId?: string | null; priceLabel?: string; version: number; updatedAt: string };
export type CatalogLesson = { id: string; title: string; body: RichDoc; published: boolean; sectionId?: string; video?: LessonVideo | null; attachmentFileIds?: string[] };
/** The item read: owners and admins also get lessons, structure, labels, file ids and the communities that show it; members and viewers get the metadata only. */
export type CatalogItem = CatalogRow & { lessons?: CatalogLesson[]; levels?: { id: string; title: string }[]; sections?: { id: string; levelId: string | null; title: string }[];
  labels?: CourseLabels; fileIds?: string[]; communityIds?: string[] };
/** A ministry file as the Files API returns it. */
export type CatalogFile = { id: string; name: string; mime: string; size: number; status: "pending" | "uploaded" | "quarantined" | "ready"; visibility: "private" | "public" };

export const addressPattern = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
export const maxLessons = 50, maxFiles = 20;
export const publicPath = (kind: CatalogKind, slug: string) => `/${kind === "course" ? "courses" : "products"}/${slug}`;

export const emptyBody = (): RichDoc => ({ type: "doc", content: [{ type: "paragraph" }] });
let counter = 0;
const key = () => `lesson-${Date.now().toString(36)}-${counter++}`;

/** A lesson in the editor. `key` is stable across reorders; `id` exists once the server has stored the lesson. `section` is its section's key. */
export type LessonForm = { key: string; id?: string; title: string; published: boolean; body: RichDoc; section: string; videoUrl: string };
/** The course's own labels in the form: empty is the default label. */
export type LabelsForm = Record<keyof CourseLabels, string>;
export type CatalogForm = { title: string; slug: string; summary: string; visibility: CatalogVisibility; lessons: LessonForm[]; levels: LevelForm[]; sections: SectionForm[];
  labels: LabelsForm; fileIds: string[] };
export type CourseStructure = Structure<LessonForm>;

export const newLesson = (): LessonForm => ({ key: key(), title: "", published: false, body: emptyBody(), section: "", videoUrl: "" });
const noLabels = (): LabelsForm => ({ level: "", section: "", lesson: "" });
export function formFromItem(item: Pick<CatalogItem, "title" | "slug" | "summary" | "visibility" | "lessons" | "fileIds" | "levels" | "sections" | "labels">): CatalogForm {
  const sections: SectionForm[] = (item.sections ?? []).map((row) => ({ key: row.id, id: row.id, title: row.title, level: row.levelId }));
  const known = new Set(sections.map((row) => row.key)), loose = "section-loose";
  // A lesson with no known section (a read from before 0130) goes into one new untitled section, so a save keeps it.
  if ((item.lessons ?? []).some((lesson) => !lesson.sectionId || !known.has(lesson.sectionId)))
    sections.push({ key: loose, title: "", level: item.levels?.length ? item.levels[item.levels.length - 1].id : null });
  const structure = ordered({ levels: (item.levels ?? []).map((row) => ({ key: row.id, id: row.id, title: row.title })), sections,
    lessons: (item.lessons ?? []).map((lesson) => ({ key: lesson.id, id: lesson.id, title: lesson.title, published: lesson.published, body: lesson.body,
      section: lesson.sectionId && known.has(lesson.sectionId) ? lesson.sectionId : loose, videoUrl: lesson.video ? videoLink(lesson.video) : "" })) });
  const labels = item.labels;
  return { title: item.title, slug: item.slug, summary: item.summary, visibility: item.visibility, ...structure,
    labels: { level: labels?.level ?? "", section: labels?.section ?? "", lesson: labels?.lesson ?? "" }, fileIds: item.fileIds ?? [] };
}
export const blankForm = (): CatalogForm => ({ title: "", slug: "", summary: "", visibility: "hidden", lessons: [], levels: [], sections: [], labels: noLabels(), fileIds: [] });

/**
 * The body the server stores for a save. Titles are trimmed; empty lesson titles and bad video links are caught by `problems`. A course is sent
 * nested: levels holding sections when it has levels, otherwise sections, each with its lessons in order.
 */
export function draftPayload(kind: CatalogKind, form: CatalogForm) {
  const base = { title: form.title.trim(), slug: form.slug, summary: form.summary.trim(), visibility: form.visibility };
  if (kind !== "course") return { kind, ...base, fileIds: form.fileIds };
  const id = (row: { id?: string }) => (row.id ? { id: row.id } : {});
  const lessons = (section: string) => form.lessons.filter((lesson) => lesson.section === section).map((lesson) => ({ ...id(lesson), title: lesson.title.trim(),
    published: lesson.published, body: lesson.body, videoUrl: lesson.videoUrl.trim() || null }));
  const sections = (level: string | null) => form.sections.filter((row) => !form.levels.length || row.level === level)
    .map((row) => ({ ...id(row), title: row.title.trim(), lessons: lessons(row.key) }));
  const labels = Object.fromEntries(labelKinds.map((kind) => [kind, form.labels[kind].trim() || null]));
  return form.levels.length
    ? { kind, ...base, labels, levels: form.levels.map((row) => ({ ...id(row), title: row.title.trim(), sections: sections(row.key) })) }
    : { kind, ...base, labels, sections: sections(null) };
}

export type FormProblem = "title" | "address" | "lessonTitle" | "videoLink" | "label";
/** What stops a save, before the request. The server repeats these checks. */
export function problems(kind: CatalogKind, form: CatalogForm): FormProblem[] {
  const found: FormProblem[] = [];
  if (!form.title.trim()) found.push("title");
  if (!addressPattern.test(form.slug)) found.push("address");
  if (kind === "course" && form.lessons.some((lesson) => !lesson.title.trim())) found.push("lessonTitle");
  if (kind === "course" && form.lessons.some((lesson) => lesson.videoUrl.trim() && !parseVideoLink(lesson.videoUrl))) found.push("videoLink");
  if (kind === "course" && labelKinds.some((kind) => !validLabel(form.labels[kind]))) found.push("label");
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

export type EditorStepId = "details" | "content" | "access" | "sales" | "publish";
export const editorSteps: readonly EditorStepId[] = ["details", "content", "access", "sales", "publish"];
/** The content step is lessons for a course and files for a download. */
export const contentStep = (kind: CatalogKind) => (kind === "course" ? "lessons" : "files");

export type CheckId = "title" | "address" | "lessons" | "files";
export type Check = { id: CheckId; done: boolean };
/**
 * The publish checklist, mirroring the server: a published item needs a title and address and either one published lesson
 * or ready private files. `ready` is the number of the selected files that are ready; every selected file must be.
 */
export function publishChecklist(kind: CatalogKind, form: CatalogForm, files: readonly CatalogFile[]): Check[] {
  const byId = new Map(files.map((file) => [file.id, file]));
  const ready = form.fileIds.length > 0 && form.fileIds.every((id) => { const file = byId.get(id); return file?.status === "ready" && file.visibility === "private"; });
  return [
    { id: "title", done: form.title.trim().length > 0 },
    { id: "address", done: addressPattern.test(form.slug) },
    kind === "course" ? { id: "lessons", done: form.lessons.some((lesson) => lesson.published) } : { id: "files", done: ready },
  ];
}
/** Any visibility can be published (founder, 26 Nov): a hidden item is then seen only through the community shelves that show it. */
export const stepOfCheck = (id: CheckId): EditorStepId => (id === "title" || id === "address" ? "details" : "content");

/** A file size as a number and an Intl unit, for `format.number(value, { style: "unit", unit })`. */
export function fileSize(size: number): { value: number; unit: "byte" | "kilobyte" | "megabyte" } {
  if (size < 1024) return { value: size, unit: "byte" };
  if (size < 1024 * 1024) return { value: Math.round(size / 1024), unit: "kilobyte" };
  return { value: Math.round((size / (1024 * 1024)) * 10) / 10, unit: "megabyte" };
}
