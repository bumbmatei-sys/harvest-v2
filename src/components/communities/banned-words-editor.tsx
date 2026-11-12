"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { moderationLimits } from "@/lib/moderation";

/** Banned words as removable chips. Matching posts and replies are held for review (C12a). */
export function BannedWordsEditor({ words, onChange, disabled = false }: { words: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const t = useTranslations("BannedWords"), [draft, setDraft] = useState("");
  const add = () => {
    const word = draft.trim().toLowerCase().replace(/\s+/g, " ");
    if (word && !words.includes(word)) onChange([...words, word]);
    setDraft("");
  };
  return <div className="space-y-2">
    <Label htmlFor="banned-word">{t("label")}</Label>
    {words.length > 0 && <ul className="flex flex-wrap gap-2" aria-label={t("list")}>{words.map((word) => <li key={word}>
      <Badge variant="secondary" className="h-11 gap-1 pr-0 pl-3 text-sm">{word}
        <Button type="button" variant="ghost" size="icon" className="size-11" disabled={disabled} aria-label={t("remove", { word })}
          onClick={() => onChange(words.filter((w) => w !== word))}><X aria-hidden="true" /></Button></Badge></li>)}</ul>}
    {words.length < moderationLimits.bannedWords && <div className="flex flex-wrap gap-2">
      <Input id="banned-word" className="min-h-11 min-w-40 flex-1" value={draft} maxLength={moderationLimits.bannedWord} disabled={disabled} placeholder={t("placeholder")}
        onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
      <Button type="button" variant="outline" className="min-h-11" disabled={disabled || !draft.trim()} onClick={add}><Plus aria-hidden="true" />{t("add")}</Button>
    </div>}
  </div>;
}
