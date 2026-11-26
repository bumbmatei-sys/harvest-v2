import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { origin } from "./helpers/session";

// QA-2: the test sign-in shortcut on the local test server. A seeded synthetic account signs in without email; the
// route is hidden without the token and refuses real-looking addresses.
test("signs a seeded synthetic account in without email", async ({ page }) => {
  test.setTimeout(240_000); // the dev server compiles the route on its first request
  const token = await readFile(`${process.env.HARVEST_E2E_MAILBOX}.qa-token`, "utf8");
  const id = randomUUID();
  const email = `${id}@example.invalid`;
  const admin = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await admin.connect();
  try { await admin.query("insert into users(id,name,email,email_verified) values ($1,'Avery Sample 99',$2,true)", [id, email]); } finally { await admin.end(); }
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `10.99.${Math.floor(Math.random() * 250)}.7` });

  expect((await page.request.post("/api/qa/sign-in", { headers: { origin }, data: { email } })).status()).toBe(404);
  expect((await page.request.post("/api/qa/sign-in", { headers: { origin, "x-qa-preview-token": token }, data: { email: "someone@gmail.com" } })).status()).toBe(422);
  const signed = await page.request.post("/api/qa/sign-in", { headers: { origin, "x-qa-preview-token": token }, data: { email } });
  expect(signed.status()).toBe(204);
  expect(signed.headers()["cache-control"]).toBe("no-store");

  await page.goto("/workspaces");
  await expect(page).not.toHaveURL(/\/sign-in/);
  const mailbox = await readFile(process.env.HARVEST_E2E_MAILBOX!, "utf8").catch(() => "");
  expect(mailbox).not.toContain(email);
});
