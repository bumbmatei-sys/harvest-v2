import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { MAX_FILE_SIZE, type UploadInput } from "../../lib/files";
import { InvalidStoredFile, type StorageAdapter } from "./adapter";

export class S3Storage implements StorageAdapter {
  private client: S3Client;
  constructor(private config: { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string }) {
    const endpoint = new URL(config.endpoint);
    if (endpoint.username || endpoint.password || !["http:", "https:"].includes(endpoint.protocol)) throw new Error("Invalid S3 endpoint.");
    if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) throw new Error("S3 requires HTTPS outside localhost.");
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
  async inspect(key: string, expectedSize: number) {
    const input = { Bucket: this.config.bucket, Key: key };
    const options = { abortSignal: AbortSignal.timeout(15_000) };
    const head = await this.client.send(new HeadObjectCommand(input), options);
    if (head.ContentLength !== expectedSize || expectedSize > MAX_FILE_SIZE) throw new InvalidStoredFile("Stored size differs from upload intent.");
    const object = await this.client.send(new GetObjectCommand({ ...input, IfMatch: head.ETag }), options);
    if (!object.Body) throw new InvalidStoredFile("Missing upload body.");
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > expectedSize) {
        (object.Body as { destroy?: () => void }).destroy?.();
        throw new InvalidStoredFile("Stored file exceeds expected size.");
      }
      hash.update(chunk);
    }
    return { size, mime: head.ContentType ?? "", checksum: hash.digest("hex") };
  }
  presignDownload(key: string, name: string) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, "%27")}`,
      ResponseContentType: "application/octet-stream", ResponseCacheControl: "private, no-store",
    }), { expiresIn: 60 });
  }
}
