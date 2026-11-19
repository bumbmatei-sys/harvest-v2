import { expect, it } from "vitest";
import { localQaOrigin, qaWalkthroughOrigin } from "../qa/preview-origin";

const pin = "harvest-preview.example.test";
const hosting = { CI: "true", QA_PREVIEW_HOST: pin, QA_PREVIEW_URL: `https://${pin}` };

it("uses a loopback development server only when a preview origin was omitted outside CI", () => {
  expect(qaWalkthroughOrigin({})).toBe(localQaOrigin);
  expect(() => qaWalkthroughOrigin({ CI: "true" })).toThrow();
});
it("accepts only the configured bare and pinned HTTPS origin", () => {
  expect(qaWalkthroughOrigin(hosting)).toBe(`https://${pin}`);
  expect(qaWalkthroughOrigin({ ...hosting, QA_PREVIEW_URL: hosting.QA_PREVIEW_URL + "/" })).toBe(hosting.QA_PREVIEW_URL);
  expect(() => qaWalkthroughOrigin({ ...hosting, QA_PREVIEW_HOST: undefined })).toThrow();
});
it.each([
  "https://other.example.test",
  `https://${pin}.other.example.test`,
  `https://${pin}@other.example.test`,
  `https://other.example.test@${pin}`,
  `http://${pin}`,
  `https://${pin}:444`,
  `https://${pin}/api/qa/otp`,
  `https://${pin}/?query=1`,
  `https://${pin}/#test`,
])("rejects a URL outside the pinned origin", (url) => {
  expect(() => qaWalkthroughOrigin({ ...hosting, QA_PREVIEW_URL: url })).toThrow();
});
