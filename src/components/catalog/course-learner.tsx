/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/courses/course-detail/page.tsx, apps/courses/components/study-progress.tsx and apps/courses/components/course-modules.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, BookOpen, Check, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { EmptyState } from "@/components/empty-state";
import { RichTextView } from "@/components/rich-text/rich-text-view";
import { LessonVideoPlayer } from "@/components/catalog/lesson-video";
import { LessonComplete, LessonNote } from "@/components/catalog/lesson-progress";
import { percentComplete } from "@/lib/course-progress";
import { labelOr, type CourseLabels } from "@/lib/course-structure";
import { validVideo, type LessonVideo } from "@/lib/lesson-video";
import { cn } from "@/lib/utils";

export type LearnerLesson = { id: string; title: string; body: unknown; sectionId?: string; video?: LessonVideo | null };
/** The published structure: only the levels and sections that hold a published lesson arrive, in course order. */
export type LearnerStructure = { labels?: Partial<CourseLabels>; levels?: { id: string; title: string }[]; sections?: { id: string; levelId: string | null; title: string }[] };

/** The learner's stored progress (0131): the share of published lessons marked complete, and where they are now. */
function PlaceCard({ index, total, label, done }: { index: number; total: number; label: string; done: number }) {
  const t = useTranslations("CatalogPublic");
  const place = t("place", { label, current: index + 1, total }), percent = percentComplete(done, total);
  return <Card className="gap-4">
    <CardHeader><CardTitle>{t("yourProgress")}</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <Progress value={percent} aria-label={t("percentComplete", { percent })} />
      <p className="text-sm font-medium tabular-nums" data-progress-percent>{t("percentComplete", { percent })}</p>
      <p className="text-sm text-muted-foreground tabular-nums">{place}</p>
    </CardContent>
  </Card>;
}

type Group = { key: string; heading: string | null; lessons: { lesson: LearnerLesson; index: number }[] };
type Band = { key: string; heading: string | null; groups: Group[] };
/**
 * Lessons grouped by level and section for the side list. Headings use the course's own titles, or its label and number ("Week 2"). A course that
 * is one untitled section (and every course before 0130) shows the plain list with no headings.
 */
function grouped(lessons: LearnerLesson[], structure: LearnerStructure, names: { level: string; section: string }): Band[] {
  const sections = structure.sections ?? [], levels = structure.levels ?? [];
  const headed = levels.length > 0 || sections.length > 1 || sections.some((row) => row.title.trim() !== "");
  const groupOf = (id: string, index: number, title: string): Group => ({ key: id, heading: headed ? title.trim() || `${names.section} ${index + 1}` : null,
    lessons: lessons.flatMap((lesson, at) => (lesson.sectionId === id ? [{ lesson, index: at }] : [])) });
  const known = new Set(sections.map((row) => row.id));
  const loose = lessons.flatMap((lesson, index) => (!lesson.sectionId || !known.has(lesson.sectionId) ? [{ lesson, index }] : []));
  const bands: Band[] = levels.length
    ? levels.map((level, at) => ({ key: level.id, heading: level.title.trim() || `${names.level} ${at + 1}`,
      groups: sections.flatMap((row, index) => (row.levelId === level.id ? [groupOf(row.id, index, row.title)] : [])) }))
    : [{ key: "course", heading: null, groups: sections.map((row, index) => groupOf(row.id, index, row.title)) }];
  if (loose.length) bands.push({ key: "loose", heading: null, groups: [{ key: "loose", heading: null, lessons: loose }] });
  return bands.map((band) => ({ ...band, groups: band.groups.filter((group) => group.lessons.length) })).filter((band) => band.groups.length);
}

