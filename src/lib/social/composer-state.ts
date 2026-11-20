import { platformCharacterCounters, type CharacterCount } from "./characters";
import type { ComposerInput, ComposerOptions } from "./composer";
import { mediaKind, mediaRulesFor, type MediaKind } from "./media";
import type { ConnectionView } from "./api";
import type { DraftType, SocialPlatform } from "./platforms";

/** An attachment in the composer. Only `ready` files go to the server: a file that is still uploading or was quarantined is never sent. */
export type Attachment = {
  key: string; fileId: string | null; name: string; mime: string; size: number; kind: MediaKind;
  width?: number; height?: number; durationMs?: number; previewUrl: string | null; altText: string;
  phase: "hashing" | "uploading" | "verifying" | "ready" | "failed" | "quarantined"; progress: number; error: string | null;
};
/** The option rows of the main page: each applies to every selected account that supports it (the platforms that do not are named on the row). */
export type SharedOptions = {
  firstCommentOn: boolean; firstComment: string; madeWithAi: boolean; linkUrl: string;
  repostOn: boolean; repostDays: string; stopKind: "count" | "date"; stopCopies: string; stopUntil: string;
};
export const emptyShared = (): SharedOptions => ({ firstCommentOn: false, firstComment: "", madeWithAi: false, linkUrl: "", repostOn: false, repostDays: "30", stopKind: "count", stopCopies: "3", stopUntil: "" });
/** Settings that belong to one platform and live in its "Each platform" panel. */
export type DestinationOptions = {
  format: "" | "reel" | "short"; title: string; subreddit: string; boardId: string; channelId: string;
  tiktokPrivacy: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY" | ""; tiktokConfirmed: boolean;
  coverTimeMs: number | null; coverFileId: string | null;
};
export type DestinationState = { custom: boolean; content: string; /** null: every attachment. */ mediaKeys: string[] | null; options: DestinationOptions };
export type ComposerState = {
  type: DraftType; content: string; connectionIds: string[]; attachments: Attachment[]; shared: SharedOptions;
  /** Per platform, as the draft API keys its variants. */
  destinations: Partial<Record<SocialPlatform, DestinationState>>;
};
export const emptyOptions = (): DestinationOptions => ({
  format: "", title: "", subreddit: "", boardId: "", channelId: "", tiktokPrivacy: "", tiktokConfirmed: false, coverTimeMs: null, coverFileId: null,
});
export const emptyDestination = (): DestinationState => ({ custom: false, content: "", mediaKeys: null, options: emptyOptions() });
export const emptyComposer = (type: DraftType = "post"): ComposerState => ({ type, content: "", connectionIds: [], attachments: [], shared: emptyShared(), destinations: {} });

export const destinationOf = (state: ComposerState, platform: SocialPlatform): DestinationState => state.destinations[platform] ?? emptyDestination();
export const destinationText = (state: ComposerState, platform: SocialPlatform) => { const own = destinationOf(state, platform); return own.custom ? own.content : state.content; };
export const destinationMedia = (state: ComposerState, platform: SocialPlatform) => {
  const keys = destinationOf(state, platform).mediaKeys;
  return state.attachments.filter(item => item.phase === "ready" && (keys === null || keys.includes(item.key)));
};
export const mediaMode = (items: readonly Pick<Attachment, "kind">[]) => items.some(item => item.kind === "video") ? "video" as const : items.length ? "image" as const : "none" as const;

/** The ring for one account: the shared per-platform counter, nothing else. */
export function ringFor(state: ComposerState, platform: SocialPlatform): CharacterCount {
  return platformCharacterCounters[platform](destinationText(state, platform), { type: state.type, media: mediaMode(destinationMedia(state, platform)) });
}
/** 0..1 share of the limit used; 0 when the limit is unknown. */
export const ringShare = (count: CharacterCount) => count.limit ? Math.min(1, count.used / count.limit) : 0;
export type RingTone = "ok" | "near" | "over" | "unknown";
export function ringTone(count: CharacterCount): RingTone {
  if (count.limit === null) return "unknown";
  if (count.used > count.limit) return "over";
  return count.limit > 0 && count.used / count.limit >= 0.85 ? "near" : "ok";
}

const hasText = (value: string) => value.trim().length > 0;
type Caps = Pick<ConnectionView, "platform" | "capabilities">;
/** Which shared option rows a platform takes, mirroring the server's rules so the row never sends something the destination would refuse. */
export function sharedSupport(connection: Caps, type: DraftType, mode: "none" | "image" | "video") {
  const caps = connection.capabilities, post = type === "post", platform = connection.platform;
  return {
    firstComment: post && caps.firstComment !== "unavailable",
    repost: post && caps.repost !== "unavailable",
    madeWithAi: post && caps.madeWithAi !== "unavailable" && !((platform === "twitter" || platform === "tiktok") && mode === "none") && !(platform === "tiktok" && mode !== "video"),
    link: post && caps.link === "target",
  };
}
export function buildOptions(connection: Caps, type: DraftType, shared: SharedOptions, raw: DestinationOptions, mode: "none" | "image" | "video"): ComposerOptions | undefined {
  const options: ComposerOptions = {}, platform = connection.platform, support = sharedSupport(connection, type, mode);
  if (hasText(raw.title)) options.title = raw.title.trim();
  if (support.firstComment && shared.firstCommentOn && hasText(shared.firstComment)) options.firstComment = shared.firstComment;
  if (support.madeWithAi && shared.madeWithAi) options.madeWithAi = true;
  if (support.link && hasText(shared.linkUrl)) options.linkUrl = shared.linkUrl.trim();
  if (raw.format) options.format = raw.format;
  if (hasText(raw.subreddit)) options.subreddit = raw.subreddit.trim();
  if (hasText(raw.boardId)) options.boardId = raw.boardId.trim();
  if (hasText(raw.channelId)) options.channelId = raw.channelId.trim();
  if (support.repost && shared.repostOn) {
    options.repost = { intervalDays: Number(shared.repostDays), stop: shared.stopKind === "count" ? { kind: "count", copies: Number(shared.stopCopies) } : { kind: "date", until: shared.stopUntil ? new Date(shared.stopUntil).toISOString() : "" } };
  }
  if (platform === "tiktok" && raw.tiktokPrivacy && raw.tiktokConfirmed) options.tiktok = { privacy: raw.tiktokPrivacy, confirmedPreview: true, consent: true };
  if (mode === "video" && raw.coverTimeMs !== null) options.coverTimeMs = raw.coverTimeMs;
  if (raw.coverFileId) options.coverFileId = raw.coverFileId;
  return Object.keys(options).length ? options : undefined;
}

