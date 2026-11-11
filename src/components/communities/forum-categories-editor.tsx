"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";
import { useCrmRequest } from "@/components/crm/request";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type ForumCategory = { id: string; name: string; emoji: string | null; hostsOnly: boolean; posts: number };

/** Owner setup for forum categories (editor Channels step). Each change saves immediately. */
export function ForumCategoriesEditor({ endpoint, initial, writable }: { endpoint: string; initial: ForumCategory[]; writable: boolean }) {
  const t = useTranslations("ForumCategories"), request = useCrmRequest(), base = `${endpoint}/categories`;
  const [items, setItems] = useState<ForumCategory[]>(initial), [error, setError] = useState(""), [busy, setBusy] = useState(false), [name, setName] = useState("");
  async function load() { const r = await request<ForumCategory[]>(base, { method: "GET" }); if (r.ok) setItems(r.data); else setError(r.error); }
  async function act(path: string, method: string, body?: unknown) {
    setBusy(true); setError(""); const r = await request(path, { method, body }); if (!r.ok) setError(r.error); await load(); setBusy(false); return r.ok;
  }
  const save = (c: ForumCategory, next: Partial<ForumCategory>) => { const v = { ...c, ...next };
    return act(`${base}/${c.id}`, "PATCH", { name: v.name.trim(), emoji: v.emoji?.trim() || null, hostsOnly: v.hostsOnly }); };
  const edit = (id: string, next: Partial<ForumCategory>) => setItems((list) => list.map((c) => c.id === id ? { ...c, ...next } : c));
  return <div className="space-y-3">
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <ul className="space-y-2" aria-label={t("list")}>{items.map((c, i, all) => <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
      <Input className="min-h-11 w-16" value={c.emoji ?? ""} maxLength={16} disabled={!writable || busy} aria-label={t("emojiFor", { name: c.name })}
        onChange={(e) => edit(c.id, { emoji: e.target.value })} onBlur={() => void save(c, {})} />
      <Input className="min-h-11 min-w-40 flex-1" value={c.name} maxLength={60} disabled={!writable || busy} aria-label={t("nameFor", { number: i + 1 })}
        onChange={(e) => edit(c.id, { name: e.target.value })} onBlur={() => { if (c.name.trim()) void save(c, {}); else void load(); }} />
      <Label htmlFor={`category-hosts-${c.id}`} className="flex min-h-11 items-center gap-2 font-normal"><Switch id={`category-hosts-${c.id}`} checked={c.hostsOnly} disabled={!writable || busy}
        onCheckedChange={(on) => void save(c, { hostsOnly: on })} /><Lock className="size-4" aria-hidden="true" />{t("hostsOnly")}</Label>
      <Button type="button" variant="ghost" size="icon" className="size-11" disabled={!writable || busy || i === 0} aria-label={t("moveUp", { name: c.name })}
        onClick={() => void act(`${base}/${c.id}`, "PATCH", { direction: "up" })}><ArrowUp aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon" className="size-11" disabled={!writable || busy || i === all.length - 1} aria-label={t("moveDown", { name: c.name })}
        onClick={() => void act(`${base}/${c.id}`, "PATCH", { direction: "down" })}><ArrowDown aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon" className="size-11" disabled={!writable || busy || c.posts > 0 || all.length <= 1} aria-label={t("delete", { name: c.name })}
        onClick={() => void act(`${base}/${c.id}`, "DELETE")}><Trash2 aria-hidden="true" /></Button>
    </li>)}</ul>
    {writable && items.length < 30 && <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return;
      void act(base, "POST", { name: name.trim(), hostsOnly: false }).then((ok) => { if (ok) setName(""); }); }}>
      <Input className="min-h-11 min-w-40 flex-1" value={name} maxLength={60} disabled={busy} aria-label={t("newName")} placeholder={t("newPlaceholder")} onChange={(e) => setName(e.target.value)} />
      <Button type="submit" variant="outline" className="min-h-11" disabled={busy || !name.trim()}><Plus aria-hidden="true" />{t("add")}</Button>
    </form>}
  </div>;
}
