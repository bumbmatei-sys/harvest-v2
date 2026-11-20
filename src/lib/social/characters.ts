import type { DraftType, SocialPlatform } from "./platforms";

export type CharacterContext = { type?: DraftType; media?: "none" | "image" | "video"; premium?: boolean };
export type CharacterCount = { used: number; limit: number | null; remaining: number | null; rule: "documented" | "estimate" | "unavailable" };
type Counter = (text: string, context?: CharacterContext) => CharacterCount;

export const normalizeSocialText = (text: string) => text.replace(/\r\n?/g, "\n");

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (text: string) => Array.from(segmenter.segment(normalizeSocialText(text)), ({ segment }) => segment);
const codePoints = (text: string) => Array.from(normalizeSocialText(text)).length;
const count = (used: number, limit: number | null, rule: CharacterCount["rule"]): CharacterCount =>
  ({ used, limit, remaining: limit === null ? null : limit - used, rule });
const unavailable: Counter = text => count(codePoints(text), null, "unavailable");
const estimated = (limit: number): Counter => text => count(codePoints(text), limit, "estimate");

// X API weights NFC text and transforms recognized links to t.co length. Harvest handles HTTP(S) links
// and domain-only links. Edge cases in native URL extraction require sandbox parity before activation.
const xUrl = /(?:https?:\/\/[^\s<>"\u0000-\u0020]+|(?<![@\p{L}\p{N}])(?:[\p{L}\p{N}-]+\.)+(?:com|org|net|edu|gov|io|co|me|app|dev|info|uk|de|fr|ca|au|jp)\b(?:\/[^\s<>"]*)?)/giu;
function xWeight(text: string) {
  return graphemes(text).reduce((used, segment) => {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(segment)) return used + 2;
    for (const character of segment) {
      const point = character.codePointAt(0)!;
      used += point <= 0x10ff || (point >= 0x2000 && point <= 0x200d) ||
        (point >= 0x2010 && point <= 0x201f) || (point >= 0x2032 && point <= 0x2037) ? 1 : 2;
    }
    return used;
  }, 0);
}
const countTwitter: Counter = (text, context) => {
  if (context?.type === "article") return unavailable(text);
  const normalized = normalizeSocialText(text).normalize("NFC");
  let used = 0;
  let offset = 0;
  for (const match of normalized.matchAll(xUrl)) {
    const index = match.index;
    const candidate = match[0].replace(/[.,!?;:]+$/u, "");
    let url = candidate;
    while (url.endsWith(")") && url.split(")").length > url.split("(").length) url = url.slice(0, -1);
    used += xWeight(normalized.slice(offset, index)) + 23;
    offset = index + url.length;
  }
  return count(used + xWeight(normalized.slice(offset)), context?.premium ? 25_000 : 280, "estimate");
};
const countInstagram: Counter = (text, context) => context?.type === "story" ? count(codePoints(text), 0, "documented") : estimated(2200)(text);
const countFacebook: Counter = (text, context) => context?.type === "story" ? count(codePoints(text), 0, "documented") : estimated(63_206)(text);
const countTikTok: Counter = (text, context) => estimated(context?.media === "image" ? 4000 : 2200)(text);
const countTelegram: Counter = (text, context) => estimated(context?.media && context.media !== "none" ? 1024 : 4096)(text);

export const platformCharacterCounters: Record<SocialPlatform, Counter> = {
  twitter: countTwitter, instagram: countInstagram, facebook: countFacebook, linkedin: estimated(3000),
  tiktok: countTikTok, youtube: estimated(5000), pinterest: estimated(800), reddit: estimated(40_000),
  bluesky: text => count(graphemes(text).length, 300, "documented"), threads: estimated(500),
  googlebusiness: estimated(1500), telegram: countTelegram, snapchat: unavailable, whatsapp: unavailable,
  discord: estimated(2000), slack: estimated(40_000), wordpress: unavailable, shopify: unavailable,
  wix: unavailable, webflow: unavailable, rcs: unavailable, imessage: unavailable, line: unavailable, wechat: unavailable, sms: unavailable,
};
