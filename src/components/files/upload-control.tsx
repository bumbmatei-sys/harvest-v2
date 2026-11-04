"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FILE_MIME_TYPES, MAX_FILE_SIZE, uploadInput } from "@/lib/files";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

async function checkedJson(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed. Please try again.");
  return data;
}
function putFile(file: File, grant: { url: string; method: string; headers: Record<string, string> }, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(grant.method, grant.url); xhr.timeout = 120_000;
    for (const [name, value] of Object.entries(grant.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload failed. Choose the file and try again."));
    xhr.onerror = xhr.ontimeout = () => reject(new Error("Upload connection failed. Please try again."));
    xhr.send(file);
  });
}
export function UploadControl({ tenantId, canUpload }: { tenantId: string; canUpload: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retryId, setRetryId] = useState<string | null>(null);
  const busy = phase !== "";
  const base = `/api/workspaces/${tenantId}/files`;
  async function confirm(id: string) {
    const result = await checkedJson(await fetch(`${base}/${id}/confirm`, { method: "POST" }));
    setRetryId(null);
    setMessage(result.status === "quarantined" ? "File quarantined. It is unavailable for download or sharing." : "File uploaded and ready.");
  }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_FILE_SIZE || !FILE_MIME_TYPES.includes(file.type as typeof FILE_MIME_TYPES[number])) {
      setMessage(""); setError("Choose a JPEG, PNG, WebP, PDF or text file between 1 byte and 10 MiB."); return;
    }
    setPhase("Preparing upload…"); setError(""); setMessage(""); setProgress(0); setRetryId(null);
    try {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const input = uploadInput.parse({ name: file.name, mime: file.type, size: file.size, checksum, visibility: data.get("visibility") });
      const result = await checkedJson(await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }));
      setPhase("Uploading…");
      await putFile(file, result.upload, setProgress);
      setProgress(100); setPhase("Verifying file…"); setRetryId(result.file.id);
      await confirm(result.file.id); form.reset();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not upload. Please try again."); }
    finally { setPhase(""); router.refresh(); }
  }
  async function retry() {
    if (!retryId) return;
    setPhase("Verifying file…"); setError("");
    try { await confirm(retryId); }
    catch { setError("File verification failed. Please try again."); }
    finally { setPhase(""); router.refresh(); }
  }
  return <div className="space-y-4">
    <p id="upload-help" className="text-sm text-muted-foreground">JPEG, PNG, WebP, PDF or text. Up to 10 MiB per file.</p>
    {!canUpload && <p className="text-sm text-muted-foreground">Your viewer role can download files. Ask a workspace member to upload.</p>}
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="upload-file">Choose file</Label><Input id="upload-file" name="file" type="file" accept={FILE_MIME_TYPES.join(",")} required disabled={busy || !canUpload} aria-describedby="upload-help" /></div>
      <div className="space-y-2"><Label htmlFor="upload-visibility">Visibility</Label>
        <NativeSelect id="upload-visibility" name="visibility" defaultValue="private" disabled={busy || !canUpload} aria-describedby="visibility-help">
          <NativeSelectOption value="private">Private to workspace</NativeSelectOption><NativeSelectOption value="public">Public</NativeSelectOption>
        </NativeSelect>
        <p id="visibility-help" className="text-sm text-muted-foreground">Public uploads stay quarantined until a malware check approves sharing.</p>
      </div>
      <Button disabled={busy || !canUpload}>{busy ? phase : "Upload file"}</Button>
    </form>
    {busy && <div className="space-y-2"><Progress value={progress} aria-label="Upload progress" /><p role="status" className="text-sm text-muted-foreground">{phase} {progress}%</p></div>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {retryId && !busy && <Button variant="outline" onClick={() => void retry()}>Retry verification</Button>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
