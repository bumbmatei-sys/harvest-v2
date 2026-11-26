"use client";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, PackageOpen, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/empty-state";
import { useRequest } from "@/hooks/use-request";
import type { CatalogKind, CatalogVisibility } from "@/lib/catalog";

export type ShelfOption = { id: string; kind: CatalogKind; slug: string; title: string; visibility: CatalogVisibility; linked: boolean };

/**
 * C13/C16 owner step: which published courses (Classroom) and free products (Products) this community shows. Each switch is the canonical shelf link
 * (`PUT/DELETE .../communities/{id}/catalog/{item}`), saved at once like the catalogue editor's shelf switches; the items themselves stay in Courses and Products.
 */
export function CommunityShelfEditor({ tenantId, communityId, initial, writable }: { tenantId: string; communityId: string; initial: ShelfOption[]; writable: boolean }) {
  const t = useTranslations("CommunityShelf"), request = useRequest();
  const [items, setItems] = useState(initial), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  async function toggle(item: ShelfOption, on: boolean) {
    setBusy(item.id); setError("");
    const result = await request<{ linked: boolean }>(`/api/workspaces/${tenantId}/communities/${communityId}/catalog/${item.id}`,
      on ? { method: "PUT", body: { position: 0 } } : { method: "DELETE" });
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, linked: on } : row)));
  }
  const group = (kind: CatalogKind) => {
    const rows = items.filter((item) => item.kind === kind), course = kind === "course", title = t(course ? "classroomTitle" : "productsTitle");
    const create = writable ? <Button asChild variant="outline" className="min-h-11"><Link href={`/workspaces/${tenantId}/products/new/${kind}`}><Plus aria-hidden="true" />{t(course ? "newCourse" : "newProduct")}</Link></Button> : undefined;
    return <Card key={kind}><CardHeader><CardTitle><h3 className="text-base font-semibold">{title}</h3></CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0
          ? <EmptyState size="compact" icon={course ? BookOpen : PackageOpen} title={t(course ? "noCourses" : "noProducts")} action={create} />
          : <ul aria-label={title} className="space-y-2">{rows.map((item) => <li key={item.id}>
            <Label htmlFor={`shelf-item-${item.id}`} className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 font-normal">
              <span className="min-w-0 break-words">{item.title}</span>
              <Switch id={`shelf-item-${item.id}`} checked={item.linked} disabled={!writable || busy === item.id} onCheckedChange={(on) => void toggle(item, on)} /></Label></li>)}</ul>}
      </CardContent></Card>;
  };
  return <div className="space-y-4">
    {!writable && <Alert><AlertDescription>{t("readOnly")}</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {group("course")}{group("download")}
  </div>;
}
