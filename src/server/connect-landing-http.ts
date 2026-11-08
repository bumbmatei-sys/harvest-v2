import { AccessError } from "./permissions";
import { message } from "../i18n/messages";
export async function landingBody(request: Request) {
  // Bound the stream, including chunked requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError(400, message("LandingEditor.invalid"));
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); throw new AccessError(400, message("LandingEditor.invalid")); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
