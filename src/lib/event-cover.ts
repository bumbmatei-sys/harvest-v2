import { filenameMatchesMime, MAX_FILE_SIZE } from "@/lib/files";
import { coverMimes } from "@/lib/forum";
import { putFile, PutError } from "@/lib/put-file";

/** Why a cover could not be used. Each one has its own message and next step in the picker. */
export type CoverProblem = "type" | "size" | "rejected" | "interrupted" | "failed" | "scan" | "stale";
export type CoverPhase = "preparing" | "uploading" | "verifying";
export type CoverFileState = "ready" | "scanning";
export type CoverUploadResult = { ok: true; state: CoverFileState; fileId: string } | { ok: false; problem: CoverProblem; fileId?: string };

export const coverAccept = coverMimes.join(",");
export const coverMaxMb = MAX_FILE_SIZE / (1024 * 1024);

/** The checks the server repeats (type, extension, size); done first so a wrong file never starts an upload. */
export function coverFileProblem(file: Pick<File, "name" | "type" | "size">): "type" | "size" | null {
  if (!(coverMimes as readonly string[]).includes(file.type) || !filenameMatchesMime(file.name, file.type)) return "type";
  if (file.size < 1 || file.size > MAX_FILE_SIZE) return "size";
  return null;
}

export async function sha256Hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Summary = { id: string; status: "pending" | "uploaded" | "quarantined" | "ready" };
type Grant = { url: string; method: string; headers: Record<string, string> };
const json = async <T>(response: Response) => (await response.json().catch(() => null)) as T | null;
const postJson = (url: string, body?: unknown) => fetch(url, { method: "POST", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });

/** Asks the server to verify (and scan) an uploaded cover. Safe to repeat: a cover that is still being scanned stays "scanning". */
export async function confirmEventCover(endpoint: string, fileId: string): Promise<CoverUploadResult> {
  let response: Response;
  try { response = await postJson(`${endpoint}/cover/uploads/${fileId}/confirm`); } catch { return { ok: false, problem: "interrupted", fileId }; }
  if (response.status === 401) return { ok: false, problem: "failed", fileId };
  const file = await json<Summary>(response);
  if (!response.ok || !file) return { ok: false, problem: "failed", fileId };
  if (file.status === "quarantined") return { ok: false, problem: "scan", fileId };
  return { ok: true, state: file.status === "ready" ? "ready" : "scanning", fileId };
}

/**
 * Whole upload of one cover: check, hash, ask for a signed slot, PUT the bytes straight to storage with progress, then have the
 * server verify and scan. The server's own limits stay authoritative; this only avoids a doomed upload.
 */
export async function uploadEventCover(endpoint: string, file: File, hooks: { onPhase: (phase: CoverPhase) => void; onProgress: (value: number) => void; signal?: AbortSignal }): Promise<CoverUploadResult> {
  const early = coverFileProblem(file);
  if (early) return { ok: false, problem: early };
  hooks.onPhase("preparing");
  let created: Response, bytes: ArrayBuffer, checksum: string;
  try {
    bytes = await file.arrayBuffer(); checksum = await sha256Hex(bytes);
    created = await postJson(`${endpoint}/cover/uploads`, { kind: "cover", name: file.name, mime: file.type, size: file.size, checksum });
  } catch { return { ok: false, problem: "interrupted" }; }
  if (!created.ok) return { ok: false, problem: created.status === 400 ? "rejected" : created.status === 409 ? "stale" : "failed" };
  const grant = await json<{ file: Summary; upload: Grant }>(created);
  if (!grant) return { ok: false, problem: "failed" };
  hooks.onPhase("uploading"); hooks.onProgress(0);
  try { await putFile(new Blob([bytes], { type: file.type }), grant.upload, hooks.onProgress, hooks.signal); }
  catch (error) {
    const code = error instanceof PutError ? error.code : "CONNECTION";
    // No file id here: the bytes are not in storage, so "try again" starts the upload again rather than asking for verification.
    return { ok: false, problem: code === "FAILED" ? "failed" : "interrupted" };
  }
  hooks.onProgress(100); hooks.onPhase("verifying");
  return confirmEventCover(endpoint, grant.file.id);
}

/** Message key under Events.cover.problems for a response status from the cover routes. */
export const statusProblem = (status: number): CoverProblem => status === 409 ? "stale" : "failed";
