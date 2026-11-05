import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
export const origin = "http://127.0.0.1:3100";
export async function signIn(page: Page) {
  const email = `pr03-${randomUUID()}@example.test`;
  const [a, b, c] = createHash("sha256").update(email).digest();
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `10.${a}.${b}.${c}` });
  expect((await page.request.post("/api/auth/email-otp/send-verification-otp", { headers: { origin }, data: { email, type: "sign-in" } })).status()).toBe(200);
  let code = "";
  await expect.poll(async () => {
    const lines = (await readFile(process.env.HARVEST_E2E_MAILBOX!, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
    code = lines.map((line) => JSON.parse(line)).find((mail) => mail.to === email)?.text.match(/\b\d{6}\b/)?.[0] ?? "";
    return code.length;
  }).toBe(6);
  expect((await page.request.post("/api/auth/sign-in/email-otp", { headers: { origin }, data: { email, otp: code } })).status()).toBe(200);
  return email;
}
