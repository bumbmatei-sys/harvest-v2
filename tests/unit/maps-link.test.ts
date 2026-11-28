import { expect, it } from "vitest";
import { mapsHref } from "../../src/lib/maps-link";

it("builds an Open in maps link from location text and nothing from blank text", () => {
  expect(mapsHref("12 Main Street, Springfield")).toBe("https://www.google.com/maps/search/?api=1&query=12%20Main%20Street%2C%20Springfield");
  expect(mapsHref("  Café & Hall #2  ")).toBe("https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20%26%20Hall%20%232");
  for (const blank of [null, undefined, "", "   "]) expect(mapsHref(blank)).toBeNull();
});
