import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getPublicLanding, getStarterResource, previewPublicCode, starterResources } from "../../src/lib/connect-public";

describe("Connect public presentation boundary", () => {
  it("resolves only the exact published opaque preview code", () => {
    expect(previewPublicCode).toMatch(/^[a-f0-9]{32}$/);
    expect(getPublicLanding(previewPublicCode)).toEqual({
      version: 1, source: "starter-preview", publication: "published",
      publicCode: previewPublicCode, locale: "en", resourceIds: starterResources.map(({ id }) => id),
    });
  });

  it("rejects generated codes unless they exactly match the case-sensitive allowlist", () => {
    const codes = new Set(["", " ", "\t\n", "__proto__", "constructor", "0".repeat(32), previewPublicCode.toUpperCase()]);
    for (const state of ["draft", "unpublished", "disabled", "archived", "unknown"]) {
      for (const suffix of ["", "-preview", `-${previewPublicCode}`]) codes.add(`${state}${suffix}`);
    }
    // Reproducible pseudorandom samples across lengths, hex codes, UUIDs and Unicode.
    for (let seed = 0; seed < 1024; seed++) {
      const bytes = createHash("sha256").update(`connect-public-${seed}`).digest();
      codes.add(bytes.toString("hex").slice(0, seed % 65));
      codes.add(`${bytes.toString("hex", 0, 4)}-${bytes.toString("hex", 4, 6)}-4${bytes.toString("hex", 6, 8).slice(1)}-8${bytes.toString("hex", 8, 10).slice(1)}-${bytes.toString("hex", 10, 16)}`);
      codes.add(Array.from(bytes, (byte) => String.fromCharCode(byte * 257)).join(""));
    }
    // Exhaust single-position changes and prefix/suffix variants of the real code.
    for (let index = 0; index < previewPublicCode.length; index++) {
      codes.add(previewPublicCode.slice(0, index) + previewPublicCode.slice(index + 1));
      for (const char of "0123456789abcdefABCDEF \t\n\0\u200b/<>%") {
        codes.add(previewPublicCode.slice(0, index) + char + previewPublicCode.slice(index + 1));
        codes.add(char + previewPublicCode);
        codes.add(previewPublicCode + char);
      }
    }
    for (const code of codes) {
      if (code !== previewPublicCode) expect(getPublicLanding(code), JSON.stringify(code)).toBeUndefined();
    }
  });

  it("keeps all Connect public copy consumers free of raw HTML injection", () => {
    const repo = fileURLToPath(new URL("../../", import.meta.url));
    for (const directory of ["src/app/c", "src/app/s", "src/app/resources", "src/components/connect", "src/components/connect-admin", "src/app/workspaces/[tenantId]/campaigns/[campaignId]/connect"]) {
      const root = join(repo, directory);
      const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((file) => /\.[cm]?[jt]sx?$/.test(file));
      expect(files.length, directory).toBeGreaterThan(0);
      for (const file of files) {
        expect(readFileSync(join(root, file), "utf8"), `${directory}/${file}`).not.toMatch(/\bdangerouslySetInnerHTML\b/);
      }
    }
  });

  it("allows only the curated resource ids, without arbitrary property lookup", () => {
    for (const { id } of starterResources) expect(getStarterResource(id)?.id).toBe(id);
    for (const id of ["__proto__", "constructor", "private", "1", "../common-questions"]) expect(getStarterResource(id)).toBeUndefined();
    expect(new Set(starterResources.map(({ id }) => id)).size).toBe(starterResources.length);
  });
});
