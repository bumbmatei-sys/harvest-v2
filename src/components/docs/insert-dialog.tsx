"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { markdownToBlocks } from "@/lib/docs-convert";
import { safeDocHref } from "@/lib/docs";

export type InsertMode = "button" | "link" | "markdown";
/** The small forms behind the slash items Button, Website link and Markdown: what to show, where it goes, or the text to convert into blocks. */
export function InsertDialog({ mode, onClose, onInsert }: { mode: InsertMode | null; onClose: () => void; onInsert: (mode: InsertMode, value: { label: string; href: string; blocks: unknown[] }) => void }) {
  const t = useTranslations("Docs");
  const [label, setLabel] = useState(""), [href, setHref] = useState(""), [text, setText] = useState(""), [error, setError] = useState("");
  function submit(e: React.FormEvent) {
    e.preventDefault(); if (!mode) return;
    if (mode === "markdown") { const blocks = markdownToBlocks(text); if (!blocks.length) { setError(t("insertEmpty")); return; } onInsert(mode, { label: "", href: "", blocks }); return; }
    const safe = safeDocHref(href.trim().startsWith("http") ? href.trim() : `https://${href.trim()}`);
    if (!safe) { setError(t("insertBadAddress")); return; }
    onInsert(mode, { label: label.trim() || safe, href: safe, blocks: [] });
  }
  return <Dialog open={mode !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
    <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{mode === "markdown" ? t("insertMarkdown") : mode === "button" ? t("insertButton") : t("insertLink")}</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-4" key={mode}>
        {mode === "markdown" ? <div className="space-y-2"><Label htmlFor="ins-md">{t("markdownText")}</Label><Textarea id="ins-md" rows={8} value={text} maxLength={100_000} onChange={(e) => { setText(e.target.value); setError(""); }} autoFocus /></div>
          : <><div className="space-y-2"><Label htmlFor="ins-label">{mode === "button" ? t("buttonLabel") : t("linkText")}</Label><Input id="ins-label" className="min-h-11" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} autoFocus /></div>
            <div className="space-y-2"><Label htmlFor="ins-href">{t("address")}</Label><Input id="ins-href" className="min-h-11" inputMode="url" value={href} onChange={(e) => { setHref(e.target.value); setError(""); }} /></div></>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2"><Button type="button" variant="outline" className="min-h-11" onClick={onClose}>{t("cancel")}</Button><Button type="submit" className="min-h-11" disabled={mode === "markdown" ? !text.trim() : !href.trim()}>{t("insert")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
