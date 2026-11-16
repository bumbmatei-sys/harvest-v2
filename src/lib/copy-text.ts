/** Outcome of a copy attempt; the caller shows a toast for either. */
export type CopyResult = "copied" | "failed";
type ClipboardLike = { writeText?: (text: string) => Promise<void> } | undefined;

/**
 * Copies text to the clipboard. Uses the async Clipboard API when the page may use it (secure context)
 * and falls back to a temporary textarea otherwise; never throws. The clipboard is injectable for tests.
 */
export async function copyText(text: string, clipboard: ClipboardLike = typeof navigator === "undefined" ? undefined : navigator.clipboard): Promise<CopyResult> {
  if (!text) return "failed";
  try {
    if (clipboard?.writeText) { await clipboard.writeText(text); return "copied"; }
  } catch { /* fall through to the textarea fallback */ }
  return legacyCopy(text) ? "copied" : "failed";
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const area = document.createElement("textarea");
  area.value = text; area.setAttribute("readonly", ""); area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed"; area.style.opacity = "0"; area.style.pointerEvents = "none";
  document.body.appendChild(area);
  try { area.select(); return document.execCommand("copy"); } catch { return false; } finally { area.remove(); }
}

/** `mailto:` and `tel:` targets for a stored identifier; whitespace and separators are not valid in a `tel:` number. */
export function mailtoHref(email: string): string { return `mailto:${email.trim()}`; }
export function telHref(phone: string): string { return `tel:${phone.replace(/[^\d+]/g, "")}`; }
