import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { checkForLeaks } from "./leak-scan";

// CF-03 hosted check: repeats the local HTTP sequence against the deployed staging fixture (real edge, R2, Hyperdrive)
// and adds what only the hosted edge can show: Cloudflare's client IP header, edge cache bypass and real R2 write-once.
// Skips by default and in CI. The operator injects the staging origins and tokens; nothing here prints them.
if (process.env.CI || process.env.CF03_RUN_STAGING !== "1") {
  console.log("SKIP CF-03 hosted staging verification");
} else {
  const origin = new URL(process.env.CF03_STAGING_ORIGIN ?? "").origin;
  const harness = new URL(process.env.CF03_HARNESS_ORIGIN ?? "").origin;
  const token = process.env.CF03_HARNESS_TOKEN ?? "";
  const needles = (process.env.CF03_NEEDLES ?? "").split(",").filter((value) => value.length >= 16);
  if (!origin.startsWith("https://") || !harness.startsWith("https://") || origin === harness || token.length < 32 || needles.length < 3) {
    throw new Error("Set CF03_STAGING_ORIGIN, CF03_HARNESS_ORIGIN, CF03_HARNESS_TOKEN and CF03_NEEDLES");
  }
  needles.push(token);
  const spoofed = "192.0.2.99";
  let step = "setup";

  const seed = async <T>(path: string, body: object) => {
    const response = await fetch(new URL(path, harness), { method: "POST", headers: { authorization: `Bearer ${token}`,
      "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, `${step}: harness ${path} failed`);
    return await response.json() as T;
  };
  const send = async (path: string, expected: number, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    // The app must ignore these; the session check below proves it records Cloudflare's own client IP instead.
    headers.set("x-forwarded-for", spoofed);
    headers.set("x-real-ip", spoofed);
    const response = await fetch(new URL(path, origin), { ...init, headers, redirect: "manual" });
    const body = await response.clone().text();
    checkForLeaks("HTTP response", body + JSON.stringify([...response.headers]), needles);
    assert.equal(response.status, expected, `${step} returned an unexpected status`);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.ok(!["HIT", "STALE", "REVALIDATED", "UPDATING"].includes(response.headers.get("cf-cache-status") ?? ""), `${step} was served from the edge cache`);
    return response;
  };
  const post = (body?: object, cookie?: string, from = origin): RequestInit => ({ method: "POST",
    headers: { origin: from, "content-type": "application/json", ...(cookie && { cookie }) }, body: body && JSON.stringify(body) });

  async function signIn() {
    const email = `${randomUUID()}@example.invalid`;
    await send("/api/auth/email-otp/send-verification-otp", 200, post({ email, type: "sign-in" }));
    const { code: otp } = await seed<{ code: string | null }>("/code", { to: email });
    assert.ok(otp, "Synthetic mailbox received one code");
    const response = await send("/api/auth/sign-in/email-otp", 200, post({ email, otp }));
    assert.ok(!("token" in await response.json()), "Sign-in JSON omits the session token");
    const sessionCookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith("__Secure-harvest-staging.session_token="));
    assert.ok(sessionCookie, "Session cookie has the staging name");
    for (const attribute of [/; Secure\b/i, /; HttpOnly\b/i, /; SameSite=Lax\b/i, /; Path=\/(?:;|$)/i, /; Max-Age=604800\b/i]) {
      assert.ok(attribute.test(sessionCookie), "Session cookie attribute is present");
    }
    assert.ok(!/; Domain=/i.test(sessionCookie), "Session cookie is host only");
    const cookie = sessionCookie.split(";")[0];
    const { user, session } = await (await send("/api/auth/get-session", 200, { headers: { cookie } })).json() as {
      user: { id: string }; session: Record<string, unknown>;
    };
    assert.ok(session && !("token" in session), "Session JSON omits the session token");
    await send("/api/auth/sign-in/email-otp", 400, post({ email, otp }));
    return { cookie, userId: user.id, email };
  }

  try {
    step = "OTP and cookies";
    const alice = await signIn();
    const bob = await signIn();
    const a = { cookie: alice.cookie }, b = { cookie: bob.cookie };
    await send("/api/workspaces", 200, { headers: a });
    await send("/api/workspaces", 401, { headers: { cookie: alice.cookie.replace("harvest-staging.", "harvest-production.") } });

    step = "client IP";
    // Cloudflare refuses a client-supplied cf-connecting-ip at the edge (error 1000) before the Worker runs.
    const forged = await fetch(new URL("/api/auth/get-session", origin), { headers: { "cf-connecting-ip": spoofed } });
    assert.equal(forged.status, 403, "The edge refuses a forged cf-connecting-ip");
    const { ips } = await seed<{ ips: (string | null)[] }>("/session-ip", { user: alice.userId });
    assert.ok(ips.length === 1 && ips[0] && ips[0] !== spoofed, "Session records Cloudflare's client IP, not the spoofed header");

    step = "closed gates and origin";
    await send("/api/qa/otp", 404);
    await send("/api/auth/email-otp/send-verification-otp", 403,
      post({ email: `${randomUUID()}@example.invalid`, type: "sign-in" }, undefined, "https://production.example.invalid"));

    step = "file upload and download";
    const { tenantId: workspace } = await seed<{ tenantId: string }>("/workspace", { user: alice.userId, name: "CF-03 staging fixture" });
    const path = `/api/workspaces/${workspace}/files`;
    const bytes = Buffer.from("CF-03 private file fixture\n");
    const input = { name: "fixture.txt", mime: "text/plain", size: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") };
    await send(path, 403, post(input, bob.cookie));
    await send(path, 400, post({ ...input, size: 10 * 1024 * 1024 + 1 }, alice.cookie));
    await send(path, 400, post({ ...input, mime: "text/html" }, alice.cookie));
    const { file, upload } = await (await send(path, 201, post(input, alice.cookie))).json() as {
      file: { id: string }; upload: { url: string; headers: Record<string, string> };
    };
    const filePath = `${path}/${file.id}`;
    const put: RequestInit = { method: "PUT", headers: { ...upload.headers, ...a, origin }, body: bytes };
    await send(upload.url, 404, { ...put, headers: { ...upload.headers, ...b, origin } });
    await send(upload.url, 415, { ...put, headers: { ...a, origin, "content-type": "text/html" } });
    await send(upload.url, 400, { ...put, body: Buffer.concat([bytes, bytes]) });
    await send(upload.url, 409, { ...put, body: Buffer.alloc(bytes.length, 65) });
    await send(upload.url, 201, put);
    await send(upload.url, 409, put);
    const confirmed = await send(`${filePath}/confirm`, 200, post({}, alice.cookie));
    assert.equal((await confirmed.json()).status, "ready");
    const { url } = await (await send(`${filePath}/download`, 200, { headers: a })).json() as { url: string };
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await send(url, 200, { headers: a });
      assert.ok(Buffer.from(await result.arrayBuffer()).equals(bytes), "Download equals original bytes");
      assert.equal(result.headers.get("content-type"), "application/octet-stream");
      assert.ok(result.headers.get("content-disposition")?.startsWith("attachment"));
    }
    await send(url, 404, { headers: b });
    await send(url, 404);
    await send(url + "x", 404, { headers: a });
    await send(`/api/files/public/${workspace}/${file.id}`, 404);

    step = "guest resource and uploader rules";
    await seed("/catalog", { user: alice.userId, tenant: workspace, slug: `cf03-${workspace.slice(0, 8)}`, file: file.id });
    const catalog = `/api/catalog/cf03-${workspace.slice(0, 8)}/files/${file.id}`;
    await send(catalog, 404, { headers: b });
    await seed("/enrol", { user: bob.userId, slug: `cf03-${workspace.slice(0, 8)}` });
    const guest = await (await send(catalog, 200, { headers: b })).json() as { url: string };
    await send(guest.url, 200, { headers: b });
    await send(guest.url, 404, { headers: a });
    await seed("/member", { actor: alice.userId, tenant: workspace, email: bob.email });
    await send(`${filePath}/confirm`, 403, post(undefined, bob.cookie));

    step = "sign out";
    const signedOut = await send("/api/auth/sign-out", 200, post({}, alice.cookie));
    assert.ok(signedOut.headers.getSetCookie().some((cookie) =>
      cookie.startsWith("__Secure-harvest-staging.session_token=;") && /; Max-Age=0\b/i.test(cookie) &&
      /; Secure\b/i.test(cookie) && /; HttpOnly\b/i.test(cookie) && !/; Domain=/i.test(cookie)), "Sign-out clears the same host-only cookie");
    await send("/api/workspaces", 401, { headers: a });
    await send(url, 404, { headers: a });
    await send("/api/workspaces", 200, { headers: b });
    console.log("PASS hosted Workers OTP, cookies, client IP, closed gates, R2 transfers, guest authorization and edge cache bypass");
  } catch (error) {
    const message = error instanceof assert.AssertionError && typeof error.actual === "number" && typeof error.expected === "number"
      ? ` (status ${error.actual}, expected ${error.expected})` : "";
    console.error(`CF-03 hosted check failed during ${step}${message}`);
    process.exitCode = 1;
  }
}
