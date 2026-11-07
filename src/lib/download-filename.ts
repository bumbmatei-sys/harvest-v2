/** Treat a download name as a label, never a client-supplied path. */
export function downloadDisposition(name: string) {
  const safe = name.toWellFormed()
    // Control, bidi and other invisible format characters become "_"; ZWNJ/ZWJ stay because Persian,
    // Indic and emoji-sequence names need them and they cannot alter a header or path boundary.
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, (char) => (char === "\u200c" || char === "\u200d" ? char : "_"))
    .replace(/[/\\:"<>|?*%]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  const filename = /[^_\s]/u.test(safe) ? safe : "download";
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
