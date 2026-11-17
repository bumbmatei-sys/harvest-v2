/** L1 rules: no fetch, provider SDK or rendering side effects. */
export const liveStates = ["draft", "scheduled", "live", "ended", "replay", "cancelled"] as const;
export type LiveState = typeof liveStates[number];
export const liveCommentsModes = ["held", "open", "off"] as const;
const hosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const videoId = /^[A-Za-z0-9_-]{11}$/;
export function parseLiveVideoUrl(input: string): string | null {
  // Reject normalization tricks, userinfo and encoded separators before URL parsing.
  if (input !== input.trim() || /[\s\\\u0000-\u001f\u007f]/.test(input)) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || !hosts.has(url.hostname) || url.username || url.password || url.port || url.hash) return null;
    let id: string | null = null;
    if (url.hostname === "youtu.be") {
      if (url.search) return null;
      id = url.pathname.slice(1);
    } else if (url.pathname === "/watch") {
      if ([...url.searchParams.keys()].length !== 1 || !url.searchParams.has("v")) return null;
      id = url.searchParams.get("v");
    } else {
      if (url.search) return null;
      id = /^\/(?:live|embed|shorts)\/([A-Za-z0-9_-]{11})$/.exec(url.pathname)?.[1] ?? null;
    }
    return id && videoId.test(id) ? id : null;
  } catch { return null; }
}
export function liveEmbedUrl(id: string): string {
  if (!videoId.test(id)) throw new RangeError();
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&modestbranding=1`;
}
export function liveTransitionAllowed(from: LiveState, to: LiveState): boolean {
  return from === to || ({ draft: ["scheduled", "cancelled"], scheduled: ["live", "cancelled"], live: ["ended"], ended: ["replay"], replay: ["ended"], cancelled: [] } as Record<LiveState, LiveState[]>)[from].includes(to);
}
export function liveInWindow(state: LiveState, start: Date, ended: Date | null, now: Date): boolean {
  return state === "replay" || (["scheduled", "live", "ended"].includes(state) && now.getTime() >= start.getTime() - 86400000 && now.getTime() <= (ended ?? start).getTime() + 7 * 86400000);
}
export function liveAutoCloseDue(state: LiveState, started: Date | null, now: Date): boolean {
  return state === "live" && started !== null && now.getTime() >= started.getTime() + 12 * 3600000;
}
