"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Heading3, Italic, Link as LinkIcon, List, ListOrdered, Quote, Strikethrough, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { safeHref, type RichDoc } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

/**
 * Shared Harvest rich-text editor (Tiptap). Only the allow-listed formats are available: headings 2–3, bold, italic,
 * strike, lists, quotes and links. Output is JSON; the server sanitizes it again before saving.
 */
export function RichTextEditor({ value, onChange, label, disabled = false }: { value: RichDoc | null; onChange: (doc: RichDoc) => void; label: string; disabled?: boolean }) {
  const t = useTranslations("RichText");
  const editor = useEditor({
    immediatelyRender: false, editable: !disabled,
    extensions: [StarterKit.configure({
      code: false, codeBlock: false, horizontalRule: false, heading: { levels: [2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["http", "https", "mailto"],
        HTMLAttributes: { rel: "nofollow noopener noreferrer ugc", target: "_blank" } },
    })],
    content: value ?? undefined,
    editorProps: { attributes: { "aria-label": label, role: "textbox", "aria-multiline": "true",
      class: "min-h-40 max-h-[60dvh] overflow-y-auto rounded-b-md px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_a]:underline [&_p]:my-1" } },
    onUpdate: ({ editor: current }) => onChange(current.getJSON() as RichDoc),
  });
  const state = useEditorState({ editor, selector: ({ editor: e }) => e ? {
    h2: e.isActive("heading", { level: 2 }), h3: e.isActive("heading", { level: 3 }), bold: e.isActive("bold"), italic: e.isActive("italic"),
    strike: e.isActive("strike"), bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), quote: e.isActive("blockquote"), link: e.isActive("link"),
  } : null });
  const [href, setHref] = useState(""), [linkOpen, setLinkOpen] = useState(false);
  if (!editor) return <div className="min-h-48 rounded-md border" aria-busy="true" />;
  const chain = () => editor.chain().focus();
  const tool = (key: keyof NonNullable<typeof state>, Icon: typeof Bold, run: () => void) =>
    <Button key={key} type="button" variant="ghost" size="icon" className={cn("size-11", state?.[key] && "bg-muted")} aria-label={t(key)} aria-pressed={Boolean(state?.[key])} disabled={disabled} onClick={run}><Icon aria-hidden="true" /></Button>;
  function applyLink() {
    const safe = safeHref(href.trim()) ?? safeHref(`https://${href.trim()}`);
    if (safe) chain().extendMarkRange("link").setLink({ href: safe }).run();
    setLinkOpen(false); setHref("");
  }
  return <div className="rounded-md border focus-within:ring-2 focus-within:ring-ring">
    <div role="toolbar" aria-label={t("toolbar")} className="flex flex-wrap items-center gap-0.5 border-b p-1">
      {tool("h2", Heading2, () => chain().toggleHeading({ level: 2 }).run())}
      {tool("h3", Heading3, () => chain().toggleHeading({ level: 3 }).run())}
      {tool("bold", Bold, () => chain().toggleBold().run())}
      {tool("italic", Italic, () => chain().toggleItalic().run())}
      {tool("strike", Strikethrough, () => chain().toggleStrike().run())}
      {tool("bullet", List, () => chain().toggleBulletList().run())}
      {tool("ordered", ListOrdered, () => chain().toggleOrderedList().run())}
      {tool("quote", Quote, () => chain().toggleBlockquote().run())}
      {state?.link
        ? <Button type="button" variant="ghost" size="icon" className="size-11 bg-muted" aria-label={t("unlink")} disabled={disabled} onClick={() => chain().unsetLink().run()}><Unlink aria-hidden="true" /></Button>
        : <Popover open={linkOpen} onOpenChange={setLinkOpen}>
          <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("link")} disabled={disabled}><LinkIcon aria-hidden="true" /></Button></PopoverTrigger>
          <PopoverContent className="w-80 space-y-2">
            <Input className="min-h-11" value={href} placeholder={t("linkPlaceholder")} aria-label={t("linkAddress")} onChange={(e) => setHref(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } }} />
            <Button type="button" className="min-h-11 w-full" disabled={!href.trim()} onClick={applyLink}>{t("addLink")}</Button>
          </PopoverContent>
        </Popover>}
    </div>
    <EditorContent editor={editor} />
  </div>;
}
