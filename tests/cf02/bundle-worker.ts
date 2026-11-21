import { build } from "esbuild";
import { join } from "node:path";

export async function bundleWorker(directory: string, local = false) {
  const script = join(directory, "worker.mjs");
  await build({
    entryPoints: [local ? "tests/cf02/local-worker.ts" : "tests/cf02/worker.ts"],
    outfile: script, bundle: true, platform: "node", format: "esm",
    // Use the same pg socket and CommonJS resolution as CF-01's db-probe.mts.in.
    conditions: ["workerd", "react-server"], external: ["cloudflare:*", "pg-native"],
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
    plugins: [{
      name: "fixture-mail-only",
      setup(builder) {
        builder.onResolve({ filter: /^resend$/ }, () => ({ path: "mailbox", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: local
            ? 'import { env } from "cloudflare:workers"; export class Resend { emails = { send: async (message) => { await env.MAILBOX.fetch("http://mailbox.invalid", { method: "POST", body: message.text }); return { data: { id: "fixture" }, error: null }; } }; }'
            : 'export class Resend { constructor() { throw new Error("STAGING_SEND_FORBIDDEN"); } }',
        }));
      },
    }],
  });
  return script;
}
