import { FakeStore } from "../office-provider/fake-store";
import { OfficeProviderError, type Credential, type Query } from "../office-provider/types";
import type { FileReference, FilesProvider } from "./port";
export class FakeFilesProvider extends FakeStore implements FilesProvider {
  private files = new Map<string, { file: FileReference; bytes: Uint8Array }>();
  /** Only explicitly picked seed files are visible; uploads become visible in this connection. */
  constructor(accounts?: readonly string[], picked: { accountRef: string; file: FileReference; bytes: Uint8Array }[] = []) { super(accounts); for (const p of picked) this.files.set(this.key(p.accountRef, p.file.ref), structuredClone({ file: p.file, bytes: p.bytes })); }
  async listFiles(c: Credential, q: Query) { this.authorize(c, q.accountRef); return this.page([...this.files].filter(([key, v]) => (JSON.parse(key) as string[])[0] === q.accountRef && (!q.search || v.file.name.includes(q.search))).map(([, v]) => v.file), q); }
  async upload(c: Credential, input: { accountRef: string; name: string; mimeType: string; bytes: Uint8Array; idempotencyKey: string }) { this.authorize(c, input.accountRef); return this.once(input.accountRef, "upload", input.idempotencyKey, { ...input, bytes: [...input.bytes] }, () => { let ref: string; do { ref = this.id("file"); } while (this.files.has(this.key(input.accountRef, ref))); const file = { ref, name: input.name, mimeType: input.mimeType, size: input.bytes.length }; this.files.set(this.key(input.accountRef, file.ref), { file, bytes: new Uint8Array(input.bytes) }); return file; }); }
  async download(c: Credential, accountRef: string, fileRef: string) { this.authorize(c, accountRef); return new Uint8Array(this.get(this.files, accountRef, fileRef).bytes); }
  async share(c: Credential, accountRef: string, fileRef: string, _input: { recipient: string; access: "read" | "write" }) { this.authorize(c, accountRef); this.get(this.files, accountRef, fileRef); if (!_input.recipient || !["read", "write"].includes(_input.access)) throw new OfficeProviderError("INVALID_REQUEST"); return { ref: this.id("share") }; }
}
