// Test-only stand-in for the Resend client in CF-07 bundles: hands each message to the MAILBOX service binding.
import { env } from "cloudflare:workers";
export class Resend {
  constructor(key) { if (!key || key !== env.RESEND_API_KEY) throw new Error("MAILBOX_CONFIGURATION_INVALID"); }
  emails = { send: async ({ from, to, text }) => {
    if (from !== env.EMAIL_FROM) throw new Error("MAILBOX_SENDER_INVALID");
    const result = await env.MAILBOX.fetch("https://mailbox.invalid/", { method: "POST", body: JSON.stringify({ to, text }) });
    return { data: null, error: result.ok ? null : "fixture rejected" };
  } };
}
