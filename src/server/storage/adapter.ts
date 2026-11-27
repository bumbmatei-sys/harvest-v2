import type { coverMimes } from "../../lib/forum";

export type ImageMime = typeof coverMimes[number];

export const downloadExpiry = (seconds?: number) => Math.min(3600, Math.max(60, Math.floor(seconds ?? 60)));

export class InvalidStoredFile extends Error {}

export interface UploadGrant {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresIn: number;
}
export type UploadObject = { mime: string; size: number; name?: string; checksum?: string; visibility?: "private" | "public" };
export type UploadPart = { partNumber: number; etag: string };
export interface MultipartStorage {
  startMultipart(key: string, mime: string): Promise<string>;
  presignPart(key: string, uploadId: string, partNumber: number, size: number): Promise<UploadGrant>;
  completeMultipart(key: string, uploadId: string, parts: UploadPart[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
}

export interface StorageAdapter {
  presignUpload(key: string, input: UploadObject): Promise<UploadGrant>;
  /** Read and hash the actual bytes, bounded by expected size; never trust user metadata. */
  inspect(key: string, expected: { size: number; mime: string; name: string }): Promise<{ size: number; mime: string; checksum: string }>;
  /** `expiresIn` (seconds) defaults to 60 and is clamped to 60..3600: only the self-serve data export asks for longer links. */
  presignDownload(key: string, name: string, options?: { inlineImage?: ImageMime; expiresIn?: number }): Promise<string>;
}
