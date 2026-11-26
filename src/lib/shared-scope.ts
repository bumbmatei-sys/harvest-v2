import { AsyncLocalStorage } from "node:async_hooks";

// On Workers the CF-07 entry and the OpenNext-bundled app each carry their own copy of a module, so a module-level
// AsyncLocalStorage would differ between them and the app would never see the entry's request scope. Keep one instance
// per name on globalThis under a registered symbol; in Node there is a single bundle and this changes nothing.
export function sharedScope<T>(name: string): AsyncLocalStorage<T> {
  const key = Symbol.for(`harvest.scope.${name}`);
  const holder = globalThis as unknown as Record<symbol, AsyncLocalStorage<T> | undefined>;
  return holder[key] ??= new AsyncLocalStorage<T>();
}
