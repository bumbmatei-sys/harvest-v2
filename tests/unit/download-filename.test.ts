import { describe, expect, it, vi } from "vitest";
import { downloadDisposition } from "../../src/lib/download-filename";
import { csvResponse } from "../../src/server/csv-response";
import { S3Storage } from "../../src/server/storage/s3";

vi.mock("server-only", () => ({}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async (_client, command) => command.input.ResponseContentDisposition),
}));

const cases = [
  ["..", "download"], ["../", "download"], ["..\\", "download"],
  ["", "download"], ["  ", "download"], [".", "download"],
  ["../report.csv", "__report.csv"], ["..\\report.csv", "__report.csv"],
  ["folder/report.csv", "folder_report.csv"], ["folder\\report.csv", "folder_report.csv"],
  ["bad\r\nX-Evil: yes.csv", "bad__X-Evil_ yes.csv"],
  ['say "hello".csv', "say _hello_.csv"], ["bad\u0000\u007f.csv", "bad__.csv"],
  ["report\u202e.csv", "report_.csv"], ["%2e%2e%2freport.csv", "_2e_2e_2freport.csv"],
  ["people-2026-11-07.csv", "people-2026-11-07.csv"],
  ["München 日本 🌱.csv", "München 日本 🌱.csv"],
  ["O'Brien (final).csv", "O'Brien (final).csv"],
  ["می\u200cخواهم.csv", "می\u200cخواهم.csv"], ["👨\u200d👩\u200d👧 family.csv", "👨\u200d👩\u200d👧 family.csv"],
  ["a\u2028b\u2029c.csv", "a_b_c.csv"], ["\ufeffbom\u200b.csv", "_bom_.csv"], ["lone\ud800.csv", "lone\ufffd.csv"],
  ["semi;colon=\"x\".csv", "semi;colon=_x_.csv"],
  ["\u200d", "download"], ["\u200c\u200d\u200d", "download"],
  ["../input-problems.csv", "__input-problems.csv"],
] as const;

function check(header: string, expected: string) {
  expect(header).toMatch(/^attachment; filename="[^"\\\r\n]+"; filename\*=UTF-8''/);
  const encoded = header.split("filename*=UTF-8''")[1];
  expect(decodeURIComponent(encoded)).toBe(expected);
  expect(header).not.toMatch(/[\r\n\u0000-\u001f\u007f]/);
  expect(header).not.toContain("..");
  return header;
}

describe("actual download header boundaries", () => {
  it.each(cases)("CSV export/report name %j becomes %j", async (name, expected) => {
    const body = '\ufeffName,Notes\r\nAda,"unchanged"\r\n';
    const response = csvResponse(name, body);
    check(response.headers.get("Content-Disposition")!, expected);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(body));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it.each(cases)("private download signer receives a safe disposition for %j", async (name, expected) => {
    // The signer is mocked: no storage request, credentials, or delivery.
    const storage = new S3Storage({ endpoint: "http://localhost:9000", bucket: "test", region: "test", accessKeyId: "test", secretAccessKey: "test" });
    check(await storage.presignDownload("workspaces/test/files/test", name), expected);
  });

  it("pins the quoted ASCII fallback next to the exact filename* value", () => {
    expect(downloadDisposition("München 日本 🌱.csv")).toBe(
      `attachment; filename="M_nchen __ __.csv"; filename*=UTF-8''M%C3%BCnchen%20%E6%97%A5%E6%9C%AC%20%F0%9F%8C%B1.csv`);
    expect(downloadDisposition("O'Brien (final).csv")).toBe(
      `attachment; filename="O'Brien (final).csv"; filename*=UTF-8''O%27Brien%20%28final%29.csv`);
    expect(downloadDisposition("../a\r\nb.csv")).toBe(`attachment; filename="__a__b.csv"; filename*=UTF-8''__a__b.csv`);
  });
});
