import { Fragment, type ReactNode } from "react";
import { sanitizeRichText, type RichBlock, type RichInline, type RichMark } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

/**
 * Shared renderer for Harvest rich text. Renders React elements from the allow-listed JSON: user content is never
 * injected as HTML. Content is re-validated here too, so anything stored outside the editor still renders safely.
 */
export function RichTextView({ doc, className }: { doc: unknown; className?: string }) {
  const clean = sanitizeRichText(doc);
  if (!clean) return null;
  return <div className={cn("space-y-3 break-words text-[15px] leading-relaxed", className)}>{clean.content.map((block, i) => <Block key={i} block={block} />)}</div>;
}

function Block({ block }: { block: RichBlock }): ReactNode {
  switch (block.type) {
    case "paragraph": return <p className="min-h-[1lh]">{inline(block.content)}</p>;
    case "heading": return block.attrs.level === 2 ? <h2 className="pt-2 text-lg font-semibold">{inline(block.content)}</h2> : <h3 className="pt-1 text-base font-semibold">{inline(block.content)}</h3>;
    case "bulletList": return <ul className="list-disc space-y-1 pl-6">{block.content.map((item, i) => <li key={i}>{item.content.map((b, j) => <Block key={j} block={b} />)}</li>)}</ul>;
    case "orderedList": return <ol start={block.attrs?.start} className="list-decimal space-y-1 pl-6">{block.content.map((item, i) => <li key={i}>{item.content.map((b, j) => <Block key={j} block={b} />)}</li>)}</ol>;
    case "blockquote": return <blockquote className="border-l-2 pl-4 text-muted-foreground">{block.content.map((b, i) => <Block key={i} block={b} />)}</blockquote>;
  }
}

function inline(content?: RichInline[]) {
  return (content ?? []).map((node, i) => node.type === "hardBreak" ? <br key={i} /> : <Fragment key={i}>{(node.marks ?? []).reduceRight<ReactNode>(wrap, node.text)}</Fragment>);
}
function wrap(children: ReactNode, mark: RichMark): ReactNode {
  switch (mark.type) {
    case "bold": return <strong>{children}</strong>;
    case "italic": return <em>{children}</em>;
    case "strike": return <s>{children}</s>;
    case "underline": return <u>{children}</u>;
    case "link": return <a href={mark.attrs.href} target="_blank" rel="nofollow noopener noreferrer ugc" className="font-medium underline underline-offset-4">{children}</a>;
  }
}
