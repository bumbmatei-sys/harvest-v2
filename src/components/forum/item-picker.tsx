"use client";
/** Host picker for linking an existing article, product, course, event or form to a forum post (27 Nov 2026). Reads the forum's linkable-items route (search and pages of 25). Harvest-written on the shared ToggleGroup, InputGroup, Item, StatusBadge and EmptyState components; no kit code. */
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Search } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { useCrmRequest } from "@/components/crm/request";
import { itemKindIcon } from "@/components/forum/post-details";
import { forumItemKinds, type ForumItemKind } from "@/lib/forum";
import type { ForumItemCard } from "@/server/community-forum";
import { cn } from "@/lib/utils";

export type PickedItem = ForumItemCard & { kind: ForumItemKind; available: true };
type Page = { kind: ForumItemKind; page: number; hasMore: boolean; items: ForumItemCard[] };

export function ItemPicker({ slug, kind, onKind, isSelected, onToggle, full }: { slug: string; kind: ForumItemKind; onKind: (kind: ForumItemKind) => void;
  isSelected: (kind: ForumItemKind, id: string) => boolean; onToggle: (item: PickedItem) => void; /** Five items are linked: unselected results are disabled. */ full: boolean }) {
  const t = useTranslations("CommunityForum"), request = useCrmRequest(), id = useId();
  const [query, setQuery] = useState(""), [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // The loaded result is keyed by search and page: while the key differs, the next page is loading.
  const [loaded, setLoaded] = useState<{ key: string; items: ForumItemCard[]; hasMore: boolean; error: string }>({ key: "", items: [], hasMore: false, error: "" });
  const key = `${search}\u0000${page}`, loading = loaded.key !== key, { items, hasMore, error } = loaded;

  // A new search starts again from the first page; a new kind remounts the picker (the composer keys it by kind).
  useEffect(() => { const timer = setTimeout(() => { const next = query.trim(); if (next !== search) { setSearch(next); setPage(1); } }, 250); return () => clearTimeout(timer); }, [query, search]);
  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ kind, page: String(page) }); if (search) q.set("q", search);
    void request<Page>(`/api/communities/${slug}/posts/linkable-items?${q}`, { method: "GET" }).then((result) => {
      if (!live) return;
      setLoaded((previous) => !result.ok ? { ...previous, key, error: result.error }
        : { key, error: "", hasMore: result.data.hasMore, items: page === 1 ? result.data.items : [...previous.items, ...result.data.items] });
    });
    return () => { live = false; };
  }, [kind, search, page, key, request, slug]);

  const kindLabel = t(`pickerKinds.${kind}`);
  return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-3">
    <h3 id={`${id}-title`} className="text-sm font-semibold">{t("pickerTitle", { kind: kindLabel })}</h3>
    <ToggleGroup type="single" variant="outline" value={kind} onValueChange={(value) => { if (value) onKind(value as ForumItemKind); }} aria-label={t("attachTitle")}
      spacing={2} className="flex w-full flex-wrap justify-start *:data-[slot=toggle-group-item]:rounded-full">
      {forumItemKinds.map((k) => { const Icon = itemKindIcon[k]; return <ToggleGroupItem key={k} value={k} className="min-h-11 flex-none px-3 lg:min-h-9">
        <Icon aria-hidden="true" />{t(`attachKinds.${k}`)}</ToggleGroupItem>; })}
    </ToggleGroup>
    <InputGroup className="h-11 lg:h-9">
      <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
      <InputGroupInput className="h-11 lg:h-9" type="search" aria-label={t("pickerSearch")} placeholder={t("pickerSearch")} value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} />
    </InputGroup>
    {full && <p className="text-muted-foreground text-xs">{t("itemLimit")}</p>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {!loading && !error && items.length === 0 ? <EmptyState size="compact" icon={itemKindIcon[kind]} title={t("pickerEmpty")} />
      : <ul aria-label={t("pickerTitle", { kind: kindLabel })} aria-busy={loading} className="space-y-2">
        {items.map((item) => { const selected = isSelected(kind, item.id), Icon = itemKindIcon[kind]; return <li key={item.id}>
          <Item variant="outline" size="sm" asChild className={cn("min-h-11 w-full min-w-0 flex-nowrap text-left", selected && "border-primary bg-selected")}>
            <button type="button" aria-pressed={selected} disabled={full && !selected} onClick={() => onToggle({ ...item, kind, available: true })}>
              {item.cover
                // eslint-disable-next-line @next/next/no-img-element -- public or access-checked cover route; not optimisable
                ? <ItemMedia variant="image" className="size-11"><img src={item.cover} alt="" /></ItemMedia>
                : <ItemMedia variant="icon" className="size-11"><Icon aria-hidden="true" /></ItemMedia>}
              <ItemContent className="min-w-0"><ItemTitle className="line-clamp-2 break-words">{item.title}</ItemTitle><ItemDescription>{t(`attachKinds.${kind}`)}</ItemDescription></ItemContent>
              <ItemActions>{item.price === "free" && <StatusBadge tone="neutral" label={t("priceFree")} />}
                <Check className={cn("size-4 text-primary", !selected && "invisible")} aria-hidden="true" /></ItemActions>
            </button>
          </Item></li>; })}
      </ul>}
    {loading && <p className="text-muted-foreground text-sm" role="status">{t("pickerLoading")}</p>}
    {hasMore && !loading && <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => setPage((p) => p + 1)}>{t("pickerMore")}</Button>}
  </section>;
}
