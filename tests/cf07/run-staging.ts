import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { checkForLeaks } from "../cf03/leak-scan";

// CF-07b hosted check of the whole app on the staging Worker: the same page sequence as tests/cf07/run-local.ts, over
// the real edge with Hyperdrive and Neon. The CF-03 harness supplies OTP codes and seeds ministries. Skips by default and
// in CI. The operator injects origins and tokens; nothing here prints them.
if (process.env.CI || process.env.CF07_RUN_STAGING !== "1") {
  console.log("SKIP CF-07 hosted staging verification");
} else {
  const origin = new URL(process.env.CF07_STAGING_ORIGIN ?? "").origin;
  const harness = new URL(process.env.CF07_HARNESS_ORIGIN ?? "").origin;
  const token = process.env.CF07_HARNESS_TOKEN ?? "";
  const needles = (process.env.CF07_NEEDLES ?? "").split(",").filter((value) => value.length >= 16);
  if (!origin.startsWith("https://") || !harness.startsWith("https://") || origin === harness || token.length < 32 || needles.length < 3) {
    throw new Error("Set CF07_STAGING_ORIGIN, CF07_HARNESS_ORIGIN, CF07_HARNESS_TOKEN and CF07_NEEDLES");
  }
  needles.push(token);
  let step = "setup";
  const seed = async <T>(path: string, body: object) => {
    const response = await fetch(new URL(path, harness), { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, `${step}: harness ${path} failed`);
    return await response.json() as T;
  };
  const send = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(new URL(path, origin), { ...init, redirect: "manual" });
    checkForLeaks("HTTP response", await response.clone().text() + JSON.stringify([...response.headers]), needles);
    assert.ok(!["HIT", "STALE", "REVALIDATED", "UPDATING"].includes(response.headers.get("cf-cache-status") ?? ""), `${step} was served from the edge cache`);
    return response;
  };
  const post = (body: object): RequestInit => ({ method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  async function signIn() {
    const email = `${randomUUID()}@example.invalid`;
    assert.equal((await send("/api/auth/email-otp/send-verification-otp", post({ email, type: "sign-in" }))).status, 200);
    const { code } = await seed<{ code: string | null }>("/code", { to: email });
    assert.ok(code, "Synthetic mailbox received one code");
    const response = await send("/api/auth/sign-in/email-otp", post({ email, otp: code }));
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const session = await (await send("/api/auth/get-session", { headers: { cookie } })).json() as { user: { id: string } };
    return { cookie, userId: session.user.id };
  }
  try {
    step = "public page";
    const signInPage = await send("/sign-in");
    assert.equal(signInPage.status, 200);
    assert.match(await signInPage.text(), /<html/i);
    assert.equal(signInPage.headers.get("cache-control"), "private, no-store");

    step = "static asset and manifest";
    assert.equal((await send("/manifest.webmanifest")).status, 200);

    step = "sign in and seed";
    const alice = await signIn(), bob = await signIn();
    const aliceName = `Alice ministry ${randomUUID().slice(0, 8)}`, bobName = `Bob ministry ${randomUUID().slice(0, 8)}`;
    await seed("/workspace", { user: alice.userId, name: aliceName });
    await seed("/workspace", { user: bob.userId, name: bobName });

    step = "signed-out page";
    const anonymous = await send("/workspaces");
    assert.ok([302, 303, 307, 308].includes(anonymous.status), "signed-out ministries page redirects");

    step = "rendered pages, concurrent";
    const page = async (who: typeof alice, own: string, other: string) => {
      const response = await send("/workspaces", { headers: { cookie: who.cookie } });
      assert.equal(response.status, 200, "ministries page renders");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const html = await response.text();
      assert.ok(html.includes(own) && !html.includes(other), "each page shows only the viewer's own ministry");
    };
    for (let round = 0; round < 5; round++) {
      await Promise.all(Array.from({ length: 10 }, (_, i) => i % 2 ? page(alice, aliceName, bobName) : page(bob, bobName, aliceName)));
    }

    step = "cancelled body";
    const cancelled = await send("/workspaces", { headers: { cookie: alice.cookie } });
    await cancelled.body?.cancel();

    console.log("PASS CF-07 hosted: sign-in page, manifest, OTP sign-in, signed-out redirect, 50 concurrent rendered pages from two users with no cross-user leak, private cache, no edge cache hit, cancelled body");
  } catch (error) {
    const detail = error instanceof assert.AssertionError ? `: ${error.message}` : "";
    console.error(`CF-07 hosted check failed during ${step}${detail}`);
    process.exitCode = 1;
  }
}
