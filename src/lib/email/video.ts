import { httpsUrl } from "./blocks";

export type VideoLink = { kind: "youtube"; url: string; id: string } | { kind: "vk"; url: string } | { kind: "link"; url: string };

const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const vkHosts = new Set(["vk.com", "www.vk.com", "m.vk.com", "vkvideo.ru", "www.vkvideo.ru", "vk.ru", "www.vk.ru"]);
const youtubeId = /^[A-Za-z0-9_-]{11}$/;

/**
 * Reads a pasted video link. Only https links without credentials count; two known hosts are recognised by an exact host
 * allowlist (never a substring match), everything else is a plain link. No network access happens here.
 */
export function parseVideoLink(value: string): VideoLink | null {
  const href = httpsUrl(value.trim());
  if (!href) return null;
  const url = new URL(href), host = url.hostname.toLowerCase();
  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return youtubeId.test(id) ? { kind: "youtube", url: href, id } : { kind: "link", url: href };
  }
  if (youtubeHosts.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    const id = url.pathname === "/watch" ? url.searchParams.get("v") ?? "" : ["shorts", "embed", "live", "v"].includes(parts[0] ?? "") ? parts[1] ?? "" : "";
    return youtubeId.test(id) ? { kind: "youtube", url: href, id } : { kind: "link", url: href };
  }
  if (vkHosts.has(host)) return { kind: "vk", url: href };
  return { kind: "link", url: href };
}

/** The address a YouTube thumbnail would be fetched from, built only from a validated video id. Offered as a suggestion; never hotlinked in an email. */
export const youtubeThumbnailUrl = (id: string) => `https://img.youtube.com/vi/${youtubeId.test(id) ? id : ""}/hqdefault.jpg`;
