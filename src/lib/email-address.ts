// The From header with a display name: RFC 5322 quoting for names with special characters and RFC 2047 encoding for non-ASCII names. Pure; nothing here sends anything.
const atom = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/;
/** Longest encoded-word the standard allows is 75 characters, "=?UTF-8?B?" and "?=" included, so at most 63 base64 characters (45 bytes) of name per word. */
const maxBytesPerWord = 45;

function encodedWords(name: string): string {
  const words: string[] = [];
  let current: number[] = [];
  for (const char of name) {
    const bytes = [...new TextEncoder().encode(char)];
    if (current.length + bytes.length > maxBytesPerWord) { words.push(Buffer.from(current).toString("base64")); current = []; }
    current.push(...bytes);
  }
  if (current.length) words.push(Buffer.from(current).toString("base64"));
  return words.map((word) => `=?UTF-8?B?${word}?=`).join(" ");
}

/**
 * `Name <address>` for a header: control characters are dropped (a name can never add a header line), a name of plain words stays plain, one with specials such as a comma,
 * semicolon, dot, parenthesis or quote becomes a quoted string, and one with non-ASCII characters becomes RFC 2047 encoded words (split between characters, never inside one).
 * An empty name gives the bare address. The address must already be a bare, valid address.
 */
export function formatFromHeader(name: string | null | undefined, address: string): string {
  const clean = (name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return address;
  // eslint-disable-next-line no-control-regex
  if (/[^\u0000-\u007f]/.test(clean)) return `${encodedWords(clean)} <${address}>`;
  if (atom.test(clean)) return `${clean} <${address}>`;
  return `"${clean.replace(/[\\"]/g, "\\$&")}" <${address}>`;
}
