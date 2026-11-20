export type PutGrant = { url: string; method: string; headers: Record<string, string> };
export type PutFailure = "FAILED" | "CONNECTION" | "ABORTED";
export class PutError extends Error { constructor(readonly code: PutFailure) { super(code); } }
export type PutResult = { etag: string | null };

/** One signed PUT of a file or a slice of it. Shared by the files upload control and the social media uploader; progress is 0..100. */
export function putFile(file: Blob, grant: PutGrant, onProgress: (value: number) => void, signal?: AbortSignal) {
  return new Promise<PutResult>((resolve, reject) => {
    if (signal?.aborted) return reject(new PutError("ABORTED"));
    const xhr = new XMLHttpRequest();
    xhr.open(grant.method, grant.url); xhr.timeout = 120_000;
    for (const [name, value] of Object.entries(grant.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve({ etag: xhr.getResponseHeader("ETag") }) : reject(new PutError("FAILED"));
    xhr.onerror = xhr.ontimeout = () => reject(new PutError("CONNECTION"));
    xhr.onabort = () => reject(new PutError("ABORTED"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
