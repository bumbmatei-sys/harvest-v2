import { putFile, PutError } from "@/lib/put-file";
import { sha256Hex } from "@/lib/event-cover";
import { newsletterImageMaxPixels, newsletterImageProblem } from "./image-limits";

export type ImageProblem = "type" | "size" | "dimensions" | "rejected" | "interrupted" | "failed" | "scan";
export type ImagePhase = "preparing" | "uploading" | "verifying";
export type ImageResult = { ok: true; state: "ready" | "scanning"; fileId: string } | { ok: false; problem: ImageProblem; fileId?: string };
type Summary = { id: string; status: "pending" | "uploaded" | "quarantined" | "ready" };
type Grant = { url: string; method: string; headers: Record<string, string> };
const json = async <T>(response: Response) => (await response.json().catch(() => null)) as T | null;
const post = (url: string, body?: unknown) => fetch(url, { method: "POST", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
const base = (tenantId: string) => `/api/workspaces/${tenantId}/newsletter/images`;

/** Larger than the limit on either side, read from the browser's own decoder. A file the browser cannot decode is left to the server's checks. */
export async function tooLarge(file: File) {
  try {
    const bitmap = await createImageBitmap(file);
    const big = bitmap.width > newsletterImageMaxPixels || bitmap.height > newsletterImageMaxPixels;
    bitmap.close();
    return big;
  } catch { return false; }
}

/** Asks the server to verify and scan an uploaded image. Safe to repeat. */
export async function confirmNewsletterImage(tenantId: string, fileId: string): Promise<ImageResult> {
  let response: Response;
  try { response = await post(`${base(tenantId)}/${fileId}/confirm`, {}); } catch { return { ok: false, problem: "interrupted", fileId }; }
  const file = await json<Summary>(response);
  if (!response.ok || !file) return { ok: false, problem: "failed", fileId };
  if (file.status === "quarantined") return { ok: false, problem: "scan", fileId };
  return { ok: true, state: file.status === "ready" ? "ready" : "scanning", fileId };
}

/** Check, hash, signed slot, direct PUT with progress, then server verification and scan. The server's limits stay authoritative. */
export async function uploadNewsletterImage(tenantId: string, file: File, hooks: { onPhase: (phase: ImagePhase) => void; onProgress: (value: number) => void; signal?: AbortSignal }): Promise<ImageResult> {
  const early = newsletterImageProblem(file) ?? ((await tooLarge(file)) ? "dimensions" : null);
  if (early) return { ok: false, problem: early };
  hooks.onPhase("preparing");
  let created: Response, bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
    created = await post(base(tenantId), { name: file.name, mime: file.type, size: file.size, checksum: await sha256Hex(bytes) });
  } catch { return { ok: false, problem: "interrupted" }; }
  if (!created.ok) return { ok: false, problem: created.status === 400 ? "rejected" : "failed" };
  const grant = await json<{ file: Summary; upload: Grant }>(created);
  if (!grant) return { ok: false, problem: "failed" };
  hooks.onPhase("uploading"); hooks.onProgress(0);
  try { await putFile(new Blob([bytes], { type: file.type }), grant.upload, hooks.onProgress, hooks.signal); }
  catch (error) { return { ok: false, problem: error instanceof PutError && error.code === "FAILED" ? "failed" : "interrupted" }; }
  hooks.onProgress(100); hooks.onPhase("verifying");
  return confirmNewsletterImage(tenantId, grant.file.id);
}
