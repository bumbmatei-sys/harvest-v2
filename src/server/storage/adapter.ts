import type { UploadInput } from "../../lib/files";

export class InvalidStoredFile extends Error {}

export interface UploadGrant {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresIn: number;
}
export interface StorageAdapter {
  presignUpload(key: string, input: UploadInput): Promise<UploadGrant>;
  /** Read and hash the actual bytes, bounded by expected size; never trust user metadata. */
  inspect(key: string, expectedSize: number): Promise<{ size: number; mime: string; checksum: string }>;
  presignDownload(key: string, name: string): Promise<string>;
}
