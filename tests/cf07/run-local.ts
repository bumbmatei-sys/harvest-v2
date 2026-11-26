import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { testDatabase } from "../database";

// CF-07 local check of the whole app on workerd: the OpenNext pages run inside the request-scoped database and auth
// context from src/worker/app.ts. Prerequisites (see docs/plans/cf-07-app-on-workers.md): `opennextjs-cloudflare build`,
// then `wrangler deploy --dry-run --outdir` with the CF-07 config. Inputs: CF07_MINIFLARE_MODULE (Miniflare entry),
// CF07_SCRIPT (the bundled app-worker.js) and CF07_ASSETS (.open-next/assets), all absolute paths.
type Runtime = { dispatchFetch(url: string, init?: RequestInit): Promise<Response>; dispose(): Promise<void> };
const modulePath = process.env.CF07_MINIFLARE_MODULE, scriptPath = process.env.CF07_SCRIPT, assets = process.env.CF07_ASSETS;
if (!modulePath?.startsWith("/") || !scriptPath?.startsWith("/") || !assets?.startsWith("/")) {
  throw new Error("Set absolute CF07_MINIFLARE_MODULE, CF07_SCRIPT and CF07_ASSETS paths");
}
const { Miniflare, convertV4MiniflareOptions } = await import(modulePath) as {
  Miniflare: new (options: object) => Runtime; convertV4MiniflareOptions(options: object): object;
};
delete process.env.TEST_DATABASE_URL;
const marker = registerHooks({
  resolve: (name, context, next) => name === "server-only" ? { url: "data:text/javascript,export%20{}", shortCircuit: true } : next(name, context),
});
const { createWorkspace } = await import("../../src/server/workspaces");
marker.deregister();

const fixture = await testDatabase({ migrationOwner: true });
const origin = "https://preview.example.invalid";
const codes = new Map<string, string>();
const database = decodeURIComponent(new URL(fixture.appURL).pathname.slice(1));
let runtime: Runtime | undefined;
let step = "start runtime";
try {
  runtime = new Miniflare(convertV4MiniflareOptions({
    cf: false, host: "127.0.0.1", scriptPath, modules: true, modulesRoot: scriptPath.replace(/\/[^/]+$/, ""),
    compatibilityDate: "2026-11-19", compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    assets: { directory: assets, binding: "ASSETS", routerConfig: { has_user_worker: true }, assetConfig: { html_handling: "none" } }, hyperdrives: { APP_HYPERDRIVE: fixture.appURL }, r2Buckets: { FILES: "cf07-files" },
    bindings: {
      HARVEST_ENV: "preview", HARVEST_PRODUCTION_ORIGIN: "https://production.example.invalid", BETTER_AUTH_URL: origin,
      APP_DATABASE_NAME: database, BETTER_AUTH_SECRET: randomBytes(40).toString("base64url"),
      FILE_GRANT_SECRET: randomBytes(40).toString("base64url"), RESEND_API_KEY: randomBytes(24).toString("base64url"),
      EMAIL_FROM: "fixture@example.invalid", NEXT_TELEMETRY_DISABLED: "1",
    },
    serviceBindings: { MAILBOX: async (request: Request) => {
      const { to, text } = await request.json() as { to: string; text: string };
      const code = /\b\d{6}\b/.exec(text)?.[0];
      if (!code || !to.endsWith("@example.invalid")) return new Response(null, { status: 400 });
      codes.set(to, code);
      return new Response(null, { status: 204 });
    } },
  }));
  const current = runtime;
  const send = (path: string, init: RequestInit = {}) => current.dispatchFetch(new URL(path, origin).href, { ...init, redirect: "manual" });
  const post = (body: object): RequestInit => ({ method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": "192.0.2.7" }, body: JSON.stringify(body) });

  step = "public page";
  const signInPage = await send("/sign-in");
  assert.equal(signInPage.status, 200, "sign-in page renders");
  assert.match(await signInPage.text(), /<html/i);

  step = "sign in";
  async function signIn() {
    const email = `${randomUUID()}@example.invalid`;
    assert.equal((await send("/api/auth/email-otp/send-verification-otp", post({ email, type: "sign-in" }))).status, 200);
    const response = await send("/api/auth/sign-in/email-otp", post({ email, otp: codes.get(email) }));
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const session = await (await send("/api/auth/get-session", { headers: { cookie } })).json() as { user: { id: string } };
    return { cookie, userId: session.user.id };
  }
  const alice = await signIn(), bob = await signIn();
  const aliceName = `Alice ministry ${randomUUID().slice(0, 8)}`, bobName = `Bob ministry ${randomUUID().slice(0, 8)}`;
  await createWorkspace(fixture.db, alice.userId, aliceName);
  await createWorkspace(fixture.db, bob.userId, bobName);

  step = "signed-out page";
  const anonymous = await send("/workspaces");
  assert.ok([302, 303, 307, 308].includes(anonymous.status), "signed-out ministries page redirects");
  await anonymous.text();

  step = "rendered pages on one isolate, interleaved";
  const page = async (who: typeof alice, own: string, other: string) => {
    const response = await send("/workspaces", { headers: { cookie: who.cookie } });
    assert.equal(response.status, 200, "ministries page renders");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const html = await response.text();
    assert.ok(html.includes(own), "page shows the viewer's own ministry");
    assert.ok(!html.includes(other), "page never shows another viewer's ministry");
  };
  for (let round = 0; round < 3; round++) {
    await Promise.all(Array.from({ length: 8 }, (_, i) => i % 2 ? page(alice, aliceName, bobName) : page(bob, bobName, aliceName)));
  }

  step = "cancelled body";
  const cancelled = await send("/workspaces", { headers: { cookie: alice.cookie } });
  await cancelled.body?.cancel();

  step = "connections released";
  const busy = async () => (await fixture.admin.query<{ n: number }>(`select count(*)::int as n from pg_stat_activity
    where datname = current_database() and usename = 'harvest_app' and state is distinct from 'idle'`)).rows[0].n;
  let active = await busy();
  for (let attempt = 0; active > 0 && attempt < 50; attempt++) { await new Promise((r) => setTimeout(r, 100)); active = await busy(); }
  assert.equal(active, 0, "no app session is left active after pages finish or are cancelled");
  console.log("PASS CF-07 local: sign-in page, OTP sign-in, signed-out redirect, 24 interleaved rendered pages with no cross-user leak, private cache header, cancelled body, no active connection left");
} catch (error) {
  const detail = error instanceof assert.AssertionError ? `: ${error.message}` : error instanceof Error ? `: ${error.name}` : "";
  console.error(`CF-07 local check failed during ${step}${detail}`);
  process.exitCode = 1;
} finally {
  await runtime?.dispose();
  await fixture.close();
}
