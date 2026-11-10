import { describe, expect, it } from "vitest";
import { deployedCommit } from "../../src/lib/deployed-commit";
import { isReadOnlyMethod, smokeConfig } from "../smoke/smoke-config";

const sha = "0123456789abcdef0123456789abcdef01234567";
const signedIn = { HARVEST_SMOKE_SESSION_TOKEN: "tok.sig=", HARVEST_SMOKE_EMAIL: "Smoke@Example.test", HARVEST_SMOKE_WORKSPACE: "Smoke Church" };

describe("deployed commit", () => {
  it("returns only a full Git SHA", () => {
    expect(deployedCommit({ VERCEL_GIT_COMMIT_SHA: sha.toUpperCase() })).toBe(sha);
    expect(deployedCommit({ VERCEL_GIT_COMMIT_SHA: "abc123" })).toBeNull();
    expect(deployedCommit({})).toBeNull();
  });
});

describe("production smoke configuration", () => {
  it("requires an https bare origin", () => {
    expect(() => smokeConfig({})).toThrow("HARVEST_SMOKE_BASE_URL is required");
    expect(() => smokeConfig({ HARVEST_SMOKE_BASE_URL: "http://app.example" })).toThrow("https");
    expect(() => smokeConfig({ HARVEST_SMOKE_BASE_URL: "https://app.example/workspaces" })).toThrow("bare origin");
    expect(() => smokeConfig({ HARVEST_SMOKE_BASE_URL: "https://user:pw@app.example" })).toThrow("bare origin");
    expect(smokeConfig({ HARVEST_SMOKE_BASE_URL: "https://app.example/" }).baseURL).toBe("https://app.example");
  });
  it("allows plain http only for an explicit local run", () => {
    expect(() => smokeConfig({ HARVEST_SMOKE_BASE_URL: "http://127.0.0.1:3100" })).toThrow("https");
    expect(smokeConfig({ HARVEST_SMOKE_BASE_URL: "http://127.0.0.1:3100", HARVEST_SMOKE_ALLOW_HTTP: "1" }).sessionCookie).toBeNull();
    expect(() => smokeConfig({ HARVEST_SMOKE_BASE_URL: "http://app.example", HARVEST_SMOKE_ALLOW_HTTP: "1" })).toThrow("https");
  });
  it("needs every signed-in setting together, and never echoes the token", () => {
    const base = { HARVEST_SMOKE_BASE_URL: "https://app.example" };
    expect(() => smokeConfig({ ...base, HARVEST_SMOKE_SESSION_TOKEN: "secret-value" })).toThrow(/all of/);
    try { smokeConfig({ ...base, HARVEST_SMOKE_SESSION_TOKEN: "secret-value" }); } catch (error) { expect(String(error)).not.toContain("secret-value"); }
    expect(() => smokeConfig({ ...base, HARVEST_SMOKE_REQUIRE_SIGNED_IN: "1" })).toThrow("required");
    const config = smokeConfig({ ...base, ...signedIn });
    expect(config.sessionCookie).toEqual({ name: "__Secure-better-auth.session_token", value: "tok.sig%3D" });
    expect(config.email).toBe("smoke@example.test");
    expect(smokeConfig({ ...base, ...signedIn, HARVEST_SMOKE_SESSION_TOKEN: "tok.sig%3D" }).sessionCookie?.value).toBe("tok.sig%3D");
  });
  it("treats only safe methods as read-only", () => {
    expect(["GET", "head", "OPTIONS"].every(isReadOnlyMethod)).toBe(true);
    expect(["POST", "PUT", "PATCH", "DELETE"].some(isReadOnlyMethod)).toBe(false);
  });
});
