import { httpsUrl, type EmailDocument } from "./blocks";

export type CheckLevel = "pass" | "warn" | "fail";
export type InboxCheck = { id: "subject" | "preview" | "address" | "unsubscribe" | "imageAlt" | "links" | "content"; level: CheckLevel; count?: number };

/** Simple deterministic checks, run locally. No external service sees the message. */
export function inboxCheck(input: { subject: string; preheader: string | null | undefined; doc: EmailDocument }): InboxCheck[] {
  const subject = input.subject.trim(), { doc } = input;
  const checks: InboxCheck[] = [];
  checks.push({ id: "subject", level: !subject ? "fail" : subject.length > 60 ? "warn" : "pass" });
  checks.push({ id: "preview", level: input.preheader?.trim() ? "pass" : "warn" });
  checks.push({ id: "address", level: doc.brand.address.trim() ? "pass" : "fail" });
  // The unsubscribe link is appended by the renderer to every message; the check records that it cannot be missing.
  checks.push({ id: "unsubscribe", level: "pass" });
  const missingAlt = doc.blocks.filter(block => (block.type === "hero" || block.type === "imageText" ? block.imageUrl && !block.alt.trim()
    : block.type === "video" ? block.thumbnailUrl && !block.alt.trim() : false)).length;
  checks.push({ id: "imageAlt", level: missingAlt ? "warn" : "pass", count: missingAlt });
  let broken = 0;
  for (const block of doc.blocks) {
    if (block.type === "hero" || block.type === "event" || block.type === "giving") { if (block.buttonLabel.trim() && !httpsUrl(block.buttonUrl)) broken++; }
    else if (block.type === "social") broken += block.links.filter(link => link.label.trim() && !httpsUrl(link.url)).length;
  }
  checks.push({ id: "links", level: broken ? "fail" : "pass", count: broken });
  const hasWords = doc.blocks.some(block => block.type === "text" ? block.doc.content.length > 0 : block.type === "hero" ? !!block.heading.trim() : block.type === "quote" ? !!block.text.trim() : block.type !== "header" && block.type !== "divider" && block.type !== "spacer" && block.type !== "footer");
  checks.push({ id: "content", level: hasWords ? "pass" : "fail" });
  return checks;
}
export const inboxReady = (checks: readonly InboxCheck[]) => checks.every(check => check.level !== "fail");
