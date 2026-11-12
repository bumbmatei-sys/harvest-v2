"use client";
// Client side of a member upload: hash, request an upload slot, PUT the bytes, then confirm (server verifies and scans).
export type UploadedFile = { id: string; name: string; mime: string; size: number; status: string; kind: "cover" | "attachment" };
export type UploadError = "type" | "size" | "failed" | "unverified";

export async function uploadCommunityFile(slug: string, file: File, kind: "cover" | "attachment"): Promise<{ ok: true; file: UploadedFile } | { ok: false; error: UploadError }> {
  const allowed = kind === "cover" ? ["image/jpeg", "image/png", "image/webp"] : ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"];
  if (!allowed.includes(file.type)) return { ok: false, error: "type" };
  if (file.size < 1 || file.size > 10 * 1024 * 1024) return { ok: false, error: "size" };
  try {
    const bytes = await file.arrayBuffer();
    const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
    const created = await fetch(`/api/communities/${slug}/files`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, name: file.name, mime: file.type, size: file.size, checksum }) });
    if (!created.ok) return { ok: false, error: created.status === 400 ? "type" : "failed" };
    const { file: record, upload } = await created.json() as { file: UploadedFile; upload: { url: string; method: string; headers: Record<string, string> } };
    const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: bytes });
    if (!put.ok) return { ok: false, error: "failed" };
    const confirmed = await fetch(`/api/communities/${slug}/files/${record.id}/confirm`, { method: "POST" });
    if (!confirmed.ok) return { ok: false, error: "failed" };
    const result = await confirmed.json() as UploadedFile;
    return result.status === "ready" ? { ok: true, file: result } : { ok: false, error: "unverified" };
  } catch { return { ok: false, error: "failed" }; }
}
