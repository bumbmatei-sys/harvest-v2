import type { DraftType, SocialPlatform } from "./platforms";

export const mediaRulesVersion = "2026-11-20";
export const socialMediaMimes = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/quicktime", "video/webm", "video/x-msvideo", "video/x-ms-wmv", "video/x-flv", "video/3gpp",
  "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip", "text/plain", "application/x-subrip", "text/vtt",
] as const;
export type MediaMime = typeof socialMediaMimes[number];
export type MediaKind = "image" | "video" | "gif" | "document";
export const mediaKind = (mime: string): MediaKind => mime === "image/gif" ? "gif" :
  mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "document";
export type MediaMetadata = { width?: number; height?: number; durationMs?: number };
export type ReadyMedia = MediaMetadata & { id: string; mime: string; size: number };

type FileRules = {
  formats: readonly MediaMime[]; maxBytes: number; max?: number; minMs?: number; maxMs?: number;
  ratio?: readonly [number, number]; ratios?: readonly number[]; minSize?: readonly [number, number]; maxSize?: readonly [number, number]; maxSideSum?: number;
};
export type MediaRules = {
  maxItems: number; minItems?: number; mixed?: boolean; files: Partial<Record<MediaKind, FileRules>>;
  cover?: FileRules; frame?: boolean; subtitles?: { maxTracks: number; maxBytes: number; englishOnly?: boolean };
};
const image = ["image/jpeg", "image/png"] as const;
const webImages = [...image, "image/webp"] as const;
const video = ["video/mp4", "video/quicktime"] as const;
const webVideos = [...video, "video/webm"] as const;
const gif = ["image/gif"] as const;
const document = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"] as const;
const mb = (n: number) => Math.floor(n * 1024 ** 2);
function file(formats: readonly MediaMime[], sizeMb: number, constraints: Omit<FileRules, "formats" | "maxBytes"> = {}): FileRules {
  return { formats, maxBytes: mb(sizeMb), ...constraints };
}
const instagramImage = file(image, 8, { ratio: [0.8, 1.91] });
const instagramVideo = file(video, 300, { maxMs: 60_000 });
const vertical = [9 / 16, 9 / 16] as const;
const discordImages = file(webImages, 20);
const subtitleRules = { maxTracks: 10, maxBytes: 1024 ** 2 };
const youtubeVideo = file([...webVideos, "video/x-msvideo", "video/x-ms-wmv", "video/x-flv", "video/3gpp"], 256 * 1024, { minMs: 1000, maxMs: 900_000 });
const empty: MediaRules = { maxItems: 0, files: {} };

export const platformMediaRules: Record<SocialPlatform, MediaRules> = {
  twitter: { maxItems: 4, files: { image: file(webImages, 5, { minSize: [4, 4], maxSize: [8192, 8192] }), gif: file(gif, 15, { max: 1, maxSize: [1280, 1080] }), video: file(video, 512, { max: 1, minMs: 500, minSize: [32, 32], maxSize: [1920, 1920] }) }, subtitles: { ...subtitleRules, maxTracks: 1 } },
  instagram: { minItems: 1, maxItems: 10, mixed: true, files: { image: instagramImage, video: instagramVideo } },
  facebook: { maxItems: 10, files: { image: file(webImages, 4), gif: file(gif, 4), video: file(video, 4096, { max: 1, minMs: 1000, maxMs: 14_400_000 }) }, cover: file(image, 10), subtitles: { ...subtitleRules, maxBytes: 200 * 1024 } },
  linkedin: { maxItems: 20, files: { image: file(image, 8, { minSize: [552, 276], maxSize: [8192, 8192] }), gif: file(gif, 8, { max: 1 }),
    video: file([...video, "video/x-msvideo"], 5120, { max: 1, minMs: 3000, maxMs: 600_000, ratio: [1 / 2.4, 2.4], minSize: [256, 144], maxSize: [4096, 2304] }),
    document: file(document, 100, { max: 1 }) }, cover: file(image, 10), subtitles: { ...subtitleRules, maxTracks: 1, englishOnly: true } },
  tiktok: { minItems: 1, maxItems: 35, files: { image: file(webImages, 20), video: file(webVideos, 4096, { max: 1, minMs: 3000, maxMs: 600_000 }) }, cover: file(webImages, 20), frame: true },
  youtube: { minItems: 1, maxItems: 1, files: { video: youtubeVideo }, cover: file([...image, ...gif], 2), subtitles: subtitleRules },
  pinterest: { minItems: 1, maxItems: 1, files: { image: file(webImages, 32, { minSize: [100, 100] }), gif: file(gif, 32, { minSize: [100, 100] }), video: file(video, 2048, { minMs: 4000, maxMs: 900_000, ratios: [2 / 3, 1, 9 / 16] }) }, cover: file(image, 32), frame: true },
  reddit: { maxItems: 20, files: { image: file(image, 20), gif: file(gif, 20, { max: 1 }), video: file(["video/mp4"], 1024, { max: 1 }) }, cover: file(image, 20) },
  bluesky: { maxItems: 4, files: { image: file(webImages, 1, { maxSize: [2000, 2000] }), gif: file(gif, 1, { maxSize: [2000, 2000] }), video: file(["video/mp4"], 50, { max: 1, maxMs: 60_000, maxSize: [1920, 1920] }) }, subtitles: { ...subtitleRules, maxBytes: 20 * 1024 } },
  threads: { maxItems: 20, mixed: true, files: { image: file(image, 8), video: file(["video/mp4"], 1024, { max: 1, maxMs: 300_000, ratios: [9 / 16, 16 / 9, 1] }) } },
  googlebusiness: { maxItems: 1, files: { image: file(image, 5, { minSize: [400, 300] }) } },
  telegram: { maxItems: 10, mixed: true, files: { image: file(webImages, 10, { maxSideSum: 10_000 }), gif: file(gif, 50, { max: 1 }),
    video: file(video, 50), document: file([...document, "application/zip", "text/plain"], 50) } },
  discord: { maxItems: 10, mixed: true, files: { image: discordImages, video: file(["video/mp4"], 20), gif: file(gif, 20),
    document: file([...document, "application/zip", "text/plain"], 20) } },
  slack: { maxItems: 10, mixed: true, files: { image: file(webImages, 1024), video: file(webVideos, 1024), gif: file(gif, 1024),
    document: file([...document, "application/zip", "text/plain"], 1024) } },
  snapchat: empty, whatsapp: empty, wordpress: empty, shopify: empty, wix: empty, webflow: empty,
  rcs: empty, imessage: empty, line: empty, wechat: empty, sms: empty,
};

