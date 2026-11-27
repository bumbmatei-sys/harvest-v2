import "server-only";
import { siteAddresses, siteAddressScope } from "../lib/site-address";
import { sharedScope } from "../lib/shared-scope";
import { getDb, withDb, type DatabaseEnvironment } from "../db/client";
import { getRequestDb } from "../db/request";
import { requiredEnv } from "../lib/env";
import { makeAuth } from "./auth";

const parseList = (value?: string) => value?.split(",").map((item) => item.trim()).filter(Boolean);
type Auth = ReturnType<typeof makeAuth>;
export type WorkerRequestEnvironment = Omit<Extract<DatabaseEnvironment, { runtime: "workers" }>, "runtime" | "role"> & {
  BETTER_AUTH_SECRET: string;
  addresses: ReturnType<typeof siteAddresses>;
  AUTH_IP_ADDRESS_HEADERS?: string;
  AUTH_TRUSTED_PROXIES?: string;
  cookiePrefix?: string;
  mail?: Parameters<typeof makeAuth>[1]["mail"];
};
const requestAuth = sharedScope<{ get: () => Auth }>("request-auth");
let nodeAuth: Auth | undefined;

/** Worker entry point for buffered handlers. Await all DB work before returning. */
export function withWorkerRequest<T>(env: WorkerRequestEnvironment, request: Request, run: () => Promise<T>) {
  if (!env.BETTER_AUTH_SECRET) throw new Error("WORKER_AUTH_CONFIGURATION_REQUIRED");
  return withDb({ runtime: "workers", role: "app", APP_HYPERDRIVE: env.APP_HYPERDRIVE, database: env.database }, async (db) => {
    let auth: Auth | undefined;
    return siteAddressScope.run(env.addresses, () => requestAuth.run({
      get: () => auth ??= makeAuth(db, {
        secret: env.BETTER_AUTH_SECRET, baseURL: env.addresses.app, trustedOrigins: env.addresses.trustedOrigins, cookieDomain: env.addresses.cookieDomain,
        cookiePrefix: env.cookiePrefix, mail: env.mail,
        ipAddressHeaders: parseList(env.AUTH_IP_ADDRESS_HEADERS), trustedProxies: parseList(env.AUTH_TRUSTED_PROXIES),
      }),
    }, run));
  }, { signal: request.signal });
}

export function getAuth(): Auth {
  const scoped = requestAuth.getStore();
  if (scoped) return scoped.get();
  // Never cache auth built around a database handle that will be closed.
  if (getRequestDb()) throw new Error("AUTH_REQUEST_SCOPE_REQUIRED");
  const addresses = siteAddresses();
  return nodeAuth ??= makeAuth(getDb(), {
    secret: requiredEnv("BETTER_AUTH_SECRET"), baseURL: addresses.app, trustedOrigins: addresses.trustedOrigins, cookieDomain: addresses.cookieDomain,
    ipAddressHeaders: parseList(process.env.AUTH_IP_ADDRESS_HEADERS), trustedProxies: parseList(process.env.AUTH_TRUSTED_PROXIES),
  });
}
