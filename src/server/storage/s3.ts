import { message } from "../../i18n/messages";
import "server-only";
import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { filenameMatchesMime, MAX_FILE_SIZE, type UploadInput } from "../../lib/files";
import { InvalidStoredFile, type StorageAdapter } from "./adapter";

export class S3Storage implements StorageAdapter {
  private client: S3Client;
  constructor(private config: { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string }) {
    const endpoint = new URL(config.endpoint);
    if (endpoint.username || endpoint.password || !["http:", "https:"].includes(endpoint.protocol)) throw new Error(message("Errors.invalidS3Endpoint"));
    if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) throw new Error(message("Errors.storageRequiresHttps"));
    this.client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", maxAttempts: 2,
    });
  }
  async presignUpload(key: string, input: UploadInput) {
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
  presignDownload(key: string, name: string) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, "%27")}`,
      ResponseContentType: "application/octet-stream", ResponseCacheControl: "private, no-store",
    }), { expiresIn: 60 });
  }
}
