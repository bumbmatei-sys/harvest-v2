"use client";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useRecord } from "./record-context";

/** The record name as an inline-editable page heading (Twenty's show-page title). */
export function RecordTitle({ field, value, label, maxLength }: { field: string; value: string; label: string; maxLength: number }) {
  const t = useTranslations("Crm");
  const { save, writable } = useRecord();
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(value), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(value), [base, setBase] = useState(value);
  const pending = useRef(false), hint = useId();
  if (value !== base) { setBase(value); if (!editing) setShown(value); }
  async function commit() {
    if (pending.current) return;
    const next = draft.trim();
    if (next === shown) { setEditing(false); setError(""); return; }
    if (!next) { setError(t("thisFieldIsRequired")); return; }
    pending.current = true; setBusy(true);
    const failure = await save({ [field]: next });
    pending.current = false; setBusy(false);
    if (failure) { setError(failure); return; }
    setShown(next); setEditing(false); setError("");
  }
  return <div className="min-w-0">
    {editing ? <Input autoFocus aria-label={label} value={draft} maxLength={maxLength} disabled={busy} aria-invalid={!!error}
      onChange={(event) => setDraft(event.target.value)} onBlur={() => void commit()}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commit(); } if (event.key === "Escape") { setEditing(false); setDraft(shown); setError(""); } }}
      className="h-10 max-w-xl text-xl font-semibold md:text-xl" />
      : <h1 className="break-words text-[28px] leading-tight font-semibold tracking-tight">{writable
        ? <button type="button" onClick={() => { setDraft(shown); setEditing(true); }} aria-describedby={hint} className={cn("-mx-1.5 rounded-md px-1.5 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none")}>{shown}</button>
        : shown}</h1>}
    {writable && !editing && <span id={hint} className="sr-only">{t("editField", { field: label })}</span>}
    {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
  </div>;
}
