import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fileKey, MAX_FILE_SIZE, uploadInput } from "../../src/lib/files";
const valid = { name: "report.pdf", mime: "application/pdf", size: 1024, checksum: "a".repeat(64) };
describe("file upload invariants", () => {
  it("generates isolated keys without filenames or client paths", () => {
    const a = randomUUID(), b = randomUUID(), file = randomUUID();
    expect(fileKey(a, file)).toBe(`workspaces/${a}/files/${file}`);
    expect(fileKey(a, file)).not.toBe(fileKey(b, file));
    expect(() => fileKey("../other", file)).toThrow();
    expect(() => fileKey(a, "../other")).toThrow();
  });
  it("defaults to private and accepts the exact size limit", () => {
    expect(uploadInput.parse({ ...valid, size: MAX_FILE_SIZE }).visibility).toBe("private");
  });
  it("accepts an uppercase extension matching the MIME", () => {
    expect(uploadInput.parse({ ...valid, name: "REPORT.PDF" }).name).toBe("REPORT.PDF");
  });
  it.each([
    { size: 0 }, { size: -1 }, { size: 1.5 }, { size: MAX_FILE_SIZE + 1 },
    { mime: "text/html" }, { mime: "image/svg+xml" }, { mime: "application/x-msdownload" },
    { name: "../report.pdf" }, { name: "C:\\report.pdf" }, { name: "bad\nname" }, { name: " " }, { name: "a".repeat(201) },
    { name: "report.exe" }, { name: "report.txt" }, { name: "pdf" },
    ...["\u061c", "\u200e", "\u200f", "\u202a", "\u202b", "\u202c", "\u202d", "\u202e", "\u2066", "\u2067", "\u2068", "\u2069"].map((control) => ({ name: `report${control}.pdf` })),
    { checksum: "not-sha256" }, { visibility: "unlisted" }, { tenantId: randomUUID() }, { key: "client-key" }, { ownerId: "someone" }, { status: "ready" },
  ])("rejects invalid metadata or injected fields: %j", (change) => {
    expect(uploadInput.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});
