import { z } from "zod";
import { normalizeSocialText } from "./characters";
import { draftTypes, socialPlatforms } from "./platforms";

export const storedText = (max: number) => z.string().max(max).refine(value => !value.includes("\u0000") && value.isWellFormed(), "INVALID_TEXT");
const attachment = z.object({ fileId: z.uuid(), altText: storedText(1000).optional() }).strict();
export const publishOptionsInput = z.object({
  title: storedText(300).optional(),
  firstComment: storedText(8000).optional(),
  madeWithAi: z.boolean().optional(),
  linkUrl: z.url({ protocol: /^https?$/ }).max(2000).optional(),
  boardId: z.string().regex(/^[\w-]{1,100}$/).optional(),
  subreddit: z.string().regex(/^[\w]{2,21}$/).optional(),
  channelId: z.string().regex(/^\d{1,30}$/).optional(),
  format: z.enum(["reel", "short"]).optional(),
  tiktok: z.object({
    privacy: z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]),
    confirmedPreview: z.literal(true), consent: z.literal(true),
  }).strict().optional(),
  subtitles: z.array(z.object({ fileId: z.uuid(), language: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/) }).strict()).max(10)
    .refine(tracks => new Set(tracks.map(track => track.language)).size === tracks.length).optional(),
  coverFileId: z.uuid().optional(),
  coverTimeMs: z.number().int().nonnegative().max(86_400_000).optional(),
  repost: z.object({
    intervalDays: z.number().int().min(7).max(365),
    stop: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("count"), copies: z.number().int().min(1).max(52) }).strict(),
      z.object({ kind: z.literal("date"), until: z.iso.datetime({ offset: true }) }).strict(),
    ]),
  }).strict().optional(),
}).strict();
const content = storedText(100_000).transform(normalizeSocialText);
const media = z.array(attachment).max(35).refine(items => new Set(items.map(item => item.fileId)).size === items.length);
const variant = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("same"), options: publishOptionsInput.optional() }).strict(),
  z.object({ mode: z.literal("custom"), content: content.optional(), media: media.optional(), options: publishOptionsInput.optional() }).strict(),
]);
export const composerInput = z.object({
  type: z.enum(draftTypes),
  content,
  media: media.default([]),
  connectionIds: z.array(z.uuid()).max(50).refine(ids => new Set(ids).size === ids.length),
  variants: z.partialRecord(z.enum(socialPlatforms), variant).default({}),
}).strict().refine(input => new TextEncoder().encode(JSON.stringify(input)).length <= 1_000_000, "DRAFT_TOO_LARGE");

export type ComposerInput = z.infer<typeof composerInput>;
export type ComposerAttachment = z.infer<typeof attachment>;
export type ComposerOptions = z.infer<typeof publishOptionsInput>;
export type DeliveryPayload = { type: ComposerInput["type"]; media: ComposerAttachment[]; options?: ComposerOptions };
export type WeeklySlot = { day: number; time: string };
