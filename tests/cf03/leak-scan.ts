import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const excludedClientMarkers = ["HARVEST_E2E_MAILBOX", "qa.harvest.invalid", "qa1.", "cf03-mailbox-only",
  "FILE_GRANT_SECRET", "RESEND_API_KEY", "APP_HYPERDRIVE", "QA_SIGN_IN_HELPER_SECRET"];

export function checkForLeaks(surface: string, value: string, needles: readonly string[]) {
  if (needles.some((needle) => needle.length > 0 && value.includes(needle))) {
    throw new Error(`Unexpected private material in ${surface}`);
  }
}

export async function checkClientAssets(directory: string, needles: readonly string[]) {
  let scanned = 0;
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:js|css|json|map|html)$/.test(entry.name)) continue;
    const content = await readFile(join(entry.parentPath, entry.name), "utf8");
    checkForLeaks("client asset", content, [...needles, ...excludedClientMarkers]);
    scanned++;
  }
  if (!scanned) throw new Error("No client assets were scanned");
  return scanned;
}
