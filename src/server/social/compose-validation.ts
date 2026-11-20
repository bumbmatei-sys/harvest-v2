import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Transaction } from "../../db/client";
import { files, socialConnections } from "../../db/schema";
import type { ComposerInput, ComposerOptions } from "../../lib/social/composer";
import { platformCharacterCounters } from "../../lib/social/characters";
import { mediaFileErrors, mediaKind, mediaRulesFor, mediaRulesVersion, type ReadyMedia } from "../../lib/social/media";
import { platformCapabilities, type DraftType, type SocialPlatform } from "../../lib/social/platforms";
import { unavailable } from "./publish-access";

type Connection = Pick<typeof socialConnections.$inferSelect, "id" | "platform" | "status" | "health" | "displayName" | "version">;
const normalizeTag = /(^|[^\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu;
const normalizeMention = /(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_.-]+/gu;
const mayUseFirstComment = (platform: SocialPlatform) => platformCapabilities[platform].firstComment === "supported";
export function destinationErrors(platform: SocialPlatform, type: DraftType, text: string, options: ComposerOptions | undefined, media: ReadyMedia[]) {
  const caps = platformCapabilities[platform];
  const mode = media.some(file => mediaKind(file.mime) === "video") ? "video" : media.length ? "image" : "none";
  const characters = platformCharacterCounters[platform](text, { type, media: mode });
  const errors: string[] = [];
  const warnings: string[] = [];
  if (caps.postTypes[type] === "unavailable") errors.push("UNSUPPORTED_POST_TYPE");
  if (caps.postTypes[type] === "conditional") warnings.push("ACCOUNT_ELIGIBILITY_REQUIRED");
  if (characters.rule === "estimate") warnings.push("CHARACTER_COUNT_ESTIMATE");
  if (characters.remaining !== null && characters.remaining < 0) errors.push("CHARACTER_LIMIT_EXCEEDED");
  if (platform === "bluesky" && new TextEncoder().encode(text).length > 3000) errors.push("TEXT_BYTE_LIMIT_EXCEEDED");
  if (!text.trim() && !media.length && !options?.linkUrl) errors.push("CONTENT_REQUIRED");
  if (platform === "instagram" && type === "post") {
    if ([...text.matchAll(normalizeTag)].length > 30) errors.push("HASHTAG_LIMIT_EXCEEDED");
    if ([...text.matchAll(normalizeMention)].length > 20) errors.push("MENTION_LIMIT_EXCEEDED");
    if (/https?:\/\//i.test(text)) warnings.push("LINK_NOT_CLICKABLE");
  }
  if (platform === "googlebusiness" && /https?:\/\//i.test(text)) warnings.push("USE_LINK_TARGET");
  if (options?.firstComment !== undefined && (type !== "post" || !mayUseFirstComment(platform))) errors.push("FIRST_COMMENT_UNAVAILABLE");
  const commentLimit = platform === "threads" ? 500 : platform === "instagram" ? 2200 : platform === "linkedin" ? 1250 : 8000;
  if (options?.firstComment !== undefined && (!options.firstComment.trim() || [...options.firstComment].length > commentLimit)) errors.push("INVALID_FIRST_COMMENT");
  if (options?.madeWithAi !== undefined && (type !== "post" || caps.madeWithAi === "unavailable" ||
    ((platform === "twitter" || platform === "tiktok") && mode === "none") || (platform === "tiktok" && mode !== "video"))) errors.push("AI_LABEL_UNAVAILABLE");
  if (options?.repost && (type !== "post" || caps.repost === "unavailable")) errors.push("REPOST_UNAVAILABLE");
  if (options?.linkUrl && (type !== "post" || caps.link !== "target")) errors.push("LINK_TARGET_UNAVAILABLE");
  if (platform === "tiktok" && !options?.tiktok) errors.push("TIKTOK_CONSENT_REQUIRED");
  if (platform !== "tiktok" && options?.tiktok) errors.push("TIKTOK_SETTINGS_UNAVAILABLE");
  if (platform === "googlebusiness" && options?.linkUrl && !options.linkUrl.startsWith("https://")) errors.push("LINK_TARGET_REQUIRES_HTTPS");
  if (options?.subreddit && platform !== "reddit") errors.push("SUBREDDIT_UNAVAILABLE");
  if (options?.boardId && platform !== "pinterest") errors.push("BOARD_UNAVAILABLE");
  if (options?.channelId && platform !== "discord") errors.push("CHANNEL_UNAVAILABLE");
  if (platform === "reddit" && !options?.subreddit) errors.push("SUBREDDIT_REQUIRED");
  if (platform === "pinterest" && !options?.boardId) errors.push("BOARD_REQUIRED");
  if (platform === "discord" && !options?.channelId) errors.push("CHANNEL_REQUIRED");
  const titleLimit = ({ youtube: 100, pinterest: 100, reddit: 300, twitter: type === "article" ? 100 : 0 } as Partial<Record<SocialPlatform, number>>)[platform] ?? 0;
  if ((platform === "youtube" || platform === "reddit" || type === "article") && !options?.title?.trim()) errors.push("TITLE_REQUIRED");
  if (options?.title !== undefined && (!titleLimit || [...options.title].length > titleLimit)) errors.push(titleLimit ? "TITLE_TOO_LONG" : "TITLE_UNAVAILABLE");
  if (platform === "reddit" && options?.linkUrl && media.length) errors.push("LINK_WITH_MEDIA_UNAVAILABLE");
  return { characters, errors, warnings };
}

export function inspectAttachments(platform: SocialPlatform, type: DraftType, options: ComposerOptions | undefined,
  attachments: ComposerInput["media"], filesById: Map<string, ReadyMedia>) {
  const rules = mediaRulesFor(platform, type, options?.format);
  const issues: string[] = [];
  const media = attachments.flatMap(attachment => {
    const file = filesById.get(attachment.fileId);
    return file ? [file] : [];
  });
  if (!rules) issues.push(type === "post" ? "MEDIA_FORMAT_UNAVAILABLE" : "UNSUPPORTED_POST_TYPE");
  if (rules && attachments.length > rules.maxItems) issues.push("MEDIA_TOO_MANY_ITEMS");
  if (rules?.minItems && attachments.length < rules.minItems) issues.push("MEDIA_REQUIRED");
  const kinds = media.map(file => mediaKind(file.mime));
  if (platform === "instagram" && type === "post" && kinds.length === 1 && kinds[0] === "video" && options?.format !== "reel") {
    issues.push("MEDIA_FORMAT_REQUIRES_REEL");
  }
  if (platform === "threads" && kinds.includes("video") && attachments.length > 10) issues.push("MEDIA_TOO_MANY_ITEMS");
  if (new Set(kinds).size > 1 && (!rules?.mixed || kinds.includes("document") || kinds.includes("gif"))) issues.push("MEDIA_MIXED_NOT_ALLOWED");
  if (options?.coverTimeMs !== undefined && (!rules?.frame || media.length !== 1 || !media[0].durationMs || options.coverTimeMs >= media[0].durationMs)) {
    issues.push("MEDIA_COVER_FRAME_UNAVAILABLE");
  }
  if (options?.coverFileId && options.coverTimeMs !== undefined) issues.push("MEDIA_COVER_CONFLICT");
  const results = attachments.map(attachment => {
    const file = filesById.get(attachment.fileId);
    const kind = file ? mediaKind(file.mime) : null;
    const rule = kind ? rules?.files[kind] : undefined;
    const errors = file ? mediaFileErrors(file, rule) : ["MEDIA_NOT_AVAILABLE"];
    if (kind && rule?.max && kinds.filter(value => value === kind).length > rule.max) errors.push("MEDIA_TOO_MANY_ITEMS");
    if (attachment.altText !== undefined) {
      if ((kind !== "image" && kind !== "gif") || type !== "post" || platformCapabilities[platform].altText === "unavailable") errors.push("ALT_TEXT_UNAVAILABLE");
      if (platform === "pinterest" && [...attachment.altText].length > 500) errors.push("ALT_TEXT_TOO_LONG");
    }
    const reasons = [...new Set([...errors, ...issues.filter(issue => !issue.startsWith("MEDIA_COVER_"))])];
    return { fileId: attachment.fileId, kind, errors: reasons, accepted: reasons.length === 0 };
  });
  const cover = options?.coverFileId ? filesById.get(options.coverFileId) : undefined;
  const coverErrors = options?.coverFileId ? (!cover ? ["MEDIA_NOT_AVAILABLE"] :
    !rules?.cover || (type !== "article" && (kinds.length !== 1 || kinds[0] !== "video")) ? ["MEDIA_COVER_UNAVAILABLE"] : mediaFileErrors(cover, rules.cover)) : [];
  const subtitles = (options?.subtitles ?? []).map(track => {
    const file = filesById.get(track.fileId);
    const errors: string[] = [];
    if (!file) errors.push("MEDIA_NOT_AVAILABLE");
    if (!rules?.subtitles || kinds.filter(kind => kind === "video").length !== 1) {
      errors.push("SUBTITLES_UNAVAILABLE");
    } else {
      if ((options?.subtitles?.length ?? 0) > rules.subtitles.maxTracks) errors.push("TOO_MANY_SUBTITLE_TRACKS");
      if (rules.subtitles.englishOnly && !/^en(?:-|$)/.test(track.language)) errors.push("SUBTITLE_LANGUAGE_UNSUPPORTED");
      if (file && !["application/x-subrip", "text/vtt"].includes(file.mime)) errors.push("MEDIA_WRONG_TYPE");
      if (file && file.size > rules.subtitles.maxBytes) errors.push("MEDIA_TOO_LARGE");
    }
    return { ...track, accepted: errors.length === 0, errors };
  });
  return { version: mediaRulesVersion, media, results, issues, subtitles, cover: options?.coverFileId ? {
    fileId: options.coverFileId, accepted: coverErrors.length === 0, errors: coverErrors,
  } : null };
}

export async function inspectComposer(tx: Transaction, tenantId: string, input: ComposerInput, allowUnavailable = false) {
  const connections: Connection[] = input.connectionIds.length ? await tx.select({
    id: socialConnections.id, platform: socialConnections.platform, status: socialConnections.status,
    health: socialConnections.health, displayName: socialConnections.displayName, version: socialConnections.version,
  }).from(socialConnections).where(and(eq(socialConnections.tenantId, tenantId), inArray(socialConnections.id, input.connectionIds))).orderBy(socialConnections.id).for("share") : [];
  if (input.connectionIds.length !== connections.length) throw unavailable();
  const fileIds = new Set(input.media.map(attachment => attachment.fileId));
  for (const variant of Object.values(input.variants)) {
    if (variant.mode === "custom") for (const attachment of variant.media ?? []) fileIds.add(attachment.fileId);
    if (variant.options?.coverFileId) fileIds.add(variant.options.coverFileId);
    for (const track of variant.options?.subtitles ?? []) fileIds.add(track.fileId);
  }
  const rows = fileIds.size ? await tx.select({ id: files.id, mime: files.mime, size: files.size, metadata: files.mediaMetadata })
    .from(files).where(and(eq(files.tenantId, tenantId), eq(files.status, "ready"), isNull(files.socialRetiredAt), inArray(files.id, [...fileIds]))).for("share") : [];
  if (!allowUnavailable && fileIds.size !== rows.length) throw unavailable();
  const filesById = new Map(rows.map(file => [file.id, { ...file, ...file.metadata }]));
  const previews = connections.map(connection => {
    const variant = input.variants[connection.platform];
    const content = variant?.mode === "custom" ? variant.content ?? input.content : input.content;
    const attachments = variant?.mode === "custom" ? variant.media ?? input.media : input.media;
    const options = variant?.options;
    const attachmentsResult = inspectAttachments(connection.platform, input.type, options, attachments, filesById);
    const validation = destinationErrors(connection.platform, input.type, content, options, attachmentsResult.media);
    if (connection.status !== "active" || connection.health === "failing") validation.errors.push("ACCOUNT_UNAVAILABLE");
    return { account: connection, content, mode: variant?.mode ?? "same", attachments, options, ...validation,
      media: attachmentsResult.results, cover: attachmentsResult.cover, subtitles: attachmentsResult.subtitles, mediaRulesVersion: attachmentsResult.version,
      errors: [...new Set([...validation.errors, ...attachmentsResult.issues, ...attachmentsResult.results.flatMap(result => result.errors), ...attachmentsResult.subtitles.flatMap(result => result.errors), ...(attachmentsResult.cover?.errors ?? [])])],
    };
  });
  return { previews, missingMedia: fileIds.size !== rows.length };
}
