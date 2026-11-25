"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { filterSlash, slashSections, type PageActions, type SlashItem } from "@/components/docs/editor/slash-items";

type ListProps = SuggestionProps<SlashItem, SlashItem> & { listId: string };
type ListHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean };

const swatchClass: Record<string, string> = { info: "bg-primary/20", success: "bg-success-tint", warning: "bg-warning-tint", danger: "bg-destructive/20" };
export const slashLabel = (t: ReturnType<typeof useTranslations>, item: SlashItem) => t(`slash.${item.id}` as "slash.h1");

/** The slash menu: sections of blocks in two columns, filtered by what is typed after "/", moved with the arrow keys, chosen with Enter or a click. */
const SlashList = forwardRef<ListHandle, ListProps>(function SlashList({ items, command, listId }, ref) {
  const t = useTranslations("Docs");
  const [index, setIndex] = useState(0), box = useRef<HTMLDivElement>(null);
  useEffect(() => { setIndex(0); }, [items]);
  useEffect(() => { box.current?.querySelector(`[data-slash-index="${index}"]`)?.scrollIntoView({ block: "nearest" }); }, [index]);
  useImperativeHandle(ref, () => ({ onKeyDown: ({ event }) => {
    if (!items.length) return false;
    const move = (to: number) => { setIndex((to + items.length) % items.length); return true; };
    if (event.key === "ArrowDown") return move(index + 2 > items.length - 1 && index % 2 === 0 ? index + 1 : index + 2);
    if (event.key === "ArrowUp") return move(index - 2);
    if (event.key === "ArrowRight") return move(index + 1);
    if (event.key === "ArrowLeft") return move(index - 1);
    if (event.key === "Enter" || event.key === "Tab") { command(items[index]); return true; }
    return false;
  } }), [items, index, command]);
  if (!items.length) return <div id={listId} role="listbox" aria-label={t("slashMenu")} className="w-72 rounded-lg border bg-popover p-3 text-sm text-muted-foreground shadow-md">{t("slashNone")}</div>;
  return <div ref={box} id={listId} role="listbox" tabIndex={0} aria-label={t("slashMenu")} data-slash-menu className="max-h-80 w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-md">
    {slashSections.map((section) => {
      const rows = items.map((item, i) => ({ item, i })).filter((row) => row.item.section === section);
      if (!rows.length) return null;
      return <div key={section} role="group" aria-label={t(`slashSection.${section}`)}>
        <p className="px-2 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground" aria-hidden="true">{t(`slashSection.${section}`)}</p>
        <div className="grid gap-0.5 sm:grid-cols-2">{rows.map(({ item, i }) => <div key={item.id} id={`${listId}-${item.id}`} role="option" aria-selected={i === index} data-slash-index={i} data-slash-item={item.id}
          className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm", i === index ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")}
          onMouseEnter={() => setIndex(i)} onMouseDown={(e) => { e.preventDefault(); command(item); }}>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background"><item.icon className="size-4" aria-hidden="true" /></span>
          {item.swatch && (item.section === "colors" || item.section === "highlights" || item.section === "badges") && <span className="size-3 shrink-0 rounded-full border" style={{ background: item.swatch }} aria-hidden="true" />}
          {item.swatch && item.section === "text" && <span className={cn("size-3 shrink-0 rounded-full border", swatchClass[item.swatch])} aria-hidden="true" />}
          <span className="min-w-0 truncate">{slashLabel(t, item)}</span></div>)}</div>
      </div>;
    })}
  </div>;
});

const key = new PluginKey("docsSlash");
export type SlashOptions = { actions: PageActions; labelOf: (item: SlashItem) => string };
/** "/" opens the block menu. Not offered inside a code block. */
export const SlashCommand = Extension.create<SlashOptions>({
  name: "docsSlash",
  addOptions() { return { actions: { newPage: () => {}, insert: () => {} }, labelOf: (item) => item.id }; },
  addProseMirrorPlugins() {
    const options = this.options, editor = this.editor;
    return [Suggestion<SlashItem, SlashItem>({
      editor, pluginKey: key, char: "/", allowSpaces: false, startOfLine: false,
      allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
      items: ({ query }) => filterSlash(query, options.labelOf),
      command: ({ editor: e, range, props }: { editor: Editor; range: Range; props: SlashItem }) => props.run(e, range, options.actions),
      render: () => {
        let renderer: ReactRenderer<ListHandle, ListProps> | null = null, host: HTMLDivElement | null = null;
        const listId = `docs-slash-${Math.random().toString(36).slice(2, 8)}`;
        const place = (props: SuggestionProps<SlashItem, SlashItem>) => {
          const rect = props.clientRect?.(); if (!host || !rect) return;
          const width = host.offsetWidth || 544, height = host.offsetHeight || 320;
          host.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
          host.style.top = `${rect.bottom + 8 + height > window.innerHeight && rect.top > height + 8 ? rect.top - height - 8 : rect.bottom + 8}px`;
        };
        const aria = (props: SuggestionProps<SlashItem, SlashItem> | null) => {
          const dom = editor.view.dom;
          if (!props) { dom.removeAttribute("aria-controls"); return; }
          dom.setAttribute("aria-controls", listId);
        };
        return {
          onStart: (props) => {
            host = document.createElement("div"); host.style.cssText = "position:fixed;z-index:60"; host.setAttribute("data-slash-host", ""); document.body.appendChild(host);
            renderer = new ReactRenderer(SlashList, { props: { ...props, listId }, editor: props.editor });
            host.appendChild(renderer.element); aria(props); requestAnimationFrame(() => place(props));
          },
          onUpdate: (props) => { renderer?.updateProps({ ...props, listId }); requestAnimationFrame(() => place(props)); },
          onKeyDown: (props) => renderer?.ref?.onKeyDown(props) ?? false,
          onExit: () => { renderer?.destroy(); host?.remove(); renderer = null; host = null; aria(null); },
        };
      },
    })];
  },
});
