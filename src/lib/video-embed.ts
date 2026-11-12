// Video links in posts (Communities PR 4b). Links from the two largest video platforms become privacy-enhanced embed
// URLs (no cookies / do-not-track); any other https link is shown as a link card. Copy stays provider-neutral.
export type VideoEmbed = { kind: "embed"; src: string } | { kind: "link"; href: string };
export const embedHosts = ["www.youtube-nocookie.com", "player.vimeo.com"] as const;
const youtubeId = /^[A-Za-z0-9_-]{11}$/, vimeoId = /^\d{1,12}$/;

export function videoEmbed(raw: string): VideoEmbed | null {
  if (!raw || raw.length > 500) return null;
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^(www|m)\./, ""), path = url.pathname.split("/").filter(Boolean);
  let id: string | undefined;
  if (host === "youtube.com") id = path[0] === "watch" ? url.searchParams.get("v") ?? undefined : ["shorts", "embed"].includes(path[0]) ? path[1] : undefined;
  else if (host === "youtu.be") id = path[0];
  if (id && youtubeId.test(id)) return { kind: "embed", src: `https://www.youtube-nocookie.com/embed/${id}` };
  const vimeo = host === "vimeo.com" ? path[0] : host === "player.vimeo.com" && path[0] === "video" ? path[1] : undefined;
  if (vimeo && vimeoId.test(vimeo)) return { kind: "embed", src: `https://player.vimeo.com/video/${vimeo}?dnt=1` };
  return { kind: "link", href: url.toString() };
}
