import { expect, test } from "@playwright/test";

// Signed-out checks: the site is up, serves the sign-in screen and its install manifest.
test("sign-in screen is served", async ({ request }) => {
  const response = await request.get("/sign-in");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");
  expect(await response.text()).toContain("Sign in to Harvest");
});

test("install manifest is served", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  expect((await response.json()).name).toBeTruthy();
});

test("auth answers for a signed-out visitor", async ({ request }) => {
  const response = await request.get("/api/auth/get-session");
  expect(response.status()).toBe(200);
  expect(await response.json()).toBeNull();
});

test("signed-out visitors cannot list workspaces", async ({ request }) => {
  expect((await request.get("/api/workspaces")).status()).toBe(401);
});
