/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/courses/components/course-modules.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, BookOpen, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/empty-state";
import { FormSection } from "@/components/form-section";
import { StatusBadge } from "@/components/status-badge";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { newLesson, type CatalogForm, type CourseStructure, type LabelsForm, type LessonForm } from "@/lib/catalog";
import {
  addLesson, addLevel, addSection, canMoveLesson, canMoveSection, canRemoveSection, labelKinds, labelLimit, maxCourseLessons, maxLevels, maxSections,
  moveLesson, moveLevel, moveSection, partKey, removeLevel, removeSection, showsStructure, validLabel, type LabelKind,
} from "@/lib/course-structure";
import { parseVideoLink } from "@/lib/lesson-video";
import { cn } from "@/lib/utils";

type Value = Pick<CatalogForm, "levels" | "sections" | "lessons" | "labels">;
type Names = Record<LabelKind, { title: string; word: string }>;

/** The course's names for its parts: `title` for headings and placeholders ("Week"), `word` inside sentences ("Add week"). */
function useNames(labels: LabelsForm): Names {
  const t = useTranslations("Catalog.structure");
  return Object.fromEntries(labelKinds.map((kind) => {
    const own = labels[kind].trim();
    return [kind, own ? { title: own, word: own } : { title: t(`defaults.${kind}`), word: t(`words.${kind}`) }];
  })) as Names;
}

function MoveButtons({ label, number, up, down, onMove, onRemove, removable, disabled }: {
  label: string; number: number; up: boolean; down: boolean; onMove: (direction: -1 | 1) => void; onRemove: () => void; removable: boolean; disabled: boolean;
}) {
  const t = useTranslations("Catalog.structure");
  return <div className="flex items-center gap-1">
    <Button type="button" variant="outline" size="icon" className="size-11" disabled={disabled || !up} aria-label={t("moveUp", { label, number })} onClick={() => onMove(-1)}><ArrowUp aria-hidden="true" /></Button>
    <Button type="button" variant="outline" size="icon" className="size-11" disabled={disabled || !down} aria-label={t("moveDown", { label, number })} onClick={() => onMove(1)}><ArrowDown aria-hidden="true" /></Button>
    <Button type="button" variant="outline" size="icon" className="size-11" disabled={disabled || !removable} aria-label={t("remove", { label, number })} onClick={onRemove}><Trash2 aria-hidden="true" /></Button>
  </div>;
}

function LessonCard({ lesson, number, names, value, open, setOpen, onChange, patch, disabled, problems }: {
  lesson: LessonForm; number: number; names: Names; value: Value; open: string | null; setOpen: (key: string | null) => void;
  onChange: (next: CourseStructure) => void; patch: (key: string, change: Partial<LessonForm>) => void; disabled: boolean; problems: boolean;
}) {
  const t = useTranslations("Catalog.lessons"), s = useTranslations("Catalog.structure");
  const expanded = open === lesson.key, titleId = `lesson-title-${lesson.key}`, videoId = `lesson-video-${lesson.key}`;
  const badVideo = problems && lesson.videoUrl.trim() !== "" && !parseVideoLink(lesson.videoUrl), word = names.lesson.word;
  return <li><Card data-lesson className="gap-0 py-0 shadow-none">
    <CardContent className="space-y-4 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span aria-hidden="true" className="mt-2 flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted text-xs font-medium tabular-nums">{number}</span>
        <Field className="min-w-48 flex-1">
          <FieldLabel htmlFor={titleId} className="sr-only">{s("titleLabel", { label: word, number })}</FieldLabel>
          <Input id={titleId} className="min-h-11" value={lesson.title} maxLength={120} disabled={disabled} placeholder={s("titlePlaceholder", { label: names.lesson.title })}
            aria-invalid={problems && !lesson.title.trim() ? true : undefined} onChange={(event) => patch(lesson.key, { title: event.target.value })} />
        </Field>
        <MoveButtons label={word} number={number} disabled={disabled} up={canMoveLesson(value, lesson.key, -1)} down={canMoveLesson(value, lesson.key, 1)}
          onMove={(direction) => onChange(moveLesson(value, lesson.key, direction))} removable
          onRemove={() => { onChange({ ...value, lessons: value.lessons.filter((item) => item.key !== lesson.key) }); if (expanded) setOpen(null); }} />
      </div>
      <Field data-invalid={badVideo ? true : undefined}>
        <FieldLabel htmlFor={videoId}>{t("video")}</FieldLabel>
        <Input id={videoId} type="url" inputMode="url" dir="ltr" className="min-h-11" value={lesson.videoUrl} maxLength={2048} disabled={disabled} placeholder={t("videoPlaceholder")}
          aria-invalid={badVideo ? true : undefined} aria-describedby={badVideo ? `${videoId}-error` : undefined} onChange={(event) => patch(lesson.key, { videoUrl: event.target.value })} />
        {badVideo && <FieldError id={`${videoId}-error`}>{t("videoInvalid")}</FieldError>}
      </Field>
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
      {expanded && <div id={`lesson-body-${lesson.key}`}><RichTextEditor value={lesson.body} label={s("bodyLabel", { label: word, number })} disabled={disabled} onChange={(body) => patch(lesson.key, { body })} /></div>}
    </CardContent>
  </Card></li>;
}

