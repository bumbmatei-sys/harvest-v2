"use client";
/* eslint-disable @next/next/no-img-element -- pictures are short signed redirects from the server, not optimisable */
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { ImageIcon, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useFileUrl } from "@/components/blog/use-file-url";

/**
 * The blog's picture block: a ready picture from the ministry's Files, by id, with a short description. The editor shows it through a short signed
 * address; the public page through /blog/<handle>/images/<id>. The JSON shape is checked by `sanitizeBlogBody` (src/lib/blog.ts).
 */
export function blogImageNode(tenantId: string) {
  return Node.create({
    name: "blogImage", group: "block", atom: true, selectable: true, draggable: true,
    addAttributes() { return { fileId: { default: null }, alt: { default: "" } }; },
    parseHTML() { return [{ tag: "figure[data-blog-image]", getAttrs: (el) => ({ fileId: (el as HTMLElement).getAttribute("data-file-id"), alt: (el as HTMLElement).getAttribute("data-alt") ?? "" }) }]; },
    renderHTML({ HTMLAttributes, node }) { return ["figure", mergeAttributes(HTMLAttributes, { "data-blog-image": "", "data-file-id": String(node.attrs.fileId ?? ""), "data-alt": String(node.attrs.alt ?? "") })]; },
    renderText({ node }) { return String(node.attrs.alt ?? ""); },
    addNodeView() { return ReactNodeViewRenderer((props: ReactNodeViewProps) => <BlogImageView {...props} tenantId={tenantId} />); },
  });
}

function BlogImageView({ node, updateAttributes, deleteNode, editor, selected, tenantId }: ReactNodeViewProps & { tenantId: string }) {
  const t = useTranslations("Blog");
  const fileId = typeof node.attrs.fileId === "string" ? node.attrs.fileId : null, { url, failed } = useFileUrl(tenantId, fileId);
  const editable = editor.isEditable;
  return <NodeViewWrapper as="figure" className={`my-4 space-y-2 rounded-lg ${selected ? "ring-2 ring-ring" : ""}`} data-blog-image="">
    <div className="relative overflow-hidden rounded-lg border bg-muted" contentEditable={false}>
      {url ? <img src={url} alt={String(node.attrs.alt ?? "")} className="mx-auto max-h-[28rem] w-auto object-contain" />
        : <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><ImageIcon className="size-4" aria-hidden="true" />{failed ? t("pictureUnavailable") : t("pictureLoading")}</div>}
      {editable && <button type="button" onClick={() => deleteNode()} aria-label={t("removePicture")}
        className="absolute end-2 top-2 inline-flex size-11 items-center justify-center rounded-md bg-background/90 text-foreground shadow-sm hover:bg-background lg:size-8"><X className="size-4" aria-hidden="true" /></button>}
    </div>
    {editable && <Input contentEditable={false} value={String(node.attrs.alt ?? "")} maxLength={200} aria-label={t("pictureAlt")} placeholder={t("pictureAlt")} className="min-h-11 lg:min-h-9"
      onChange={(event) => updateAttributes({ alt: event.target.value })} onKeyDown={(event) => event.stopPropagation()} />}
  </NodeViewWrapper>;
}
