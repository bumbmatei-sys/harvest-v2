/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/courses/course-detail/page.tsx, apps/courses/components/study-progress.tsx and apps/courses/components/course-modules.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, BookOpen, Check, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { EmptyState } from "@/components/empty-state";
import { RichTextView } from "@/components/rich-text/rich-text-view";
import { cn } from "@/lib/utils";

export type LearnerLesson = { id: string; title: string; body: unknown };

/** The learner's place in the course. It is a position, not a completion mark: the server stores no progress yet. */
function PlaceCard({ index, total }: { index: number; total: number }) {
  const t = useTranslations("CatalogPublic");
  return <Card className="gap-4">
    <CardHeader><CardTitle>{t("yourPlace")}</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <Progress value={Math.round(((index + 1) / total) * 100)} aria-label={t("lessonOf", { current: index + 1, total })} />
      <p className="text-sm text-muted-foreground tabular-nums">{t("lessonOf", { current: index + 1, total })}</p>
    </CardContent>
  </Card>;
}

function LessonList({ slug, lessons, current }: { slug: string; lessons: LearnerLesson[]; current: string }) {
  const t = useTranslations("CatalogPublic");
  const at = lessons.findIndex((lesson) => lesson.id === current);
  return <nav aria-label={t("lessons")}><ol className="space-y-2">
    {lessons.map((lesson, index) => {
      const here = lesson.id === current;
      return <li key={lesson.id}>
        <Link href={`/courses/${slug}/learn?lesson=${lesson.id}`} aria-current={here ? "step" : undefined} data-lesson-link
          className={cn("flex min-h-11 items-center gap-3 rounded-lg border p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50", here && "border-primary bg-selected")}>
          <span aria-hidden="true" className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums", here ? "bg-primary text-primary-foreground" : index < at ? "bg-success-tint text-success" : "bg-muted text-muted-foreground")}>
            {index < at ? <Check className="size-4" /> : index + 1}</span>
          <span className="min-w-0 flex-1 break-words font-medium">{lesson.title}</span>
        </Link>
      </li>;
    })}
  </ol></nav>;
}

/**
 * The enrolled learner's course view, in the arrangement of the kit's course detail: the lesson on the left, and on the right the learner's place and the
 * ordered lessons (a sheet below 1024px). Previous and next move one lesson. Only published lessons arrive from the server; nothing here is stored.
 */
export function CourseLearner({ slug, title, lessons, currentId }: { slug: string; title: string; lessons: LearnerLesson[]; currentId: string }) {
  const t = useTranslations("CatalogPublic");
  const index = Math.max(0, lessons.findIndex((lesson) => lesson.id === currentId)), lesson = lessons[index];
  if (!lesson) return <EmptyState icon={BookOpen} title={t("noLessons")} />;
  const previous = lessons[index - 1], next = lessons[index + 1], href = (id: string) => `/courses/${slug}/learn?lesson=${id}`;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><p className="text-sm text-muted-foreground"><Link href={`/courses/${slug}`} className="underline-offset-4 hover:underline">{t("backToCourse")}</Link></p>
        <h1 className="text-[28px] font-semibold tracking-tight break-words">{title}</h1></div>
      <Sheet><SheetTrigger asChild><Button variant="outline" className="min-h-11 lg:hidden"><ListOrdered aria-hidden="true" />{t("lessons")}</Button></SheetTrigger>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md"><SheetHeader><SheetTitle>{t("lessons")}</SheetTitle></SheetHeader>
          <div className="p-4"><LessonList slug={slug} lessons={lessons} current={lesson.id} /></div></SheetContent></Sheet>
    </div>
    <div className="grid gap-6 lg:grid-cols-3">
      <article aria-labelledby="lesson-title" className="min-w-0 space-y-6 lg:col-span-2">
        <div className="lg:hidden"><PlaceCard index={index} total={lessons.length} /></div>
        <Card><CardHeader><CardTitle><h2 id="lesson-title" className="text-xl font-semibold break-words">{lesson.title}</h2></CardTitle></CardHeader>
          <CardContent><RichTextView doc={lesson.body} /></CardContent></Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {previous ? <Button asChild variant="outline" className="min-h-11"><Link href={href(previous.id)}><ArrowLeft aria-hidden="true" />{t("previous")}</Link></Button> : <span />}
          {next ? <Button asChild className="min-h-11"><Link href={href(next.id)}>{t("next")}<ArrowRight aria-hidden="true" /></Link></Button> : <span />}
        </div>
      </article>
      <aside className="hidden min-w-0 space-y-6 lg:block"><PlaceCard index={index} total={lessons.length} /><LessonList slug={slug} lessons={lessons} current={lesson.id} /></aside>
    </div>
  </div>;
}
