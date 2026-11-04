// Included only in the development-only E2E webpack build. No network access.
import { appendFile } from "node:fs/promises";
export class Resend {
  emails = { send: async (message: { to: string; text: string }) => {
    const path = process.env.HARVEST_E2E_MAILBOX;
    if (!path) throw new Error("E2E mailbox is missing");
    await appendFile(path, `${JSON.stringify(message)}\n`, { mode: 0o600 });
    return { data: { id: "e2e-mock" }, error: null };
  } };
}
