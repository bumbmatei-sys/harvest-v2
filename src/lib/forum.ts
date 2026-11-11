import { z } from "zod";
import { FILE_MIME_TYPES, filenameMatchesMime, MAX_FILE_SIZE } from "./files";

// Community forum inputs (Communities PR 4b). Rich text is validated by sanitizeRichText on the server.
export const forumLimits = { title: 200, comment: 5000, attachments: 5, categories: 30, categoryName: 60, emoji: 16 } as const;
export const coverMimes = ["image/jpeg", "image/png", "image/webp"] as const;
export const attachmentMimes = FILE_MIME_TYPES;
export const forumSorts = ["new", "best"] as const;
export type ForumSort = (typeof forumSorts)[number];

export const postInput = z.object({
  categoryId: z.uuid(),
  title: z.string().trim().min(1).max(forumLimits.title),
  body: z.unknown(),
  videoUrl: z.string().trim().max(500).nullable().optional(),
  coverFileId: z.uuid().nullable().optional(),
  attachmentIds: z.array(z.uuid()).max(forumLimits.attachments).default([]),
  commentsOff: z.boolean().default(false),
  likesOff: z.boolean().default(false),
}).strict();
export const commentInput = z.object({ body: z.string().trim().min(1).max(forumLimits.comment) }).strict();

export const communityUploadInput = z.object({
  kind: z.enum(["cover", "attachment"]),
  name: z.string().trim().min(1).max(200).refine((name) => !/[\x00-\x1f\x7f؜‎‏‪-‮⁦-⁩/\\]/.test(name)),
  mime: z.enum(FILE_MIME_TYPES),
  size: z.number().int().positive().max(MAX_FILE_SIZE),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
  .refine(({ name, mime }) => filenameMatchesMime(name, mime), { path: ["name"] })
  .refine(({ kind, mime }) => kind === "attachment" || (coverMimes as readonly string[]).includes(mime), { path: ["mime"] });
export type CommunityUploadInput = z.infer<typeof communityUploadInput>;

export const categoryInput = z.object({
  name: z.string().trim().min(1).max(forumLimits.categoryName),
  emoji: z.string().trim().max(forumLimits.emoji).nullable().optional(),
  hostsOnly: z.boolean().default(false),
}).strict();

/** Object key for a member upload: never derived from a filename or client path. */
export function communityFileKey(tenantId: string, communityId: string, fileId: string) {
  return `communities/${z.uuid().parse(tenantId)}/${z.uuid().parse(communityId)}/files/${z.uuid().parse(fileId)}`;
}
