"use client";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Circle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useRequest } from "@/hooks/use-request";
import { noteLimit, validNote } from "@/lib/course-progress";

/** Marks the open lesson complete or not complete for the signed-in learner. The server stores it per learner and lesson. */
export function LessonComplete({ slug, lesson, completed, onChange }: { slug: string; lesson: string; completed: boolean; onChange: (completed: boolean) => void }) {
  const t = useTranslations("CatalogPublic"), request = useRequest();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function toggle() {
    setBusy(true); setError("");
    const result = await request<{ completed: boolean }>(`/api/catalog/${slug}/lessons/${lesson}/progress`, { method: "PUT", body: { completed: !completed } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onChange(result.data.completed);
  }
  return <div className="space-y-3">
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant={completed ? "outline" : "default"} className="min-h-11" disabled={busy} aria-pressed={completed} onClick={() => void toggle()} data-lesson-complete>
        {busy ? <Spinner decorative size="sm" /> : completed ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}{t(completed ? "completed" : "markComplete")}
      </Button>
      <span role="status" className="text-sm text-muted-foreground">{completed ? t("completedNotice") : ""}</span>
    </div>
  </div>;
}

/** The learner's private note on the open lesson: plain text, saved on request. Only the learner can read it. */
export function LessonNote({ slug, lesson, initial }: { slug: string; lesson: string; initial: string }) {
  const t = useTranslations("CatalogPublic"), request = useRequest(), id = useId();
  const [body, setBody] = useState(initial), [saved, setSaved] = useState(initial), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const invalid = !validNote(body);
  async function save() {
    if (invalid) return;
    setBusy(true); setError(""); setNotice("");
    const result = await request<{ saved: true }>(`/api/catalog/${slug}/lessons/${lesson}/note`, { method: "PUT", body: { body } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setSaved(body); setNotice(t(body.trim() ? "noteSaved" : "noteDeleted"));
  }
  return <Card className="gap-4">
    <CardHeader><CardTitle><h3 className="text-base font-semibold">{t("notesTitle")}</h3></CardTitle></CardHeader>
    <CardContent className="space-y-3">
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <Field data-invalid={invalid ? true : undefined}>
        <FieldLabel htmlFor={`${id}-note`}>{t("noteLabel")}</FieldLabel>
        <Textarea id={`${id}-note`} rows={5} value={body} maxLength={noteLimit} aria-invalid={invalid ? true : undefined} aria-describedby={`${id}-private`}
          onChange={(event) => { setBody(event.target.value); setNotice(""); }} />
        {invalid && <FieldError>{t("noteInvalid")}</FieldError>}
        <p id={`${id}-private`} className="text-xs text-muted-foreground">{t("notePrivate")}</p>
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="min-h-11" disabled={busy || invalid || body === saved} onClick={() => void save()}>
          {busy && <Spinner decorative size="sm" />}{t("saveNote")}</Button>
        <span role="status" className="text-sm text-muted-foreground">{notice}</span>
      </div>
    </CardContent>
  </Card>;
}
