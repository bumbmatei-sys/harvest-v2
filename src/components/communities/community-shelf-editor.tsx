"use client";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, BookOpen, PackageOpen, Plus, Star } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/empty-state";
import { useRequest } from "@/hooks/use-request";
import { move, type CatalogKind, type CatalogVisibility } from "@/lib/catalog";
import { cn } from "@/lib/utils";

export type ShelfOption = { id: string; kind: CatalogKind; slug: string; title: string; visibility: CatalogVisibility; linked: boolean; position: number | null; featured: boolean };
type Shelf = { order: string[]; featured: string | null };

const shelfOf = (items: ShelfOption[], kind: CatalogKind): Shelf => {
  const linked = items.filter((item) => item.kind === kind && item.linked).sort((a, b) => Number(b.featured) - Number(a.featured) || (a.position ?? 0) - (b.position ?? 0) || a.title.localeCompare(b.title));
  return { order: linked.map((item) => item.id), featured: linked.find((item) => item.featured)?.id ?? null };
};

/**
 * C13/C16 owner step: which published courses (Classroom) and free products (Products) this community shows, in what order, and which one is featured.
 * The switch is the canonical shelf link (`PUT/DELETE .../communities/{id}/catalog/{item}`); order and the featured item are saved together
 * (`PUT .../communities/{id}/catalog`). The featured item always leads, so it cannot be moved and nothing moves above it. Items stay in Courses and Products.
 */
export function CommunityShelfEditor({ tenantId, communityId, initial, writable }: { tenantId: string; communityId: string; initial: ShelfOption[]; writable: boolean }) {
  const t = useTranslations("CommunityShelf"), request = useRequest();
  const [items, setItems] = useState(initial);
  const [shelves, setShelves] = useState<Record<CatalogKind, Shelf>>(() => ({ course: shelfOf(initial, "course"), download: shelfOf(initial, "download") }));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const endpoint = `/api/workspaces/${tenantId}/communities/${communityId}/catalog`;

  async function toggle(item: ShelfOption, on: boolean) {
    setBusy(true); setError("");
    const shelf = shelves[item.kind];
    const result = await request<{ linked: boolean }>(`${endpoint}/${item.id}`, on ? { method: "PUT", body: { position: Math.min(shelf.order.length, 1000) } } : { method: "DELETE" });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, linked: on } : row)));
    setShelves((current) => ({ ...current, [item.kind]: on ? { ...shelf, order: [...shelf.order, item.id] }
      : { order: shelf.order.filter((id) => id !== item.id), featured: shelf.featured === item.id ? null : shelf.featured } }));
  }
  async function arrange(kind: CatalogKind, next: Shelf) {
    const previous = shelves[kind];
    setShelves((current) => ({ ...current, [kind]: next })); setBusy(true); setError("");
    const result = await request<Shelf>(endpoint, { method: "PUT", body: { kind, order: next.order, featured: next.featured } });
    setBusy(false);
    if (!result.ok) { setError(result.error); setShelves((current) => ({ ...current, [kind]: previous })); }
  }
  function feature(kind: CatalogKind, id: string) {
    const shelf = shelves[kind];
    if (shelf.featured === id) void arrange(kind, { order: shelf.order, featured: null });
    else void arrange(kind, { order: [id, ...shelf.order.filter((other) => other !== id)], featured: id });
  }

  const group = (kind: CatalogKind) => {
    const course = kind === "course", title = t(course ? "classroomTitle" : "productsTitle"), shelf = shelves[kind];
    const byId = new Map(items.map((item) => [item.id, item]));
    const linked = shelf.order.flatMap((id) => byId.get(id) ?? []), others = items.filter((item) => item.kind === kind && !item.linked);
    const top = shelf.featured ? 1 : 0;
    const create = writable ? <Button asChild variant="outline" className="min-h-11"><Link href={`/workspaces/${tenantId}/products/new/${kind}`}><Plus aria-hidden="true" />{t(course ? "newCourse" : "newProduct")}</Link></Button> : undefined;
    const row = (item: ShelfOption, index: number | null) => {
      const featured = shelf.featured === item.id;
      return <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 ps-3">
        <Label htmlFor={`shelf-item-${item.id}`} className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-2 font-normal">
          <span className="min-w-0 break-words">{item.title}</span>
          {featured && <Badge>{t("featured")}</Badge>}
          {item.visibility === "hidden" && <Badge variant="outline">{t("membersOnly")}</Badge>}
        </Label>
        {index !== null && <span className="flex items-center gap-1">
          <Button type="button" variant="outline" size="icon" className="size-11" disabled={!writable || busy || featured || index <= top}
            aria-label={t("moveUp", { name: item.title })} onClick={() => void arrange(kind, { ...shelf, order: move(shelf.order, index, index - 1) })}><ArrowUp aria-hidden="true" /></Button>
          <Button type="button" variant="outline" size="icon" className="size-11" disabled={!writable || busy || featured || index === shelf.order.length - 1}
            aria-label={t("moveDown", { name: item.title })} onClick={() => void arrange(kind, { ...shelf, order: move(shelf.order, index, index + 1) })}><ArrowDown aria-hidden="true" /></Button>
          <Button type="button" variant="outline" size="icon" className="size-11" disabled={!writable || busy} aria-pressed={featured}
            aria-label={t(featured ? "unfeatureNamed" : "featureNamed", { name: item.title })} onClick={() => feature(kind, item.id)}>
            <Star aria-hidden="true" className={cn(featured && "fill-current")} /></Button>
        </span>}
        <span className="flex min-h-11 items-center px-1">
          <Switch id={`shelf-item-${item.id}`} checked={item.linked} disabled={!writable || busy} onCheckedChange={(on) => void toggle(item, on)} /></span>
      </li>;
    };
    return <Card key={kind}><CardHeader><CardTitle><h3 className="text-base font-semibold">{title}</h3></CardTitle></CardHeader>
      <CardContent>
        {linked.length + others.length === 0
          ? <EmptyState size="compact" icon={course ? BookOpen : PackageOpen} title={t(course ? "noCourses" : "noProducts")} action={create} />
          : <ul aria-label={title} className="space-y-2">{linked.map((item, index) => row(item, index))}{others.map((item) => row(item, null))}</ul>}
      </CardContent></Card>;
  };
  return <div className="space-y-4">
    {!writable && <Alert><AlertDescription>{t("readOnly")}</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {group("course")}{group("download")}
  </div>;
}
