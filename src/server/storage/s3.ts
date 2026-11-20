import { message } from "../../i18n/messages";
import "server-only";
import { createHash } from "node:crypto";
import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { filenameMatchesMime, MAX_FILE_SIZE } from "../../lib/files";
import { downloadDisposition } from "../../lib/download-filename";
import { InvalidStoredFile, type StorageAdapter, type ImageMime, type MultipartStorage, type UploadObject, type UploadPart } from "./adapter";
import { connectStorage, type storageConfig } from "./s3-connection";

export class S3Storage implements StorageAdapter, MultipartStorage {
  private client: ReturnType<typeof connectStorage>;
  constructor(private config: ReturnType<typeof storageConfig>) {
    this.client = connectStorage(config);
  }
  async presignUpload(key: string, input: UploadObject) {
    const expiresIn = 300;
    const command = new PutObjectCommand({ Bucket: this.config.bucket, Key: key,
      ContentType: input.mime, ContentLength: input.size, IfNoneMatch: "*",
    });
    const url = await getSignedUrl(this.client, command, { expiresIn,
      signableHeaders: new Set(["content-type", "content-length", "if-none-match"]),
    });
    // The browser supplies Content-Length automatically from the File body.
    return { url, method: "PUT" as const, headers: { "Content-Type": input.mime, "If-None-Match": "*" }, expiresIn };
  }
  async startMultipart(key: string, mime: string) {
    const result = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.config.bucket, Key: key, ContentType: mime }),
      { abortSignal: AbortSignal.timeout(15_000) });
    if (!result.UploadId) throw new Error("MULTIPART_UNAVAILABLE");
    return result.UploadId;
  }
  async presignPart(key: string, uploadId: string, partNumber: number, size: number) {
    const expiresIn = 300;
    const command = new UploadPartCommand({ Bucket: this.config.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, ContentLength: size });
    const url = await getSignedUrl(this.client, command, { expiresIn, signableHeaders: new Set(["content-length"]) });
    return { url, method: "PUT" as const, headers: {}, expiresIn };
  }
  async completeMultipart(key: string, uploadId: string, parts: UploadPart[]) {
    await this.client.send(new CompleteMultipartUploadCommand({ Bucket: this.config.bucket, Key: key, UploadId: uploadId, IfNoneMatch: "*",
      MultipartUpload: { Parts: parts.map(part => ({ PartNumber: part.partNumber, ETag: part.etag })) },
    }), { abortSignal: AbortSignal.timeout(30_000) });
  }
  async abortMultipart(key: string, uploadId: string) {
    await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.config.bucket, Key: key, UploadId: uploadId }),
      { abortSignal: AbortSignal.timeout(15_000) });
  }
  async inspect(key: string, expected: { size: number; mime: string; name: string }) {
    const expectedSize = expected.size;
    const input = { Bucket: this.config.bucket, Key: key };
    const options = { abortSignal: AbortSignal.timeout(15_000) };
    const head = await this.client.send(new HeadObjectCommand(input), options);
    if (head.ContentLength !== expectedSize || expectedSize > MAX_FILE_SIZE) throw new InvalidStoredFile(message("Errors.storedSizeDiffersFromUploadIntent"));
    const object = await this.client.send(new GetObjectCommand({ ...input, IfMatch: head.ETag }), options);
    if (!object.Body) throw new InvalidStoredFile(message("Errors.missingUploadBody"));
    const hash = createHash("sha256");
    let size = 0;
    let prefix = Buffer.alloc(0);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let validText = true;
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > expectedSize) {
        (object.Body as { destroy?: () => void }).destroy?.();
        throw new InvalidStoredFile(message("Errors.storedFileExceedsExpectedSize"));
      }
      hash.update(chunk);
      if (prefix.length < 12) prefix = Buffer.concat([prefix, chunk.subarray(0, 12 - prefix.length)]);
      if (validText) {
        if (chunk.includes(0)) validText = false;
        else try { decoder.decode(chunk, { stream: true }); } catch { validText = false; }
      }
    }
    if (validText) try { decoder.decode(); } catch { validText = false; }
    const mime = prefix.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? "image/jpeg"
      : prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "image/png"
      : prefix.subarray(0, 4).equals(Buffer.from("RIFF")) && prefix.subarray(8, 12).equals(Buffer.from("WEBP")) ? "image/webp"
      : prefix.subarray(0, 5).equals(Buffer.from("%PDF-")) ? "application/pdf"
      : validText ? "text/plain" : null;
    if (size !== expectedSize || mime !== expected.mime || mime !== head.ContentType || !filenameMatchesMime(expected.name, mime)) {
      throw new InvalidStoredFile(message("Errors.storedBytesDeclaredTypeAndFilenameExtensionMust"));
    }
    return { size, mime, checksum: hash.digest("hex") };
  }
  presignDownload(key: string, name: string, options?: { inlineImage: ImageMime }) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key,
      ResponseContentDisposition: options ? "inline" : downloadDisposition(name),
      ResponseContentType: options?.inlineImage ?? "application/octet-stream", ResponseCacheControl: "private, no-store",
    }), { expiresIn: 60 });
  }
}
