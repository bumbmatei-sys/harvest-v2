import { socialRequest, SocialApiError, type FileState } from "./api";
import { socialMediaMimes } from "./media";
import { putFile, PutError } from "../put-file";
import { sha256File } from "./sha256";

export type UploadPhase = "hashing" | "uploading" | "verifying";
export type UploadCallbacks = { phase: (phase: UploadPhase) => void; progress: (value: number) => void; signal: AbortSignal };
type Grant = { url: string; method: string; headers: Record<string, string> };
export const acceptsMime = (mime: string) => (socialMediaMimes as readonly string[]).includes(mime);

/**
 * The server's resumable flow: create the private upload, send it as one signed PUT or as signed 32 MiB parts, then confirm. The server
 * inspects the stored bytes and scans them; a file is usable only when it comes back `ready`. Progress is 0..100 over the upload phase.
 */
export async function uploadMedia(tenantId: string, file: File, callbacks: UploadCallbacks): Promise<FileState> {
  const { phase, progress, signal } = callbacks;
  phase("hashing"); progress(0);
  const checksum = await sha256File(file, progress, signal);
  const created = await socialRequest<{ file: FileState; upload: { kind: "single" } | { kind: "multipart"; partSize: number; partCount: number } }>(
    tenantId, "/media", { method: "POST", body: { name: file.name, mime: file.type, size: file.size, checksum }, signal });
  const id = created.file.id;
  phase("uploading"); progress(0);
  let parts: { partNumber: number; etag: string }[] | undefined;
  if (created.upload.kind === "single") {
    const grant = await socialRequest<{ upload: Grant }>(tenantId, `/media/${id}/parts`, { method: "POST", body: {}, signal });
    await putFile(file, grant.upload, progress, signal);
  } else {
    const { partSize, partCount } = created.upload;
    parts = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber++) {
      const grant = await socialRequest<{ upload: Grant }>(tenantId, `/media/${id}/parts`, { method: "POST", body: { partNumber }, signal });
      const base = (partNumber - 1) / partCount * 100;
      const sent = await putFile(file.slice((partNumber - 1) * partSize, partNumber * partSize), grant.upload, (value) => progress(Math.round(base + value / partCount)), signal);
      if (!sent.etag) throw new PutError("FAILED");
      parts.push({ partNumber, etag: sent.etag });
    }
  }
  progress(100); phase("verifying");
  return (await socialRequest<{ file: FileState }>(tenantId, `/media/${id}/confirm`, { method: "POST", body: parts ? { parts } : {}, signal })).file;
}
export { PutError, SocialApiError };
