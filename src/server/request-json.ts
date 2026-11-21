import { message } from "../i18n/messages";
import { AccessError } from "./permissions";

export async function readBoundedJson(request: Request, maxBytes: number,
  tooLarge: () => Error = () => new AccessError(400, message("Errors.checkTheSuppliedDetails"))): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      throw new SyntaxError();
    }
  } finally {
    reader.releaseLock();
  }
}
