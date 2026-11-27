// A lesson video is a link the owner pastes. The server parses it to an allow-listed provider and the provider's video id and stores only those;
// the learner's page builds the privacy-friendly embed address from them. Nothing else from the link (its host, path, query or any HTML) is kept.
export const videoProviders = ["youtube", "vk"] as const;
export type VideoProvider = (typeof videoProviders)[number];
export type LessonVideo = { provider: VideoProvider; id: string };

/** The only hosts the learner's page ever frames. */
export const videoEmbedHosts = ["www.youtube-nocookie.com", "vkvideo.ru"] as const;

const youtubeId = /^[A-Za-z0-9_-]{11}$/;
const vkOwner = /^-?[0-9]{1,19}$/, vkVideo = /^[0-9]{1,19}$/, vkHash = /^[A-Za-z0-9]{1,32}$/;
export const vkVideoId = /^-?[0-9]{1,19}_[0-9]{1,19}(_[A-Za-z0-9]{1,32})?$/;
const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const nocookieHosts = new Set(["youtube-nocookie.com", "www.youtube-nocookie.com"]);
const vkHosts = new Set(["vk.com", "www.vk.com", "m.vk.com", "vkvideo.ru", "www.vkvideo.ru", "m.vkvideo.ru"]);

const youtube = (id: string | null | undefined): LessonVideo | null => (id && youtubeId.test(id) ? { provider: "youtube", id } : null);
function vk(owner: string | null, video: string | null, hash?: string | null): LessonVideo | null {
  if (!owner || !video || !vkOwner.test(owner) || !vkVideo.test(video)) return null;
  if (hash && !vkHash.test(hash)) return null;
  return { provider: "vk", id: hash ? `${owner}_${video}_${hash}` : `${owner}_${video}` };
}
/** One path segment after a fixed prefix, with an optional trailing slash: `/embed/ID` or `/embed/ID/`. */
function segment(path: string, prefix: string) {
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length).replace(/\/$/, "");
  return rest && !rest.includes("/") ? rest : null;
}

/**
 * Parses a pasted video link to its provider and id, or null when it is not one of the accepted forms: youtube.com/watch?v=, youtu.be/,
 * youtube.com/embed/, youtube-nocookie.com/embed/, vk.com/video<owner>_<id>, vkvideo.ru/video<owner>_<id> and the video_ext.php embed form of both.
 * Only http(s), no credentials or port, and no other host (javascript:, data:, look-alike hosts and everything else answer null).
 */
export function parseVideoLink(raw: unknown): LessonVideo | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(text)) return null;
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase(), path = url.pathname;
  if (youtubeHosts.has(host)) {
    if (path === "/watch" || path === "/watch/") return youtube(url.searchParams.get("v"));
    return youtube(segment(path, "/embed/"));
  }
  if (nocookieHosts.has(host)) return youtube(segment(path, "/embed/"));
  if (host === "youtu.be") return youtube(segment(path, "/"));
  if (vkHosts.has(host)) {
    if (path === "/video_ext.php") return vk(url.searchParams.get("oid"), url.searchParams.get("id"), url.searchParams.get("hash"));
    const match = /^\/video(-?[0-9]{1,19})_([0-9]{1,19})\/?$/.exec(path);
    return match ? vk(match[1], match[2]) : null;
  }
  return null;
}

/** True when a stored provider and id are well formed (the database checks the same). */
export function validVideo(video: { provider: string; id: string } | null | undefined): video is LessonVideo {
  if (!video) return false;
  if (video.provider === "youtube") return youtubeId.test(video.id);
  if (video.provider === "vk") return vkVideoId.test(video.id);
  return false;
}

function vkParts(id: string) {
  const [owner, video, hash] = id.split("_");
  return { owner, video, hash };
}
/** A canonical link for the owner's editor: the same video, in one stable form. */
export function videoLink(video: LessonVideo) {
  if (video.provider === "youtube") return `https://youtu.be/${video.id}`;
  const { owner, video: id, hash } = vkParts(video.id);
  return hash ? `https://vkvideo.ru/video_ext.php?oid=${owner}&id=${id}&hash=${hash}` : `https://vkvideo.ru/video${owner}_${id}`;
}
/** The privacy-friendly embed address the learner's page frames after the play press (no cookies before play for YouTube; VK's embed page). */
export function videoEmbedUrl(video: LessonVideo) {
  if (!validVideo(video)) return null;
  if (video.provider === "youtube") return `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`;
  const { owner, video: id, hash } = vkParts(video.id);
  const query = new URLSearchParams({ oid: owner, id, ...(hash ? { hash } : {}), autoplay: "1" });
  return `https://vkvideo.ru/video_ext.php?${query.toString()}`;
}
