"use client";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { CheckSquare, FileText, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { mentionKinds } from "@/lib/docs";

export type MentionItem = { kind: (typeof mentionKinds)[number]; id: string; label: string };
type ListProps = SuggestionProps<MentionItem, MentionItem> & { listId: string };
type ListHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean };
const icons = { person: UserRound, page: FileText, task: CheckSquare } as const;

/** The @ menu: people of the ministry, pages of this doc and tasks, filtered by what is typed. */
const MentionList = forwardRef<ListHandle, ListProps>(function MentionList({ items, command, listId }, ref) {
  const t = useTranslations("Docs");
  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex(0); }, [items]);
  useImperativeHandle(ref, () => ({ onKeyDown: ({ event }) => {
    if (!items.length) return false;
    if (event.key === "ArrowDown") { setIndex((index + 1) % items.length); return true; }
    if (event.key === "ArrowUp") { setIndex((index - 1 + items.length) % items.length); return true; }
    if (event.key === "Enter" || event.key === "Tab") { command(items[index]); return true; }
    return false;
  } }), [items, index, command]);
  if (!items.length) return <div id={listId} role="listbox" aria-label={t("mentionMenu")} className="w-64 rounded-lg border bg-popover p-3 text-sm text-muted-foreground shadow-md">{t("mentionNone")}</div>;
  return <div id={listId} role="listbox" aria-label={t("mentionMenu")} data-mention-menu className="max-h-64 w-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
    {items.map((item, i) => { const Icon = icons[item.kind]; return <div key={`${item.kind}-${item.id}`} role="option" aria-selected={i === index} data-mention-item={item.kind}
      className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm", i === index ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")}
      onMouseEnter={() => setIndex(i)} onMouseDown={(e) => { e.preventDefault(); command(item); }}>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{item.label}</span><span className="text-xs text-muted-foreground">{t(`mentionKind.${item.kind}`)}</span></div>; })}
  </div>;
});

const key = new PluginKey("docsMention");
export type MentionOptions = { source: (query: string) => Promise<MentionItem[]> };
/** "@" opens the mention menu; choosing an entry inserts an inline mention (text only, nobody is notified). */
export const MentionCommand = Extension.create<MentionOptions>({
  name: "docsMention",
  addOptions() { return { source: async () => [] }; },
  addProseMirrorPlugins() {
    const options = this.options, editor = this.editor;
    return [Suggestion<MentionItem, MentionItem>({
      editor, pluginKey: key, char: "@", allowSpaces: false, startOfLine: false,
      allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
      items: ({ query }) => options.source(query),
      command: ({ editor: e, range, props }: { editor: Editor; range: Range; props: MentionItem }) => { e.chain().focus().deleteRange(range).insertContent([{ type: "mention", attrs: props }, { type: "text", text: " " }]).run(); },
      render: () => {
        let renderer: ReactRenderer<ListHandle, ListProps> | null = null, host: HTMLDivElement | null = null;
        const listId = `docs-mention-${Math.random().toString(36).slice(2, 8)}`;
        const place = (props: SuggestionProps<MentionItem, MentionItem>) => {
          const rect = props.clientRect?.(); if (!host || !rect) return;
          const height = host.offsetHeight || 200;
          host.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - (host.offsetWidth || 288) - 8))}px`;
          host.style.top = `${rect.bottom + 8 + height > window.innerHeight && rect.top > height + 8 ? rect.top - height - 8 : rect.bottom + 8}px`;
        };
        return {
          onStart: (props) => { host = document.createElement("div"); host.style.cssText = "position:fixed;z-index:60"; host.setAttribute("data-mention-host", ""); document.body.appendChild(host);
            renderer = new ReactRenderer(MentionList, { props: { ...props, listId }, editor: props.editor }); host.appendChild(renderer.element); requestAnimationFrame(() => place(props)); },
          onUpdate: (props) => { renderer?.updateProps({ ...props, listId }); requestAnimationFrame(() => place(props)); },
          onKeyDown: (props) => renderer?.ref?.onKeyDown(props) ?? false,
          onExit: () => { renderer?.destroy(); host?.remove(); renderer = null; host = null; },
        };
      },
    })];
  },
});
