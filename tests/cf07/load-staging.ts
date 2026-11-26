import { randomUUID } from "node:crypto";

// CF-07c load profile against the Cloudflare STAGING Worker only. Signs in two synthetic users through the staging
// mailbox helper, then runs a fixed number of rendered-page requests at a fixed concurrency and reports p50/p95/p99
// latency, error counts and status mix. Skips by default and in CI; never point it at production.
if (process.env.CI || process.env.CF07_RUN_LOAD !== "1") {
  console.log("SKIP CF-07 staging load profile");
} else {
  const origin = new URL(process.env.CF07_STAGING_ORIGIN ?? "").origin;
  const harness = new URL(process.env.CF07_HARNESS_ORIGIN ?? "").origin;
  const token = process.env.CF07_HARNESS_TOKEN ?? "";
  const total = Number(process.env.CF07_LOAD_REQUESTS ?? 400);
  const concurrency = Number(process.env.CF07_LOAD_CONCURRENCY ?? 20);
  if (!origin.endsWith(".workers.dev") || !harness.startsWith("https://") || token.length < 32 || !(total > 0 && concurrency > 0 && concurrency <= 50)) {
    throw new Error("Set the staging workers.dev origin, the helper origin and token; concurrency 1..50");
  }
  const json = { "content-type": "application/json" };
  const seed = async <T>(path: string, body: object) => {
    const response = await fetch(new URL(path, harness), { method: "POST", headers: { authorization: `Bearer ${token}`, ...json }, body: JSON.stringify(body) });
    if (response.status !== 200) throw new Error(`helper ${path} returned ${response.status}`);
    return await response.json() as T;
  };
  const post = (path: string, body: object, extra: Record<string, string> = {}) =>
    fetch(new URL(path, origin), { method: "POST", headers: { origin, ...json, ...extra }, body: JSON.stringify(body), redirect: "manual" });
  async function signIn() {
    const email = `${randomUUID()}@example.invalid`;
    await post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
    const { code } = await seed<{ code: string | null }>("/code", { to: email });
    const response = await post("/api/auth/sign-in/email-otp", { email, otp: code });
    const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const session = await (await fetch(new URL("/api/auth/get-session", origin), { headers: { cookie } })).json() as { user: { id: string } };
    await seed("/workspace", { user: session.user.id, name: `Load ministry ${randomUUID().slice(0, 8)}` });
    return cookie;
  }
  const users = [await signIn(), await signIn()];
  const paths = ["/workspaces", "/sign-in", "/workspaces", "/api/workspaces"];
  const timings: number[] = [];
  const statuses = new Map<number, number>();
  let errors = 0, next = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < total) {
      const i = next++;
      const path = paths[i % paths.length];
      const t0 = performance.now();
      try {
        const response = await fetch(new URL(path, origin), { headers: path === "/sign-in" ? {} : { cookie: users[i % 2] }, redirect: "manual" });
        await response.arrayBuffer();
        statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
        if (response.status >= 500) errors++;
      } catch { errors++; }
      timings.push(performance.now() - t0);
    }
  }));
  const seconds = (performance.now() - started) / 1000;
  timings.sort((a, b) => a - b);
  const at = (q: number) => Math.round(timings[Math.min(timings.length - 1, Math.floor(q * timings.length))]);
  console.log(JSON.stringify({
    requests: timings.length, concurrency, seconds: Math.round(seconds * 10) / 10, perSecond: Math.round(timings.length / seconds * 10) / 10,
    p50ms: at(0.5), p95ms: at(0.95), p99ms: at(0.99), maxMs: Math.round(timings.at(-1) ?? 0), errors5xx: errors,
    statuses: Object.fromEntries(statuses),
  }));
}
