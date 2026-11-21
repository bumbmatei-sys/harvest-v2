"use client";
import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlignLeft, Calendar, ChevronLeft, ChevronRight, CircleDot, Contact, Hash, Layers, PenLine, Paperclip, Plus, Search, Tag, Type, UserRound, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { menuGroups, type CrmField, type MenuItem } from "@/lib/crm-forms";

const groupIcon: Record<string, LucideIcon> = { crm: UserRound, short: Type, long: AlignLeft, dates: Calendar, single: CircleDot, multi: Tag, contact: Contact, uploads: Paperclip, number: Hash, signature: PenLine, layout: Layers };

/**
 * The add-question menu: a searchable list of question types grouped like the reference builder, with a submenu per group that offers a new
 * question or one saved to a CRM field. From 768px the submenu sits beside the list; on a phone it replaces it (Back returns). Arrow keys move,
 * Right opens a submenu, Left goes back, Escape closes.
 */
export function AddQuestionMenu({ usedFields, disabled, onAdd, full = false }: { usedFields: readonly CrmField[]; disabled?: boolean; onAdd: (item: MenuItem) => void; full?: boolean }) {
  const t = useTranslations("CrmForms.menu");
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [group, setGroup] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const items = (g: (typeof menuGroups)[number]) => g.items;
  const flat = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const seen = new Set<string>();
    return menuGroups.flatMap((g) => items(g).map((item) => ({ item, group: g.id }))).filter(({ item, group: gid }) => {
      const label = `${t(`items.${item.id}`)} ${t(`groups.${gid}`)}`.toLowerCase();
      if (!label.includes(needle) || seen.has(item.id)) return false;
      seen.add(item.id); return true;
    });
  }, [query, t]);
  const current = menuGroups.find((g) => g.id === group) ?? null;
    const isUsed = (item: MenuItem) => Boolean(item.mapTo && usedFields.includes(item.mapTo));
  const pick = (item: MenuItem) => { reset(false); onAdd(item); };
  function reset(next: boolean) { setOpen(next); if (!next) { setQuery(""); setGroup(null); } }
  function keys(event: React.KeyboardEvent) {
    const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[data-menu-item]:not(:disabled)") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
      buttons[index < 0 && event.key === "ArrowUp" ? buttons.length - 1 : next]?.focus();
    } else if (event.key === "ArrowRight" && (document.activeElement as HTMLElement | null)?.dataset.group) {
      event.preventDefault(); setGroup((document.activeElement as HTMLElement).dataset.group ?? null);
      requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>("[data-sub-item]:not(:disabled)")?.focus());
    } else if (event.key === "ArrowLeft" && group && (document.activeElement as HTMLElement | null)?.hasAttribute("data-sub-item")) {
      event.preventDefault(); const back = group; setGroup(null);
      requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`[data-group="${back}"]`)?.focus());
    }
  }
  const row = "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";
  const sub = (heading: string, list: MenuItem[]) => list.length > 0 && <div role="group" aria-label={heading} className="space-y-0.5">
    <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">{heading}</p>
    {list.map((item) => <button key={item.id} type="button" data-sub-item data-menu-item disabled={isUsed(item)} className={row} onClick={() => pick(item)}>
      {(() => { const Icon = groupIcon[item.mapTo ? "crm" : menuGroups.find((g) => g.items.includes(item))?.id ?? "short"]; return <Icon className="size-4 text-muted-foreground" aria-hidden="true" />; })()}
      <span className="min-w-0 flex-1 truncate">{t(`items.${item.id}`)}</span></button>)}
  </div>;
  return <Popover open={open} onOpenChange={reset}>
    <PopoverTrigger asChild>
      <Button type="button" variant="secondary" disabled={disabled} className={cn("min-h-12 w-full rounded-xl text-base", !full && "max-w-3xl")} data-add-question><Plus aria-hidden="true" />{t("add")}</Button>
    </PopoverTrigger>
    <PopoverContent align="center" className="w-[min(94vw,38rem)] p-0" onKeyDown={keys} data-add-question-menu>
      <div ref={root} className="flex max-h-[min(70vh,28rem)] flex-col">
        <div className="flex items-center gap-2 border-b px-3"><Search className="size-4 text-muted-foreground" aria-hidden="true" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" /></div>
        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-2 md:divide-x">
          {query.trim() ? <div className="space-y-0.5 p-2 md:col-span-2" role="group" aria-label={t("results")}>
            {flat.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">{t("noResults")}</p>}
            {flat.map(({ item, group: gid }) => <button key={item.id} type="button" data-menu-item disabled={isUsed(item)} className={row} onClick={() => pick(item)}>
              {(() => { const Icon = groupIcon[item.mapTo ? "crm" : gid]; return <Icon className="size-4 text-muted-foreground" aria-hidden="true" />; })()}
              <span className="min-w-0 flex-1 truncate">{t(`items.${item.id}`)}</span><span className="text-xs text-muted-foreground">{t(`groups.${item.mapTo ? "crm" : gid}`)}</span></button>)}
          </div> : <>
            <div className={cn("space-y-0.5 p-2", current && "max-md:hidden")}>
              <p className="px-3 pt-1 text-xs font-medium text-muted-foreground">{t("types")}</p>
              {menuGroups.filter((g) => g.id !== "layout").map((g) => { const Icon = groupIcon[g.id]; return <button key={g.id} type="button" data-menu-item data-group={g.id} aria-expanded={group === g.id}
                className={cn(row, group === g.id && "bg-accent")} onClick={() => setGroup(g.id)} onMouseEnter={() => setGroup(g.id)}>
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{t(`groups.${g.id}`)}</span><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></button>; })}
              <p className="px-3 pt-3 text-xs font-medium text-muted-foreground">{t("layout")}</p>
              {menuGroups.find((g) => g.id === "layout")!.items.map((item) => <button key={item.id} type="button" data-menu-item className={row} onClick={() => pick(item)}>
                <Layers className="size-4 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{t(`items.${item.id}`)}</span></button>)}
            </div>
            {current && current.id !== "layout" ? <div className="space-y-1 p-2" data-submenu={current.id}>
              <Button type="button" variant="ghost" className="min-h-11 md:hidden" onClick={() => setGroup(null)}><ChevronLeft aria-hidden="true" />{t("back")}</Button>
              {sub(t("newQuestion"), current.items.filter((item) => !item.mapTo))}
              {sub(t("saveToCrm"), current.items.filter((item) => item.mapTo))}
            </div> : <div className="hidden p-2 md:block" aria-hidden="true" />}
          </>}
        </div>
      </div>
    </PopoverContent>
  </Popover>;
}
