/** Derived from Shadcn UI Kit item list-block29 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Community screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Hash, Lock, MoreHorizontal, Plus } from "lucide-react";

import { useCrmRequest } from "@/components/crm/request";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";

export type ForumCategory = { id: string; name: string; emoji: string | null; hostsOnly: boolean; posts: number };

/** Owner setup for forum categories (editor Channels step), as the kit's inventory list. Each change saves immediately. */
export function ForumCategoriesEditor({ endpoint, initial, writable, title }: { endpoint: string; initial: ForumCategory[]; writable: boolean; title: string }) {
  const t = useTranslations("ForumCategories"), request = useCrmRequest(), base = `${endpoint}/categories`;
  const [items, setItems] = useState<ForumCategory[]>(initial), [error, setError] = useState(""), [busy, setBusy] = useState(false), [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const hostsCount = items.filter((c) => c.hostsOnly).length;
  async function load() { const r = await request<ForumCategory[]>(base, { method: "GET" }); if (r.ok) setItems(r.data); else setError(r.error); }
  async function act(path: string, method: string, body?: unknown) {
    setBusy(true); setError(""); const r = await request(path, { method, body }); if (!r.ok) setError(r.error); await load(); setBusy(false); return r.ok;
  }
  const save = (c: ForumCategory, next: Partial<ForumCategory>) => { const v = { ...c, ...next };
    return act(`${base}/${c.id}`, "PATCH", { name: v.name.trim(), emoji: v.emoji?.trim() || null, hostsOnly: v.hostsOnly }); };
  const edit = (id: string, next: Partial<ForumCategory>) => setItems((list) => list.map((c) => c.id === id ? { ...c, ...next } : c));

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle><h3 className="text-base font-semibold">{title}</h3></CardTitle>
        <CardDescription className="text-xs">
          {t("summary", { hosts: hostsCount, count: items.length })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <ItemGroup role="list" aria-label={t("list")} className="gap-0 has-data-[size=sm]:gap-0">
          {items.map((c, i, all) => {
            const label = c.name.trim() || t("nameFor", { number: i + 1 });
            return (
              <Item
                key={c.id}
                role="listitem"
                size="sm"
                variant="outline"
                className="rounded-none border-x-0 border-t-0 px-0 last:border-b-0"
              >
                <ItemMedia className="bg-muted size-8 self-start rounded-md border">
                  {c.emoji ? <span aria-hidden="true" className="text-base leading-none">{c.emoji}</span> : <Hash className="text-muted-foreground size-4" aria-hidden="true" />}
                </ItemMedia>
                <ItemContent className="min-w-0 gap-1">
                  {editing === c.id ? <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setEditing(null); if (c.name.trim()) void save(c, {}); else void load(); }}>
                    <Input className="min-h-11 w-16 lg:min-h-9" value={c.emoji ?? ""} maxLength={16} disabled={busy} aria-label={t("emojiFor", { name: c.name })}
                      onChange={(e) => edit(c.id, { emoji: e.target.value })} />
                    <Input className="min-h-11 min-w-40 flex-1 lg:min-h-9" value={c.name} maxLength={60} disabled={busy} aria-label={t("nameFor", { number: i + 1 })} autoFocus
                      onChange={(e) => edit(c.id, { name: e.target.value })} />
                    <Button type="submit" variant="outline" size="responsive" disabled={busy}>{t("done")}</Button>
                  </form> : <>
                    <ItemTitle className="flex-wrap">
                      {c.name}
                      {c.hostsOnly && (
                        <Badge variant="outline">
                          <span className="bg-primary size-1.5 rounded-full" aria-hidden="true" />
                          {t("hostsOnly")}
                        </Badge>
                      )}
                    </ItemTitle>
                    <ItemDescription className="flex items-center gap-3 text-xs">
                      <span className="tabular-nums">{t("posts", { count: c.posts })}</span>
                    </ItemDescription>
                  </>}
                </ItemContent>
                <ItemActions>
                  <label className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 lg:min-h-0 lg:min-w-0">
                    <Lock className="text-muted-foreground size-4" aria-hidden="true" />
                    <Switch
                      checked={c.hostsOnly}
                      disabled={!writable || busy}
                      aria-label={t("hostsOnlyFor", { name: label })}
                      onCheckedChange={(on) => void save(c, { hostsOnly: on })}
                    />
                  </label>
                  {writable && <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-responsive"
                        disabled={busy}
                        aria-label={t("actionsFor", { name: label })}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="min-h-11 lg:min-h-0" onSelect={() => setEditing(c.id)}>{t("edit")}</DropdownMenuItem>
                      <DropdownMenuItem className="min-h-11 lg:min-h-0" disabled={i === 0} onSelect={() => void act(`${base}/${c.id}`, "PATCH", { direction: "up" })}>{t("moveUp", { name: label })}</DropdownMenuItem>
                      <DropdownMenuItem className="min-h-11 lg:min-h-0" disabled={i === all.length - 1} onSelect={() => void act(`${base}/${c.id}`, "PATCH", { direction: "down" })}>{t("moveDown", { name: label })}</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="min-h-11 lg:min-h-0" variant="destructive" disabled={c.posts > 0 || all.length <= 1} onSelect={() => void act(`${base}/${c.id}`, "DELETE")}>
                        {t("delete", { name: label })}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>}
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
        {writable && items.length < 30 && <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return;
          void act(base, "POST", { name: name.trim(), hostsOnly: false }).then((ok) => { if (ok) setName(""); }); }}>
          <Input className="min-h-11 min-w-40 flex-1 lg:min-h-9" value={name} maxLength={60} disabled={busy} aria-label={t("newName")} placeholder={t("newPlaceholder")} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" size="responsive" variant="outline" disabled={busy || !name.trim()}><Plus aria-hidden="true" />{t("add")}</Button>
        </form>}
      </CardContent>
    </Card>
  );
}
