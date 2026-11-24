import { z } from "zod";
import { filenameMatchesMime } from "../files";

/** Limits for newsletter images. GIF is not accepted yet: the shared file table does not allow it (see docs/acceptance/newsletter-images.md). */
export const newsletterImageMimes = ["image/jpeg", "image/png", "image/webp"] as const;
export const newsletterImageMaxBytes = 5 * 1024 * 1024;
export const newsletterImageMaxMb = 5;
export const newsletterImageMaxPixels = 4000;
export const newsletterImageAccept = newsletterImageMimes.join(",");

export const newsletterImageInput = z.object({
  name: z.string().trim().min(1).max(200).refine(name => !/[\x00-\x1f\x7f؜‎‏‪-‮⁦-⁩/\\]/.test(name)),
  mime: z.enum(newsletterImageMimes),
  size: z.number().int().positive().max(newsletterImageMaxBytes),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(({ name, mime }) => filenameMatchesMime(name, mime), { path: ["name"] });

/** Browser-side pre-check of type, extension and size, so a wrong file never starts an upload. The server repeats it. */
export function newsletterImageProblem(file: Pick<File, "name" | "type" | "size">): "type" | "size" | null {
  if (!(newsletterImageMimes as readonly string[]).includes(file.type) || !filenameMatchesMime(file.name, file.type)) return "type";
  if (file.size < 1 || file.size > newsletterImageMaxBytes) return "size";
  return null;
}
