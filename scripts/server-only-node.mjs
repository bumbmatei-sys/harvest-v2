// Node scripts that call server modules directly (the QA fake-data seed) run outside Next.js, where "server-only"
// would throw. Like the Workers alias (cloudflare/server-only.mjs), resolve it to an empty module for this process only.
import { register } from "node:module";
const hook = `export async function resolve(specifier, context, next) {
  return specifier === "server-only" ? { url: "data:text/javascript,export{}", shortCircuit: true } : next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);
