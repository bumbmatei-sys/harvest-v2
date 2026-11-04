import { z } from "zod";

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const FILE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"] as const;
export const uploadInput = z.object({
  name: z.string().trim().min(1).max(200).refine((name) => !/[\x00-\x1f\x7f/\\]/.test(name), "Use a filename without paths or control characters."),
  mime: z.enum(FILE_MIME_TYPES),
  size: z.number().int().positive().max(MAX_FILE_SIZE),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  visibility: z.enum(["private", "public"]).default("private"),
}).strict();
export type UploadInput = z.infer<typeof uploadInput>;

// Neither a filename nor a client-provided path participates in the object key.
export function fileKey(tenantId: string, fileId: string) {
  return `workspaces/${z.uuid().parse(tenantId)}/files/${z.uuid().parse(fileId)}`;
}
export function publicFilePath(tenantId: string, fileId: string) {
  return `/api/files/public/${z.uuid().parse(tenantId)}/${z.uuid().parse(fileId)}`;
}
