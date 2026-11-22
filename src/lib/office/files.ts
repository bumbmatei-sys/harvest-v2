// Browser side of the Office routes for personal files (docs/acceptance/office-server.md: `files`, `file`, `preview`). Listings are live pass-through: nothing is cached
// in Harvest or in browser storage, and no file bytes ever reach this client. Download, share, upload and delete are hard-off on the server and have no call here.
import { call, type Connected, type Failure, type OfficeOverview, type OfficePlatform, type Page, type Pending, type Result } from "@/lib/office/mail";

/** One provider listing row (`FileDetail` on the server); optional fields are absent when the provider does not report them. */
export type DriveItem = { ref: string; name: string; kind: "file" | "folder"; parentRef?: string | null; mimeType?: string | null; size?: number | null; webUrl?: string | null };

export const filesApi = (tenantId: string) => {
  const run = <T,>(action: string, connectionId: string, input: unknown, signal?: AbortSignal) =>
    call<Result<T>>(tenantId, { method: "POST", signal, body: { action, connectionId, input } });
  return {
    overview: (signal?: AbortSignal) => call<OfficeOverview>(tenantId, { method: "GET", signal }),
    /** With `connectionId` this reconnects that connection (same provider account) instead of adding one. */
    startConnect: (platform: OfficePlatform, noticeVersion: number, connectionId?: string) =>
      call<Pending | { state: Failure }>(tenantId, { method: "POST", body: { action: "startConnect", ...(connectionId ? { connectionId } : {}), input: { kind: "files", platform, noticeVersion } } }),
    /** Read-only: refreshes the stored health and grants of the person's own connection. */
    health: (connectionId: string) => call<{ state: string }>(tenantId, { method: "POST", body: { action: "health", connectionId, input: {} } }),
    finishConnect: (attemptId: string) => call<Connected | { state: "pending" | "failed" }>(tenantId, { method: "POST", body: { action: "finishConnect", input: { attemptId } } }),
    disconnect: (connectionId: string) => call<{ state: string }>(tenantId, { method: "POST", body: { action: "disconnect", connectionId, input: {} } }),
    files: (connectionId: string, input: { folderRef?: string; search?: string; cursor?: string; limit?: number }, signal?: AbortSignal) => run<Page<DriveItem>>("files", connectionId, input, signal),
    preview: (connectionId: string, fileRef: string) => run<{ url: string }>("preview", connectionId, { fileRef }),
  };
};
export type FilesApi = ReturnType<typeof filesApi>;
