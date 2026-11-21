import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { testDatabase } from "../database";
import { bundleCf03 } from "./bundle";
import { checkClientAssets, checkForLeaks } from "./leak-scan";

type Runtime = {
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>;
  dispose(): Promise<void>;
};
const modulePath = process.env.CF03_MINIFLARE_MODULE;
const assetPath = process.env.CF03_CLIENT_ASSETS;
if (!modulePath?.startsWith("/") || !assetPath?.startsWith("/")) {
  throw new Error("Set absolute CF03_MINIFLARE_MODULE and CF03_CLIENT_ASSETS paths");
}
const { Miniflare, Log, convertV4MiniflareOptions } = await import(modulePath) as {
  Miniflare: new (options: object) => Runtime;
  Log: new (level: number) => { log(message: string): void };
  convertV4MiniflareOptions(options: object): object;
};

delete process.env.TEST_DATABASE_URL;
const root = await mkdtemp(join(tmpdir(), "harvest-cf03-"));
const runtimes: Runtime[] = [];
const databases: Awaited<ReturnType<typeof testDatabase>>[] = [];
const secret = () => randomBytes(45).toString("base64url");
const needles = [process.env.CF03_BUILD_CANARY ?? ""];
let logLeak = false;
function capture(line: string) {
  try { checkForLeaks("runtime log", line, needles); } catch { logLeak = true; }
}
const originalWrite = process.stdout.write;
const originalErrorWrite = process.stderr.write;
const captureWrite = ((chunk: string | Uint8Array) => {
  capture(String(chunk));
  return true;
}) as typeof originalWrite;
process.stdout.write = captureWrite;
process.stderr.write = captureWrite;
let step = "build runtime";
try {
  const script = await readFile(await bundleCf03(root), "utf8");
  const marker = registerHooks({
    resolve: (name, context, next) => name === "server-only" ? { url: "data:text/javascript,export%20{}", shortCircuit: true } : next(name, context),
  });
  const { createCatalogItem, enrolInCatalogItem, setCatalogState } = await import("../../src/server/free-catalog");
  const { createWorkspace, putMember } = await import("../../src/server/workspaces");
  marker.deregister();
  const codes = new Map<string, string>();
  async function makeRuntime(stage: "preview" | "production", appURL?: string, absentSecret = false) {
    // Local fixture credentials are generated in memory and use embedded PostgreSQL only.
    const origin = `https://${stage}.example.invalid`;
    const parsed = appURL && new URL(appURL);
    const bindings = {
      HARVEST_ENV: stage, HARVEST_PRODUCTION_ORIGIN: "https://production.example.invalid", BETTER_AUTH_URL: origin, APP_DATABASE_NAME: parsed && parsed.pathname.slice(1),
      BETTER_AUTH_SECRET: absentSecret ? undefined : secret(), FILE_GRANT_SECRET: secret(),
      RESEND_API_KEY: secret(), EMAIL_FROM: "fixture@example.invalid",
    };
    needles.push(bindings.BETTER_AUTH_SECRET ?? "", bindings.FILE_GRANT_SECRET, bindings.RESEND_API_KEY, parsed ? parsed.password : "");
    const log = new Log(5);
    log.log = capture;
    const runtime = new Miniflare(convertV4MiniflareOptions({
      cf: false, host: "127.0.0.1", script, modules: true, compatibilityDate: "2026-11-19",
      compatibilityFlags: ["nodejs_compat"], log, liveReload: false,
      hyperdrives: appURL ? { APP_HYPERDRIVE: appURL } : {},
      r2Buckets: { FILES: `cf03-${stage}` },
      bindings: Object.fromEntries(Object.entries(bindings).filter(([, value]) => value !== undefined)),
      serviceBindings: { MAILBOX: async (request: Request) => {
        const { to, text } = await request.json() as { to: string; text: string };
        const code = /\b\d{6}\b/.exec(text)?.[0];
        if (!code || !to.endsWith("@example.invalid") || codes.has(to)) return new Response(null, { status: 400 });
        codes.set(to, code);
        return new Response(null, { status: 204 });
      } },
    }));
    runtimes.push(runtime);
    const send = async (path: string, expected: number, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("cf-connecting-ip", "192.0.2.21");
      const response = await runtime.dispatchFetch(new URL(path, origin).href, { ...init, headers, redirect: "manual" });
      const responseBody = await response.clone().text();
      // Scan headers and bodies without printing either, including on assertion failure.
      checkForLeaks("HTTP response", responseBody + JSON.stringify([...response.headers]), needles);
      assert.equal(response.status, expected, `${step} returned an unexpected status`);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      return response;
    };
    return { origin, send };
  }

  type TestClient = Awaited<ReturnType<typeof makeRuntime>>;
  function post(origin: string, body?: object, cookie?: string): RequestInit {
    return { method: "POST", headers: { origin, "content-type": "application/json", ...(cookie && { cookie }) },
      body: body && JSON.stringify(body) };
  }
  async function signIn(client: TestClient, stage: string) {
    const email = `${randomUUID()}@example.invalid`;
    await client.send("/api/auth/email-otp/send-verification-otp", 200, post(client.origin, { email, type: "sign-in" }));
    const otp = codes.get(email);
    assert.ok(otp, "Fake mailbox received one code");
    const response = await client.send("/api/auth/sign-in/email-otp", 200, post(client.origin, { email, otp }));
    assert.ok(!("token" in await response.json()), "Sign-in JSON omits the session token");
    const sessionCookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`__Secure-harvest-${stage}.session_token=`));
    assert.ok(sessionCookie, "Session cookie has a stage-specific name");
    for (const attribute of [/; Secure\b/i, /; HttpOnly\b/i, /; SameSite=Lax\b/i, /; Path=\/(?:;|$)/i, /; Max-Age=604800\b/i]) {
      assert.ok(attribute.test(sessionCookie), "Session cookie attribute is present");
    }
    assert.ok(!/; Domain=/i.test(sessionCookie), "Session cookie is host only");
    const cookie = sessionCookie.split(";")[0];
    const { user, session } = await (await client.send("/api/auth/get-session", 200, { headers: { cookie } })).json() as {
      user: { id: string }; session: Record<string, unknown>;
    };
    assert.ok(session && !("token" in session), "Session JSON omits the session token");
    assert.ok(user?.id, "Cookie resolves to a database session");
    await client.send("/api/auth/sign-in/email-otp", 400, post(client.origin, { email, otp }));
    return { cookie, userId: user.id, email };
  }

  step = "embedded database";
  const fixture = await testDatabase({ migrationOwner: true });
  databases.push(fixture);
  const productionDb = await testDatabase({ migrationOwner: true });
  databases.push(productionDb);
  const preview = await makeRuntime("preview", fixture.appURL);
  const production = await makeRuntime("production", productionDb.appURL);
  step = "OTP and cookies";
  const alice = await signIn(preview, "preview");
  const bob = await signIn(preview, "preview");
  const prod = await signIn(production, "production");
  const a = { cookie: alice.cookie }, b = { cookie: bob.cookie };
  await preview.send("/api/workspaces", 200, { headers: a });
  await preview.send("/api/workspaces", 401, { headers: { cookie: prod.cookie } });
  await production.send("/api/workspaces", 401, { headers: a });
  await production.send("/api/workspaces", 401, { headers: { cookie: alice.cookie.replace("harvest-preview.", "harvest-production.") } });
  await production.send("/api/workspaces", 200, { headers: { cookie: prod.cookie } });
  step = "closed configuration and origin";
  const broken = await makeRuntime("production", productionDb.appURL, true);
  await broken.send("/api/auth/get-session", 503);
  await production.send("/api/qa/otp", 404);
  await preview.send(`${production.origin}/api/auth/get-session`, 421);
  await preview.send("/api/auth/email-otp/send-verification-otp", 403,
    post(production.origin, { email: "wrong-origin@example.invalid", type: "sign-in" }));

  step = "file upload and download";
  const workspace = (await createWorkspace(fixture.db, alice.userId, "CF-03 fixture")).tenantId;
  const path = `/api/workspaces/${workspace}/files`;
  const bytes = Buffer.from("CF-03 private file fixture\n");
  const input = { name: "fixture.txt", mime: "text/plain", size: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex") };
  await preview.send(path, 403, post(preview.origin, input, bob.cookie));
  await preview.send(path, 400, post(preview.origin, { ...input, size: 10 * 1024 * 1024 + 1 }, alice.cookie));
  await preview.send(path, 400, post(preview.origin, { ...input, mime: "text/html" }, alice.cookie));
  const { file, upload } = await (await preview.send(path, 201, post(preview.origin, input, alice.cookie))).json() as {
    file: { id: string }; upload: { url: string; headers: Record<string, string> };
  };
  const filePath = `${path}/${file.id}`;
  const put: RequestInit = { method: "PUT", headers: { ...upload.headers, ...a, origin: preview.origin }, body: bytes };
  await preview.send(upload.url, 404, { ...put, headers: { ...upload.headers, ...b, origin: preview.origin } });
  await preview.send(upload.url, 415, { ...put, headers: { ...a, origin: preview.origin, "content-type": "text/html" } });
  await preview.send(upload.url, 400, { ...put, body: Buffer.concat([bytes, bytes]) });
  await preview.send(upload.url, 409, { ...put, body: Buffer.alloc(bytes.length, 65) });
  await preview.send(upload.url, 201, put);
  await preview.send(upload.url, 409, put);
  const confirmed = await preview.send(`${filePath}/confirm`, 200, post(preview.origin, {}, alice.cookie));
  assert.equal((await confirmed.json()).status, "ready");
  const { url } = await (await preview.send(`${filePath}/download`, 200, { headers: a })).json() as { url: string };
  const result = await preview.send(url, 200, { headers: a });
  assert.ok(Buffer.from(await result.arrayBuffer()).equals(bytes), "Download equals original bytes");
  assert.equal(result.headers.get("content-type"), "application/octet-stream");
  assert.ok(result.headers.get("content-disposition")?.startsWith("attachment"));
  await preview.send(url, 404, { headers: b });
  await preview.send(url, 404);
  await preview.send(url + "x", 404, { headers: a });
  await production.send(url.replace(preview.origin, production.origin), 404, { headers: { cookie: prod.cookie } });
  await preview.send(`/api/files/public/${workspace}/${file.id}`, 404);

  step = "guest resource and uploader rules";
  const draft = await createCatalogItem(fixture.db, alice.userId, workspace, {
    kind: "download", title: "Fixture download", visibility: "listed", slug: "cf03-download", fileIds: [file.id],
  });
  await setCatalogState(fixture.db, alice.userId, workspace, draft.id, { version: 1, state: "published" });
  const catalog = `/api/catalog/cf03-download/files/${file.id}`;
  await preview.send(catalog, 404, { headers: b });
  await enrolInCatalogItem(fixture.db, bob.userId, "cf03-download");
  const guest = await (await preview.send(catalog, 200, { headers: b })).json() as { url: string };
  await preview.send(guest.url, 200, { headers: b });
  await preview.send(guest.url, 404, { headers: a });
  await putMember(fixture.db, alice.userId, workspace, bob.email, "member");
  await preview.send(`${filePath}/confirm`, 403, post(preview.origin, undefined, bob.cookie));
  step = "public download cache rules";
  // Seed the post-scan state. The real public scanner is a separate activation decision.
  await fixture.admin.query("update files set visibility = 'public' where id = $1", [file.id]);
  const redirect = await preview.send(`/api/files/public/${workspace}/${file.id}`, 302);
  assert.equal(redirect.headers.get("referrer-policy"), "no-referrer");
  const publicUrl = redirect.headers.get("location");
  assert.ok(publicUrl, "Ready public file redirects to a short-lived transfer");
  const publicFile = await preview.send(publicUrl, 200);
  assert.ok(Buffer.from(await publicFile.arrayBuffer()).equals(bytes), "Public download matches the uploaded bytes");

  step = "sign out";
  const signedOut = await preview.send("/api/auth/sign-out", 200, post(preview.origin, {}, alice.cookie));
  assert.ok(signedOut.headers.getSetCookie().some((cookie) =>
    cookie.startsWith("__Secure-harvest-preview.session_token=;") && /; Max-Age=0\b/i.test(cookie) &&
    /; Secure\b/i.test(cookie) && /; HttpOnly\b/i.test(cookie) && !/; Domain=/i.test(cookie)), "Sign-out clears the same host-only cookie");
  await preview.send("/api/workspaces", 401, { headers: a });
  await preview.send(url, 404, { headers: a });
  await preview.send("/api/workspaces", 200, { headers: b });

  step = "leak scans";
  const scanned = await checkClientAssets(assetPath, needles);
  assert.ok(!logLeak, "Runtime logs contain no fixture secrets");
  originalWrite.call(process.stdout, `PASS local Workers OTP, cookies, production gate, R2 transfers, guest authorization and cache headers; scanned ${scanned} client assets\n`);
} catch (error) {
  const message = error instanceof assert.AssertionError && typeof error.actual === "number" && typeof error.expected === "number"
    ? ` (status ${error.actual}, expected ${error.expected})` : "";
  originalErrorWrite.call(process.stderr, `CF-03 local check failed during ${step}${message}\n`);
  process.exitCode = 1;
} finally {
  try {
    await Promise.all(runtimes.map((runtime) => runtime.dispose()));
    await Promise.all(databases.map((database) => database.close()));
    await rm(root, { recursive: true, force: true });
    assert.ok(!logLeak, "Runtime shutdown logs contain no fixture secrets");
  } catch {
    originalErrorWrite.call(process.stderr, "CF-03 runtime cleanup or leak scan failed\n");
    process.exitCode = 1;
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalErrorWrite;
  }
}
