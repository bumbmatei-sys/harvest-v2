/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/courses/components/course-modules.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, BookOpen, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { maxLessons, move, newLesson, type LessonForm } from "@/lib/catalog";
import { cn } from "@/lib/utils";

/**
 * The ordered lessons of a course: add, reorder (move up and down, which works by keyboard and on phones), remove, a title, a published switch and the
 * shared rich-text editor for the body. One body editor is mounted at a time (the open lesson), so fifty lessons stay light. Order is the list order;
 * the server stores it. Links to videos and documents go in the body as links (the server has no lesson video or file field).
 */
export function LessonListEditor({ lessons, onChange, disabled, problems }: { lessons: LessonForm[]; onChange: (next: LessonForm[]) => void; disabled: boolean; problems: boolean }) {
  const t = useTranslations("Catalog.lessons");
  const [open, setOpen] = useState<string | null>(lessons[0]?.key ?? null);
  // The editor's change callback may outlive a render, so edits are applied to the latest list, not the one the callback was created with.
  const latest = useRef(lessons);
  useEffect(() => { latest.current = lessons; }, [lessons]);
  const patch = (key: string, change: Partial<LessonForm>) => onChange(latest.current.map((lesson) => (lesson.key === key ? { ...lesson, ...change } : lesson)));
  function add() {
    const lesson = newLesson();
    onChange([...lessons, lesson]); setOpen(lesson.key);
  }
  if (lessons.length === 0) return <EmptyState icon={BookOpen} title={t("empty")} size="compact" solid
    action={!disabled ? <Button type="button" className="min-h-11" onClick={add}><Plus aria-hidden="true" />{t("add")}</Button> : undefined} />;
  return <div className="space-y-3">
    <ol aria-label={t("label")} className="space-y-3">
      {lessons.map((lesson, index) => {
        const expanded = open === lesson.key, titleId = `lesson-title-${lesson.key}`;
        return <li key={lesson.key}><Card data-lesson className="gap-0 py-0 shadow-none">
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-start gap-3">
              <span aria-hidden="true" className="mt-2 flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted text-xs font-medium tabular-nums">{index + 1}</span>
              <Field className="min-w-48 flex-1">
                <FieldLabel htmlFor={titleId} className="sr-only">{t("titleLabel", { number: index + 1 })}</FieldLabel>
                <Input id={titleId} className="min-h-11" value={lesson.title} maxLength={120} disabled={disabled} placeholder={t("titlePlaceholder")}
                  aria-invalid={problems && !lesson.title.trim() ? true : undefined} onChange={(event) => patch(lesson.key, { title: event.target.value })} />
              </Field>
              <div className="flex items-center gap-1">
                <Button type="button" variant="outline" size="icon" className="size-11" disabled={disabled || index === 0} aria-label={t("moveUp", { number: index + 1 })} onClick={() => onChange(move(lessons, index, index - 1))}><ArrowUp aria-hidden="true" /></Button>
                <Button type="button" variant="outline" size="icon" className="size-11" disabled={disabled || index === lessons.length - 1} aria-label={t("moveDown", { number: index + 1 })} onClick={() => onChange(move(lessons, index, index + 1))}><ArrowDown aria-hidden="true" /></Button>
                <Button type="button" variant="outline" size="icon" className="size-11" disabled={disabled} aria-label={t("remove", { number: index + 1 })}
                  onClick={() => { onChange(lessons.filter((item) => item.key !== lesson.key)); if (expanded) setOpen(null); }}><Trash2 aria-hidden="true" /></Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label htmlFor={`lesson-published-${lesson.key}`} className="flex min-h-11 items-center gap-3 font-normal">
                <Switch id={`lesson-published-${lesson.key}`} checked={lesson.published} disabled={disabled} onCheckedChange={(published) => patch(lesson.key, { published })} />
                {t("published")}
              </Label>
              <div className="flex items-center gap-2">
                {!lesson.published && <StatusBadge tone="neutral" label={t("draft")} />}
                <Button type="button" variant="ghost" className="min-h-11" aria-expanded={expanded} aria-controls={`lesson-body-${lesson.key}`} onClick={() => setOpen(expanded ? null : lesson.key)}>
                  {t(expanded ? "hideBody" : "editBody")}<ChevronDown className={cn("transition-transform motion-reduce:transition-none", expanded && "rotate-180")} aria-hidden="true" />
                </Button>
              </div>
            </div>
            {expanded && <div id={`lesson-body-${lesson.key}`}><RichTextEditor value={lesson.body} label={t("bodyLabel", { number: index + 1 })} disabled={disabled} onChange={(body) => patch(lesson.key, { body })} /></div>}
          </CardContent>
        </Card></li>;
      })}
    </ol>
    {!disabled && <Button type="button" variant="outline" className="min-h-11" disabled={lessons.length >= maxLessons} onClick={add}><Plus aria-hidden="true" />{t("add")}</Button>}
  </div>;
}
