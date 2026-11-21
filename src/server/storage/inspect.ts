import { createHash } from "node:crypto";
import { filenameMatchesMime } from "../../lib/files";
import { message } from "../../i18n/messages";
import { InvalidStoredFile } from "./adapter";

export async function inspectFileBytes(body: AsyncIterable<Uint8Array>, expected: { size: number; mime: string; name: string },
  contentType?: string, cancel?: () => void) {
  const expectedSize = expected.size;
  const hash = createHash("sha256");
  let size = 0;
  let prefix = Buffer.alloc(0);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let validText = true;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > expectedSize) {
      cancel?.();
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
  if (size !== expectedSize || mime !== expected.mime || mime !== contentType || !filenameMatchesMime(expected.name, mime)) {
    throw new InvalidStoredFile(message("Errors.storedBytesDeclaredTypeAndFilenameExtensionMust"));
  }
  return { size, mime, checksum: hash.digest("hex") };
}