/**
 * A course's content: its own names for levels, sections and lessons, then the structure. Levels are optional; a course that is one untitled section
 * reads as the plain ordered lesson list it always was. Up and down move within a group and, at its edge, into the neighbouring section or level (no
 * dragging, so it works by keyboard and on phones). One lesson body editor is mounted at a time. The server stores the order and checks every rule.
 */
export function LessonListEditor({ value, onChange: publish, onLabels, disabled, problems }: {
  value: Value; onChange: (next: CourseStructure) => void; onLabels: (next: LabelsForm) => void; disabled: boolean; problems: boolean;
}) {
  const t = useTranslations("Catalog.structure"), names = useNames(value.labels);
  const [open, setOpen] = useState<string | null>(value.lessons[0]?.key ?? null);
  // The editor's change callback may outlive a render, so edits are applied to the latest value, not the one the callback was created with.
  const latest = useRef(value);
  useEffect(() => { latest.current = value; }, [value]);
  // Every change also updates the latest value at once, so an editor that reports its body while unmounting (closing one lesson to open another)
  // applies it to the new structure, not to the one before the change.
  const onChange = (next: CourseStructure) => { latest.current = { ...latest.current, ...next }; publish(next); };
  const patch = (key: string, change: Partial<LessonForm>) =>
    onChange({ ...latest.current, lessons: latest.current.lessons.map((lesson) => (lesson.key === key ? { ...lesson, ...change } : lesson)) });
  function add(section?: string) {
    const lesson = newLesson();
    onChange(addLesson(value, lesson, section)); setOpen(lesson.key);
  }
  const number = (key: string) => value.lessons.findIndex((lesson) => lesson.key === key) + 1;
  const sectionName = (index: number, title: string) => title.trim() || t("numbered", { label: names.section.title, number: index });
  const card = (lesson: LessonForm) => <LessonCard key={lesson.key} lesson={lesson} number={number(lesson.key)} names={names} value={value} open={open} setOpen={setOpen}
    onChange={onChange} patch={patch} disabled={disabled} problems={problems} />;
  const addLessonButton = (section?: string) => <Button type="button" variant="outline" className="min-h-11" disabled={value.lessons.length >= maxCourseLessons} onClick={() => add(section)}>
    <Plus aria-hidden="true" />{t("add", { label: names.lesson.word })}</Button>;
  const addSectionButton = (level?: string) => <Button type="button" variant="outline" className="min-h-11" disabled={value.sections.length >= maxSections}
    onClick={() => onChange(addSection(value, { key: partKey("section"), title: "", level: level ?? null }))}><Plus aria-hidden="true" />{t("add", { label: names.section.word })}</Button>;
  const addLevelButton = <Button type="button" variant="outline" className="min-h-11" disabled={value.levels.length >= maxLevels}
    onClick={() => onChange(addLevel(value, { key: partKey("level"), title: "" }))}><Plus aria-hidden="true" />{t("add", { label: names.level.word })}</Button>;

  function sectionBlock(key: string) {
    const index = value.sections.findIndex((row) => row.key === key), section = value.sections[index], inputId = `section-title-${key}`;
    const lessons = value.lessons.filter((lesson) => lesson.section === key);
    return <li key={key} data-section className="space-y-3 rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-start gap-3">
        <Field className="min-w-48 flex-1">
          <FieldLabel htmlFor={inputId} className="sr-only">{t("titleLabel", { label: names.section.word, number: index + 1 })}</FieldLabel>
          <Input id={inputId} className="min-h-11 font-medium" value={section.title} maxLength={120} disabled={disabled} placeholder={t("numbered", { label: names.section.title, number: index + 1 })}
            onChange={(event) => onChange({ ...value, sections: value.sections.map((row) => (row.key === key ? { ...row, title: event.target.value } : row)) })} />
        </Field>
        <MoveButtons label={names.section.word} number={index + 1} disabled={disabled} up={canMoveSection(value, key, -1)} down={canMoveSection(value, key, 1)}
          onMove={(direction) => onChange(moveSection(value, key, direction))} removable={canRemoveSection(value, key)} onRemove={() => onChange(removeSection(value, key))} />
      </div>
      {lessons.length > 0 && <ol aria-label={t("lessonsIn", { name: sectionName(index + 1, section.title) })} className="space-y-3">{lessons.map(card)}</ol>}
      {!disabled && addLessonButton(key)}
    </li>;
  }

  let body: React.ReactNode;
  if (!value.lessons.length && !value.sections.length && !value.levels.length) {
    body = <EmptyState icon={BookOpen} title={t("empty")} size="compact" solid
      action={!disabled ? <div className="flex flex-wrap justify-center gap-2">{addLessonButton()}{addSectionButton()}{addLevelButton}</div> : undefined} />;
  } else if (!showsStructure(value)) {
    // One untitled section and no levels: the original ordered lesson list.
    body = <div className="space-y-3">
      <ol aria-label={t("lessons")} className="space-y-3">{value.lessons.map(card)}</ol>
      {!disabled && <div className="flex flex-wrap gap-2">{addLessonButton()}{addSectionButton()}{addLevelButton}</div>}
    </div>;
  } else if (!value.levels.length) {
    body = <div className="space-y-3">
      <ol aria-label={t("structure")} className="space-y-3">{value.sections.map((row) => sectionBlock(row.key))}</ol>
      {!disabled && <div className="flex flex-wrap gap-2">{addSectionButton()}{addLevelButton}</div>}
    </div>;
  } else {
    body = <div className="space-y-4">
      <ol aria-label={t("structure")} className="space-y-4">{value.levels.map((level, at) => {
        const inputId = `level-title-${level.key}`, sections = value.sections.filter((row) => row.level === level.key);
        const name = level.title.trim() || t("numbered", { label: names.level.title, number: at + 1 });
        return <li key={level.key} data-level><Card className="gap-0 py-0 shadow-none"><CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-start gap-3">
            <Field className="min-w-48 flex-1">
              <FieldLabel htmlFor={inputId} className="sr-only">{t("titleLabel", { label: names.level.word, number: at + 1 })}</FieldLabel>
              <Input id={inputId} className="min-h-11 font-semibold" value={level.title} maxLength={120} disabled={disabled} placeholder={t("numbered", { label: names.level.title, number: at + 1 })}
                onChange={(event) => onChange({ ...value, levels: value.levels.map((row) => (row.key === level.key ? { ...row, title: event.target.value } : row)) })} />
            </Field>
            <MoveButtons label={names.level.word} number={at + 1} disabled={disabled} up={at > 0} down={at < value.levels.length - 1}
              onMove={(direction) => onChange(moveLevel(value, level.key, direction))} removable onRemove={() => onChange(removeLevel(value, level.key))} />
          </div>
          {sections.length > 0 && <ol aria-label={t("sectionsIn", { name })} className="space-y-3">{sections.map((row) => sectionBlock(row.key))}</ol>}
          {!disabled && addSectionButton(level.key)}
        </CardContent></Card></li>;
      })}</ol>
      {!disabled && addLevelButton}
    </div>;
  }
  return <div className="space-y-6">
    <FormSection title={t("namesTitle")}>
      <div className="grid gap-4 sm:grid-cols-3">
        {labelKinds.map((kind) => {
          const bad = problems && !validLabel(value.labels[kind]);
          return <Field key={kind} data-invalid={bad ? true : undefined}>
            <FieldLabel htmlFor={`course-label-${kind}`}>{t(`nameLabels.${kind}`)}</FieldLabel>
            <Input id={`course-label-${kind}`} className="min-h-11" value={value.labels[kind]} maxLength={labelLimit} disabled={disabled} placeholder={t(`defaults.${kind}`)}
              aria-invalid={bad ? true : undefined} onChange={(event) => onLabels({ ...value.labels, [kind]: event.target.value })} />
          </Field>;
        })}
      </div>
    </FormSection>
    {body}
  </div>;
}
