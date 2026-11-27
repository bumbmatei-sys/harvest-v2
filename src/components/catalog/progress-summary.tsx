import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProgressSummary } from "@/lib/course-progress";

/** Owners and admins: enrolment and completions per lesson, counts only. A count of 1 to 4 arrives withheld (null) and reads "Fewer than 5". */
export function ProgressSummaryCard({ summary }: { summary: ProgressSummary }) {
  const t = useTranslations("Catalog.editor.progress");
  const count = (value: number | null) => (value === null ? t("hidden", { minimum: summary.minimumGroup }) : String(value));
  const lessons = summary.lessons.filter((lesson) => lesson.published);
  return <Card data-progress-summary><CardHeader><CardTitle><h3 className="text-base font-semibold">{t("title")}</h3></CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-sm text-muted-foreground">{t("enrolled")}</span>
        <span className="font-semibold tabular-nums">{count(summary.enrolled)}</span></p>
      {lessons.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p>
        : <ul aria-label={t("completed")} className="divide-y rounded-md border">{lessons.map((lesson) => <li key={lesson.id} className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-3 py-2">
          <span className="min-w-0 break-words">{lesson.title}</span><span className="tabular-nums text-muted-foreground">{count(lesson.completed)}</span></li>)}</ul>}
      <p className="text-xs text-muted-foreground">{t("note", { minimum: summary.minimumGroup })}</p>
    </CardContent></Card>;
}