/** The draft document for the server: ready attachments only, per-platform variants only where the person changed something. */
export function buildDocument(state: ComposerState, connections: readonly (Caps & { id: string })[]): ComposerInput {
  const media = (items: readonly Attachment[]) => items.flatMap(item => item.fileId ? [{ fileId: item.fileId, ...(item.altText.trim() ? { altText: item.altText.trim() } : {}) }] : []);
  const chosen = connections.filter(connection => state.connectionIds.includes(connection.id));
  const platforms = [...new Set(chosen.map(connection => connection.platform))];
  const variants: ComposerInput["variants"] = {};
  for (const platform of platforms) {
    const own = destinationOf(state, platform), items = destinationMedia(state, platform), connection = chosen.find(entry => entry.platform === platform)!;
    const options = buildOptions(connection, state.type, state.shared, own.options, mediaMode(items));
    const customMedia = own.mediaKeys !== null;
    if (own.custom || customMedia) variants[platform] = { mode: "custom", ...(own.custom ? { content: own.content } : {}), ...(customMedia ? { media: media(items) } : {}), ...(options ? { options } : {}) };
    else if (options) variants[platform] = { mode: "same", options };
  }
  return { type: state.type, content: state.content, media: media(state.attachments.filter(item => item.phase === "ready")), connectionIds: state.connectionIds, variants };
}

/** Whether the post can be sent for review: text or media, at least one destination, and nothing still uploading. */
export const uploading = (state: ComposerState) => state.attachments.some(item => item.phase === "hashing" || item.phase === "uploading" || item.phase === "verifying");

/** What a destination's media rules say about the number of items, for "3 / 4" style counters. */
export function itemLimit(connection: Pick<ConnectionView, "mediaCapabilities">, type: DraftType, format: DestinationOptions["format"]) {
  const rules = type === "story" ? connection.mediaCapabilities.story : type === "article" ? connection.mediaCapabilities.article
    : format === "reel" ? connection.mediaCapabilities.reel : format === "short" ? connection.mediaCapabilities.short : connection.mediaCapabilities.post;
  return rules ? rules.maxItems : null;
}
export { mediaKind, mediaRulesFor };

/** Restores the editor from a stored document. Attachments come back as placeholders: the draft stores file ids, not names or previews. */
export function stateFromDocument(document: ComposerInput): ComposerState {
  const state: ComposerState = { ...emptyComposer(document.type), content: document.content, connectionIds: [...document.connectionIds] };
  state.attachments = document.media.map((item, index) => ({ key: item.fileId, fileId: item.fileId, name: `Attachment ${index + 1}`, mime: "application/octet-stream", size: 0, kind: "document",
    previewUrl: null, altText: item.altText ?? "", phase: "ready", progress: 100, error: null }));
  for (const [platform, variant] of Object.entries(document.variants) as [SocialPlatform, NonNullable<ComposerInput["variants"][SocialPlatform]>][]) {
    const options = emptyOptions(), source = variant.options;
    if (source) {
      options.title = source.title ?? ""; options.format = source.format ?? ""; options.subreddit = source.subreddit ?? ""; options.boardId = source.boardId ?? ""; options.channelId = source.channelId ?? "";
      options.coverTimeMs = source.coverTimeMs ?? null; options.coverFileId = source.coverFileId ?? null;
      if (source.firstComment) { state.shared.firstCommentOn = true; state.shared.firstComment = source.firstComment; }
      if (source.madeWithAi) state.shared.madeWithAi = true;
      if (source.linkUrl) state.shared.linkUrl = source.linkUrl;
      if (source.repost) { state.shared.repostOn = true; state.shared.repostDays = String(source.repost.intervalDays);
        if (source.repost.stop.kind === "count") { state.shared.stopKind = "count"; state.shared.stopCopies = String(source.repost.stop.copies); } else { state.shared.stopKind = "date"; state.shared.stopUntil = source.repost.stop.until.slice(0, 10); } }
      if (source.tiktok) options.tiktokPrivacy = source.tiktok.privacy; // the confirmation is never restored: it is given again before each send
    }
    state.destinations[platform] = variant.mode === "custom"
      ? { custom: variant.content !== undefined, content: variant.content ?? "", mediaKeys: variant.media ? variant.media.map(item => item.fileId) : null, options }
      : { ...emptyDestination(), options };
  }
  return state;
}
