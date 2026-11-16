import type { AccountProvider, Credential, Page, Query } from "../office-provider/types";
export type FileReference = { ref: string; name: string; mimeType: string; size: number };
export interface FilesProvider extends AccountProvider {
  listFiles(c: Credential, q: Query): Promise<Page<FileReference>>;
  upload(c: Credential, input: { accountRef: string; name: string; mimeType: string; bytes: Uint8Array; idempotencyKey: string }): Promise<FileReference>;
  download(c: Credential, accountRef: string, fileRef: string): Promise<Uint8Array>;
  share(c: Credential, accountRef: string, fileRef: string, input: { recipient: string; access: "read" | "write" }): Promise<{ ref: string }>;
}
