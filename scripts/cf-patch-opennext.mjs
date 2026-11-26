// CF-07: run after `opennextjs-cloudflare build`. OpenNext 1.20.18 (@opennextjs/aws 4.2.0) bundles its edge converter's
// `import cookie from "cookie"` without Node's CommonJS interop, and cookie 1.x marks itself __esModule with no default,
// so `cookie.default.parse` is undefined and every request with a Cookie header throws before reaching the app.
// Replace exactly that call with one that falls back to the module itself; fail if the build no longer matches.
import { readFile, writeFile } from "node:fs/promises";

const files = [".open-next/middleware/handler.mjs", ".open-next/server-functions/default/handler.mjs", ".open-next/server-functions/default/index.mjs"];
const broken = "import_cookie.default.parse(";
const fixed = "(import_cookie.default ?? import_cookie).parse(";
let patched = 0;
for (const file of files) {
  const source = await readFile(file, "utf8").catch(() => undefined);
  if (source === undefined) continue;
  const count = source.split(broken).length - 1;
  if (count > 1) throw new Error(`Unexpected OpenNext output in ${file}: ${count} cookie parse calls`);
  if (count === 1) { await writeFile(file, source.replace(broken, fixed)); patched++; }
}
if (patched === 0) throw new Error("OpenNext output changed: no cookie parse call to patch; re-check CF-07 before removing this step");
console.log(`Patched the OpenNext cookie import in ${patched} file(s)`);
