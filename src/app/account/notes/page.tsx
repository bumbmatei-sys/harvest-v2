import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { NotebookPen } from "lucide-react";
import { getDb } from "@/db/client";
import { freeCatalogEnabled } from "@/server/free-catalog-mode";
import { listMyNotes } from "@/server/free-catalog";
import { pageSession } from "@/server/page-session";
import { PublicFrame } from "@/components/connect/public-frame";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/** The signed-in person's private lesson notes across every course, newest first. Only they can read them; owners never can. */
export default async function MyNotes() {
  if (!freeCatalogEnabled()) notFound();
  const session = await pageSession("personal"), t = await getTranslations("MyNotes");
  const notes = await listMyNotes(getDb(), session.user.id);
  return <PublicFrame personal notice={false}>
    <div className="space-y-6">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1>
      {notes.length === 0 ? <EmptyState icon={NotebookPen} title={t("empty")} description={t("emptyDescription")} />
        : <ul aria-label={t("title")} className="grid gap-4 lg:grid-cols-2">{notes.map((note) => <li key={`${note.lessonId}`} data-my-note>
          <Card className="h-full gap-4"><CardHeader className="space-y-1">
            <CardTitle><h2 className="text-base font-semibold break-words">{note.lesson ?? note.course?.title ?? t("unavailable")}</h2></CardTitle>
            {note.course && note.lesson && <p className="text-sm text-muted-foreground break-words">{note.course.title}</p>}
            <p className="text-xs text-muted-foreground">{t("updated", { date: new Date(note.updatedAt) })}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-line break-words">{note.body}</p>
            {note.course && note.lesson && <Button asChild variant="outline" className="min-h-11">
              <Link href={`/courses/${note.course.slug}/learn?lesson=${note.lessonId}`} prefetch={false}>{t("open")}<span className="sr-only"> {note.lesson}</span></Link></Button>}
          </CardContent></Card></li>)}</ul>}
    </div>
  </PublicFrame>;
}