function LessonList({ slug, lessons, current, structure, names, done }: { slug: string; lessons: LearnerLesson[]; current: string; structure: LearnerStructure; names: { level: string; section: string }; done: ReadonlySet<string> }) {
  const t = useTranslations("CatalogPublic");
  const item = (lesson: LearnerLesson, index: number) => {
      const here = lesson.id === current;
      return <li key={lesson.id}>
        <Link href={`/courses/${slug}/learn?lesson=${lesson.id}`} aria-current={here ? "step" : undefined} data-lesson-link
          className={cn("flex min-h-11 items-center gap-3 rounded-lg border p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50", here && "border-primary bg-selected")}>
          <span aria-hidden="true" className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums", here ? "bg-primary text-primary-foreground" : done.has(lesson.id) ? "bg-success-tint text-success" : "bg-muted text-muted-foreground")}>
            {done.has(lesson.id) ? <Check className="size-4" /> : index + 1}</span>
          <span className="min-w-0 flex-1 break-words font-medium">{lesson.title}</span>
          {done.has(lesson.id) && <span className="sr-only">{t("completeMark")}</span>}
        </Link>
      </li>;
  };
  const list = (rows: { lesson: LearnerLesson; index: number }[]) => <ol className="space-y-2">{rows.map(({ lesson, index }) => item(lesson, index))}</ol>;
  return <nav aria-label={t("lessons")} className="space-y-5">
    {grouped(lessons, structure, names).map((band) => <div key={band.key} data-learner-level={band.heading !== null ? "" : undefined} className="space-y-3">
      {band.heading !== null && <h3 className="text-sm font-semibold break-words">{band.heading}</h3>}
      {band.groups.map((group) => group.heading === null ? <div key={group.key}>{list(group.lessons)}</div>
        : <section key={group.key} aria-label={group.heading} data-learner-section className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground break-words">{group.heading}</h4>{list(group.lessons)}</section>)}
    </div>)}
  </nav>;
}

/**
 * The enrolled learner's course view, in the arrangement of the kit's course detail: the lesson on the left, and on the right the learner's place and the
 * ordered lessons (a sheet below 1024px). Previous and next move one lesson. Only published lessons arrive from the server; nothing here is stored.
 */
export function CourseLearner({ slug, title, lessons, currentId, structure = {}, completed = [], notes = [] }: {
  slug: string; title: string; lessons: LearnerLesson[]; currentId: string; structure?: LearnerStructure; completed?: string[]; notes?: { lessonId: string; body: string }[];
}) {
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set(completed));
  const doneCount = lessons.filter((lesson) => done.has(lesson.id)).length;
  const mark = (id: string, on: boolean) => setDone((current) => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });
  const t = useTranslations("CatalogPublic"), s = useTranslations("Catalog.structure");
  const names = { level: labelOr(structure.labels?.level, s("defaults.level")), section: labelOr(structure.labels?.section, s("defaults.section")) };
  const lessonWord = labelOr(structure.labels?.lesson, s("defaults.lesson"));
  const index = Math.max(0, lessons.findIndex((lesson) => lesson.id === currentId)), lesson = lessons[index];
  if (!lesson) return <EmptyState icon={BookOpen} title={t("noLessons")} />;
  const previous = lessons[index - 1], next = lessons[index + 1], href = (id: string) => `/courses/${slug}/learn?lesson=${id}`;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><p className="text-sm text-muted-foreground"><Link href={`/courses/${slug}`} className="underline-offset-4 hover:underline">{t("backToCourse")}</Link></p>
        <h1 className="text-[28px] font-semibold tracking-tight break-words">{title}</h1></div>
      <Sheet><SheetTrigger asChild><Button variant="outline" className="min-h-11 lg:hidden"><ListOrdered aria-hidden="true" />{t("lessons")}</Button></SheetTrigger>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md"><SheetHeader><SheetTitle>{t("lessons")}</SheetTitle></SheetHeader>
          <div className="p-4"><LessonList slug={slug} lessons={lessons} current={lesson.id} structure={structure} names={names} done={done} /></div></SheetContent></Sheet>
    </div>
    <div className="grid gap-6 lg:grid-cols-3">
      <article aria-labelledby="lesson-title" className="min-w-0 space-y-6 lg:col-span-2">
        <div className="lg:hidden"><PlaceCard index={index} total={lessons.length} label={lessonWord} done={doneCount} /></div>
        <Card><CardHeader><CardTitle><h2 id="lesson-title" className="text-xl font-semibold break-words">{lesson.title}</h2></CardTitle></CardHeader>
          <CardContent className="space-y-6">{validVideo(lesson.video) && <LessonVideoPlayer key={lesson.id} video={lesson.video} title={lesson.title} />}<RichTextView doc={lesson.body} /></CardContent></Card>
        <LessonComplete key={`complete-${lesson.id}`} slug={slug} lesson={lesson.id} completed={done.has(lesson.id)} onChange={(on) => mark(lesson.id, on)} />
        <LessonNote key={`note-${lesson.id}`} slug={slug} lesson={lesson.id} initial={notes.find((note) => note.lessonId === lesson.id)?.body ?? ""} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          {previous ? <Button asChild variant="outline" className="min-h-11"><Link href={href(previous.id)}><ArrowLeft aria-hidden="true" />{t("previous")}</Link></Button> : <span />}
          {next ? <Button asChild className="min-h-11"><Link href={href(next.id)}>{t("next")}<ArrowRight aria-hidden="true" /></Link></Button> : <span />}
        </div>
      </article>
      <aside className="hidden min-w-0 space-y-6 lg:block"><PlaceCard index={index} total={lessons.length} label={lessonWord} done={doneCount} />
        <LessonList slug={slug} lessons={lessons} current={lesson.id} structure={structure} names={names} done={done} /></aside>
    </div>
  </div>;
}