export function mediaRulesFor(platform: SocialPlatform, type: DraftType, format?: "reel" | "short"): MediaRules | null {
  if (type === "article") return platform === "twitter" ? { ...empty, cover: file(webImages, 5) } : null;
  if (type === "story") {
    if (platform === "instagram") return { maxItems: 1, minItems: 1, files: {
      image: file(image, 8), video: file(video, 100, { minMs: 3000, maxMs: 60_000, ratio: vertical }),
    } };
    if (platform === "facebook") return { maxItems: 1, minItems: 1, files: {
      image: file(image, 4), video: file(video, 4096, { minMs: 1000, maxMs: 120_000 }),
    } };
    return null;
  }
  if (format === "reel") {
    if (platform === "instagram") return { maxItems: 1, minItems: 1, files: { video: file(video, 300, { minMs: 3000, maxMs: 90_000, ratio: vertical }) },
      cover: file(image, 8), frame: true };
    if (platform === "facebook") return { maxItems: 1, minItems: 1, files: {
      video: file(video, 4096, { minMs: 3000, maxMs: 60_000, ratio: vertical }),
    }, cover: file(image, 10), subtitles: { ...subtitleRules, maxBytes: 200 * 1024 } };
    return null;
  }
  if (format === "short") return platform === "youtube" ? { maxItems: 1, minItems: 1, files: {
    video: { ...youtubeVideo, maxMs: 180_000, ratios: [9 / 16, 1] },
  }, cover: file([...image, ...gif], 2), subtitles: subtitleRules } : null;
  return platformMediaRules[platform];
}

export function mediaFileErrors(file: ReadyMedia, rule: FileRules | undefined) {
  if (!rule?.formats.some(mime => mime === file.mime)) return ["MEDIA_WRONG_TYPE"];
  const issues: string[] = [];
  if (file.size > rule.maxBytes) issues.push("MEDIA_TOO_LARGE");
  if (mediaKind(file.mime) === "video" && (!file.durationMs || !file.width || !file.height)) issues.push("MEDIA_METADATA_UNAVAILABLE");
  if (file.durationMs !== undefined) {
    if (rule.minMs && file.durationMs < rule.minMs) issues.push("MEDIA_TOO_SHORT");
    if (rule.maxMs && file.durationMs > rule.maxMs) issues.push("MEDIA_TOO_LONG");
  }
  const { width, height } = file;
  if (width && height) {
    if (rule.ratio && (width / height < rule.ratio[0] - 0.001 || width / height > rule.ratio[1] + 0.001)) issues.push("MEDIA_WRONG_ASPECT_RATIO");
    if (rule.ratios && !rule.ratios.some(ratio => Math.abs(width / height - ratio) <= 0.001)) issues.push("MEDIA_WRONG_ASPECT_RATIO");
    if ((rule.minSize && (width < rule.minSize[0] || height < rule.minSize[1])) ||
      (rule.maxSize && (width > rule.maxSize[0] || height > rule.maxSize[1])) ||
      (rule.maxSideSum && width + height > rule.maxSideSum)) issues.push("MEDIA_WRONG_RESOLUTION");
  } else if (rule.ratio || rule.ratios || rule.minSize || rule.maxSize || rule.maxSideSum) {
    issues.push("MEDIA_METADATA_UNAVAILABLE");
  }
  return issues;
}
