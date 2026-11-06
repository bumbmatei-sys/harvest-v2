"use client";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRecord } from "./record-context";

/**
 * Twenty-style inline cell: a labelled value that becomes an input in place.
 * Enter, Tab and blur save; Escape cancels (Twenty saves on Escape too — Harvest
 * treats it as a safe way out). Multiline values save with Ctrl/Cmd+Enter or blur.
 */
export function InlineField({ field, label, icon, value, type = "text", multiline = false, maxLength, href, placeholder, validate, required = false, hideLabel = false, emptyLabel, onSave, display, description }: {
  field: string; label: string; icon?: React.ReactNode; value: string; type?: "text" | "email" | "tel" | "url" | "number" | "date";
  /** Custom fields save through their own endpoint; built-ins use the record PATCH. */
  onSave?: (value: string) => Promise<string | null>; display?: (value: string) => string; description?: string;
  multiline?: boolean; maxLength: number; href?: string; placeholder?: string; required?: boolean; hideLabel?: boolean; emptyLabel?: string;
  validate?: (value: string) => string | null;
}) {
  const t = useTranslations("Crm");
  const { save, writable } = useRecord();
  const id = useId();
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(value), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [shown, setShown] = useState(value), [base, setBase] = useState(value);
  // Enter disables the input, which blurs it; one save must not become two requests.
  const pending = useRef(false);
  // Adopt fresh server values when not editing (after a refresh or another tab's change).
  if (value !== base) { setBase(value); if (!editing) setShown(value); }
  function start() { if (!writable) return; setDraft(shown); setError(""); setEditing(true); }
  async function commit() {
    if (pending.current) return;
    const next = draft.trim();
    if (next === shown.trim()) { setEditing(false); setError(""); return; }
    if (required && !next) { setError(t("thisFieldIsRequired")); return; }
    const problem = validate?.(next);
    if (problem) { setError(problem); return; }
    pending.current = true; setBusy(true);
    const failure = onSave ? await onSave(next) : await save({ [field]: next });
    pending.current = false; setBusy(false);
    if (failure) { setError(failure); return; }
    setShown(next); setEditing(false);
  }
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === "Escape") { event.preventDefault(); setEditing(false); setError(""); setDraft(shown); }
    if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) { event.preventDefault(); void commit(); }
  }
  const empty = !shown.trim();
  // The accessible name always matches the visible text (WCAG 2.5.3).
  const visible = empty ? (emptyLabel ?? t("empty")) : display ? display(shown) : shown;
  return <div className={cn("group/field grid items-start gap-x-3 py-0.5", hideLabel ? "grid-cols-1" : "grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] sm:grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)]")}>
    <label htmlFor={editing ? id : undefined} title={description || undefined} className={cn("flex min-h-8 items-center gap-2 text-xs text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0", hideLabel && "sr-only")}>{icon}<span className="truncate">{label}</span>{required && <span aria-hidden="true" className="text-destructive">{t("requiredMark")}</span>}</label>
    <div className="min-w-0">
      {editing ? <div className="space-y-1">
        {multiline
          ? <Textarea id={id} autoFocus value={draft} maxLength={maxLength} disabled={busy} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : `${id}-hint`} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onBlur={() => void commit()} className="min-h-24 text-sm" />
          : <Input id={id} autoFocus type={type} value={draft} maxLength={maxLength} disabled={busy} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onBlur={() => void commit()} className="h-8 text-sm" placeholder={placeholder} />}
        {multiline && !error && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{t("saveWithCtrlEnter")}</p>}
        {busy && <p role="status" className="text-xs text-muted-foreground">{t("saving")}</p>}
        {error && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p>}
      </div> : href && !empty ? <div className="relative flex min-h-8 items-center gap-1">
        <a href={href} className="min-w-0 rounded-sm px-2 py-1 text-sm [overflow-wrap:anywhere] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" rel="noreferrer" target={href.startsWith("http") ? "_blank" : undefined}>{shown}</a>
        {writable && <Button type="button" variant="ghost" size="icon-sm" onClick={start} aria-label={t("editField", { field: label })} className="absolute right-0 shrink-0 bg-card opacity-0 transition-opacity group-hover/field:opacity-100 focus-visible:opacity-100 pointer-coarse:static pointer-coarse:opacity-100"><Pencil aria-hidden="true" /></Button>}
      </div> : writable ? <button type="button" onClick={start} aria-label={t("editFieldValue", { field: label, value: visible })}
        className={cn("flex min-h-8 w-full items-start rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", multiline ? "whitespace-pre-wrap break-words" : "truncate", empty && "text-muted-foreground")}>
        {visible}
      </button> : <p className={cn("min-h-8 px-2 py-1.5 text-sm", multiline ? "whitespace-pre-wrap break-words" : "truncate", empty && "text-muted-foreground")}>{visible}</p>}
    </div>
  </div>;
}
