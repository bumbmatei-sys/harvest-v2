import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { downloadDisposition } from "../../lib/download-filename";
import { FILE_MIME_TYPES, MAX_FILE_SIZE } from "../../lib/files";
import { InvalidStoredFile, downloadExpiry, type StorageAdapter, type UploadObject } from "./adapter";
import { inspectFileBytes } from "./inspect";

// The subset of the native R2 binding used by the file adapter, also implemented by tests.
export interface FileBucket {
  get(key: string): Promise<{
    body: ReadableStream<Uint8Array>;
    size: number;
    httpMetadata?: { contentType?: string };
  } | null>;
  put(key: string, body: ReadableStream<Uint8Array>, options: {
    onlyIf: Headers;
    httpMetadata: { contentType: string };
    sha256: string;
  }): Promise<object | null>;
}

export const FILE_TRANSFER_PATH = "/api/files/transfer";
const grantSchema = z.object({
  key: z.string().min(1).max(400),
  expires: z.number().int(),
  subject: z.string().min(1).nullable(),
  transfer: z.discriminatedUnion("method", [
    z.object({ method: z.literal("GET"), name: z.string().max(200) }),
    z.object({
      method: z.literal("PUT"), mime: z.enum(FILE_MIME_TYPES), size: z.number().int().positive().max(MAX_FILE_SIZE),
      checksum: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ]),
});
type Grant = z.infer<typeof grantSchema>;

export class R2FileStorage implements StorageAdapter {
  constructor(private bucket: FileBucket, private origin: string, private secret: string, private subject: string | null = null) {}

  private signature(encoded: string) {
    return createHmac("sha256", this.secret).update(this.origin).update("\n").update(encoded).digest();
  }

  private url(key: string, transfer: Grant["transfer"], expiresIn: number) {
    const grant = grantSchema.parse({ key, transfer, subject: this.subject, expires: Math.floor(Date.now() / 1000) + expiresIn });
    const encoded = Buffer.from(JSON.stringify(grant)).toString("base64url");
    return `${this.origin}${FILE_TRANSFER_PATH}?grant=${encoded}.${this.signature(encoded).toString("base64url")}`;
  }

  async presignUpload(key: string, input: UploadObject) {
    if (!this.subject) throw new Error("FILE_UPLOAD_SUBJECT_REQUIRED");
    const expiresIn = 300;
    const transfer = grantSchema.shape.transfer.parse({ method: "PUT", mime: input.mime, size: input.size, checksum: input.checksum });
    return { url: this.url(key, transfer, expiresIn), method: "PUT" as const,
      headers: { "Content-Type": input.mime, "If-None-Match": "*" }, expiresIn };
  }

  async presignDownload(key: string, name: string, options?: { expiresIn?: number }) {
    return this.url(key, { method: "GET", name }, downloadExpiry(options?.expiresIn));
  }

  async inspect(key: string, expected: { size: number; mime: string; name: string }) {
    const object = await this.bucket.get(key);
    if (!object) throw new Error("FILE_UPLOAD_MISSING");
    if (object.size !== expected.size || object.size > MAX_FILE_SIZE) {
      await object.body.cancel();
      throw new InvalidStoredFile("FILE_SIZE_MISMATCH");
    }
    const reader = object.body.getReader();
    async function* bytes() {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    }
    return inspectFileBytes(bytes(), expected, object.httpMetadata?.contentType);
  }

  private readGrant(request: Request): Grant | undefined {
    const token = new URL(request.url).searchParams.get("grant");
    if (!token || token.length > 4096 || !/^[\w-]+\.[\w-]{43}$/.test(token)) return;
    const [encoded, mac] = token.split(".");
    const signature = Buffer.from(mac, "base64url");
    if (signature.length !== 32 || !timingSafeEqual(signature, this.signature(encoded))) return;
    const grant = grantSchema.safeParse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    if (grant.success && grant.data.expires > Math.floor(Date.now() / 1000) && grant.data.transfer.method === request.method) return grant.data;
  }

  async transfer(request: Request, getSubject: () => Promise<string | undefined>) {
    const grant = this.readGrant(request);
    if (!grant || (grant.subject !== null && grant.subject !== await getSubject())) return new Response(null, { status: 404 });
    const transfer = grant.transfer;
    if (transfer.method === "GET") {
      const object = await this.bucket.get(grant.key);
      if (!object) return new Response(null, { status: 404 });
      return new Response(object.body, { headers: {
        "Content-Length": String(object.size), "Content-Type": "application/octet-stream",
        "Content-Disposition": downloadDisposition(transfer.name),
      } });
    }
    if (request.headers.get("origin") !== this.origin) return new Response(null, { status: 403 });
    if (request.headers.get("content-type") !== transfer.mime) return new Response(null, { status: 415 });
    if (request.headers.get("content-length") !== String(transfer.size) || !request.body) return new Response(null, { status: 400 });
    return this.put(grant.key, request.body, transfer,
      AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]));
  }

  private async put(key: string, body: ReadableStream<Uint8Array>, transfer: Extract<Grant["transfer"], { method: "PUT" }>,
    signal: AbortSignal) {
    // R2 requires a stream with a known length. Workerd rejects over- and under-length bodies.
    const stream = new FixedLengthStream(transfer.size);
    const [object, source] = await Promise.allSettled([
      this.bucket.put(key, stream.readable, {
        onlyIf: new Headers({ "If-None-Match": "*" }),
        httpMetadata: { contentType: transfer.mime }, sha256: transfer.checksum,
      }).finally(() => stream.readable.cancel().catch(() => undefined)),
      body.pipeTo(stream.writable, { signal }),
    ]);
    const stored = object.status === "fulfilled" && object.value && source.status === "fulfilled";
    return new Response(null, { status: stored ? 201 : 409 });
  }
}

// FixedLengthStream is a Workerd built-in. Its constructor is never used on Node.
declare const FixedLengthStream: new(size: number) => TransformStream<Uint8Array, Uint8Array>;
