"use client";
import { useTranslations, useFormatter } from "next-intl";
import { message, errorMessage } from "../../i18n/messages";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FILE_MIME_TYPES, MAX_FILE_SIZE, uploadInput } from "@/lib/files";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

async function checkedJson(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(errorMessage(data.error, "ComponentsFilesUploadControl.requestFailedPleaseTryAgain"));
  return data;
}
function putFile(file: File, grant: { url: string; method: string; headers: Record<string, string> }, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(grant.method, grant.url); xhr.timeout = 120_000;
    for (const [name, value] of Object.entries(grant.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(message("ComponentsFilesUploadControl.uploadFailedChooseTheFileAndTryAgain")));
    xhr.onerror = xhr.ontimeout = () => reject(new Error(message("ComponentsFilesUploadControl.uploadConnectionFailedPleaseTryAgain")));
    xhr.send(file);
  });
}
export function UploadControl({ tenantId, canUpload }: { tenantId: string; canUpload: boolean }) {
  const t = useTranslations("ComponentsFilesUploadControl");
  const format = useFormatter();
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
    setMessage(result.status === "quarantined" ? t("fileQuarantinedItIsUnavailableForDownloadOr") : t("fileUploadedAndReady"));
  }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_FILE_SIZE || !FILE_MIME_TYPES.includes(file.type as typeof FILE_MIME_TYPES[number])) {
      setMessage(""); setError(t("chooseAJPEGPNGWebPPDFOrText")); return;
    }
    setPhase(t("preparingUpload")); setError(""); setMessage(""); setProgress(0); setRetryId(null);
    try {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const input = uploadInput.parse({ name: file.name, mime: file.type, size: file.size, checksum, visibility: data.get("visibility") });
      const result = await checkedJson(await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }));
      setPhase(t("uploading"));
      await putFile(file, result.upload, setProgress);
      setProgress(100); setPhase(t("verifyingFile")); setRetryId(result.file.id);
      await confirm(result.file.id); form.reset();
    } catch (error) { setError(error instanceof Error ? error.message : t("couldNotUploadPleaseTryAgain")); }
    finally { setPhase(""); router.refresh(); }
  }
  async function retry() {
    if (!retryId) return;
    setPhase(t("verifyingFile")); setError("");
    try { await confirm(retryId); }
    catch { setError(t("fileVerificationFailedPleaseTryAgain")); }
    finally { setPhase(""); router.refresh(); }
  }
  return <div className="space-y-4">
    {!canUpload && <Alert><AlertDescription>{t("yourViewerRoleCanDownloadFilesAskA")}</AlertDescription></Alert>}
    <form onSubmit={submit}><FieldGroup>
      <Field><FieldLabel htmlFor="upload-file">{t("chooseFile")}</FieldLabel><Input id="upload-file" name="file" type="file" accept={FILE_MIME_TYPES.join(",")} required disabled={busy || !canUpload} aria-describedby="upload-help" />
        <FieldDescription id="upload-help">{t("jPEGJpgJpegPNGPngWebPWebpPDF")}</FieldDescription>
      </Field>
      <Field><FieldLabel htmlFor="upload-visibility">{t("visibility")}</FieldLabel>
        <NativeSelect id="upload-visibility" name="visibility" defaultValue="private" disabled={busy || !canUpload} aria-describedby="visibility-help">
          <NativeSelectOption value="private">{t("privateToWorkspace")}</NativeSelectOption><NativeSelectOption value="public">{t("public")}</NativeSelectOption>
        </NativeSelect>
        <FieldDescription id="visibility-help">{t("publicUploadsStayQuarantinedUntilAMalwareCheck")}</FieldDescription>
      </Field>
      <Field orientation="horizontal"><Button disabled={busy || !canUpload}>{busy ? phase : t("uploadFile")}</Button></Field>
    </FieldGroup></form>
    {busy && <div className="space-y-2"><Progress value={progress} aria-label={t("uploadProgress")} /><Alert role="status"><AlertDescription>{t("progressStatus", { phase, progress: format.number(progress / 100, "percent") })}</AlertDescription></Alert></div>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {retryId && !busy && <Button variant="outline" onClick={() => void retry()}>{t("retryVerification")}</Button>}
    {message && <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert>}
  </div>;
}
