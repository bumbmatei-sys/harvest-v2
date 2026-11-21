import { runtimeConnectionString, type DatabaseRole } from "../../src/db/request";
import { runProbes } from "./run-probes";

if (process.env.CI || process.env.CF02_RUN_STAGING !== "1") {
  console.log("SKIP CF-02 Neon and Hyperdrive staging verification");
} else {
  function origin(value: string | undefined, role: DatabaseRole) {
    const url = new URL(runtimeConnectionString(value, role));
    if (!url.hostname.endsWith(".neon.tech") || url.hostname.split(".")[0].endsWith("-pooler")) {
      throw new Error("Expected a direct Neon staging origin");
    }
    return { host: url.host, database: decodeURIComponent(url.pathname.slice(1)) };
  }
  const app = origin(process.env.CF02_NEON_URL_APP, "app");
  const worker = origin(process.env.CF02_NEON_URL_WORKER, "worker");
  if (app.host !== worker.host || app.database !== worker.database) {
    throw new Error("Staging configurations must target the same Neon origin and database");
  }
  const token = process.env.CF02_PROBE_TOKEN;
  const endpoint = process.env.CF02_STAGING_ENDPOINT;
  if (!token || token.length < 32 || !endpoint) throw new Error("Staging probe URL and independent probe token are required");
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1"))) {
    throw new Error("Expected a staging HTTPS origin or Wrangler's loopback address");
  }
  await runProbes(fetch, url.href, token, [app.database, worker.database], false);
}
