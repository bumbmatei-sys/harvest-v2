import { expect, test } from "@playwright/test";
import { smokeConfig } from "./smoke-config";
import { json, smokeGet } from "./smoke-http";

// Signed-out checks: the site is up, serves the sign-in screen and its install manifest.
const config = smokeConfig();
test("sign-in screen is served", async () => {
  const response = await smokeGet(config, "/sign-in");
  expect(response.status).toBe(200);
  expect(response.contentType).toContain("text/html");
  expect(response.text).toContain("Sign in to Harvest");
});

test("install manifest is served", async () => {
  const response = await smokeGet(config, "/manifest.webmanifest");
  expect(response.status).toBe(200);
  expect((json(response, "/manifest.webmanifest") as { name?: string }).name).toBeTruthy();
});

test("auth answers for a signed-out visitor", async () => {
  const response = await smokeGet(config, "/api/auth/get-session");
  expect(response.status).toBe(200);
  expect(json(response, "/api/auth/get-session")).toBeNull();
});

test("signed-out visitors cannot list workspaces", async () => {
  expect((await smokeGet(config, "/api/workspaces")).status).toBe(401);
});
