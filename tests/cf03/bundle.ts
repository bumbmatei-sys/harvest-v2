import { build } from "esbuild";
import { join } from "node:path";

export async function bundleCf03(directory: string, entry: "fixture" | "harness" = "fixture") {
  const outfile = join(directory, entry === "fixture" ? "worker.mjs" : "harness.mjs");
  await build({
    entryPoints: [entry === "fixture" ? "src/worker/buffered-api.ts" : "tests/cf03/harness-worker.ts"], outfile, bundle: true, platform: "node", format: "esm",
    conditions: ["workerd", "react-server"], external: ["cloudflare:*", "pg-native"],
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
    plugins: [{
      name: "cf03-mailbox-only",
      setup(builder) {
        builder.onResolve({ filter: /^resend$/ }, () => ({ path: "mailbox", namespace: "cf03" }));
        builder.onLoad({ filter: /.*/, namespace: "cf03" }, () => ({
          // Never include a real provider client in either verification bundle.
          contents: `
            import { env } from "cloudflare:workers";
            export class Resend {
              constructor(key) {
                if (!key || key !== env.RESEND_API_KEY) throw new Error("MAILBOX_CONFIGURATION_INVALID");
              }
              emails = { send: async ({ from, to, text }) => {
                if (from !== env.EMAIL_FROM) throw new Error("MAILBOX_SENDER_INVALID");
                const result = await env.MAILBOX.fetch("https://mailbox.invalid", {
                  method: "POST", body: JSON.stringify({ to, text }),
                });
                return { data: null, error: result.ok ? null : "fixture rejected" };
              } };
            }
          `,
        }));
      },
    }],
  });
  return outfile;
}
