import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { downloadExpiry } from "../../src/server/storage/adapter";
import { exportFileName } from "../../src/server/your-data";

it("keeps signed download links between one minute and one hour", () => {
  expect(downloadExpiry()).toBe(60);
  expect(downloadExpiry(10)).toBe(60);
  expect(downloadExpiry(3600)).toBe(3600);
  expect(downloadExpiry(86_400)).toBe(3600);
  expect(downloadExpiry(90.7)).toBe(90);
});

it("names the export by its UTC date", () => {
  expect(exportFileName(new Date("2026-11-27T23:30:00Z"))).toBe("harvest-data-2026-11-27.json");
});
