import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { getDb, withDb, type DatabaseEnvironment } from "../db/client";
import { getRequestDb } from "../db/request";
import { requiredEnv } from "../lib/env";
import { makeAuth } from "./auth";

const parseList = (value?: string) => value?.split(",").map((item) => item.trim()).filter(Boolean);
type Auth = ReturnType<typeof makeAuth>;
export type WorkerRequestEnvironment = Omit<Extract<DatabaseEnvironment, { runtime: "workers" }>, "runtime" | "role"> & {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  AUTH_IP_ADDRESS_HEADERS?: string;
  AUTH_TRUSTED_PROXIES?: string;
  cookiePrefix?: string;
  mail?: Parameters<typeof makeAuth>[1]["mail"];
};
const requestAuth = new AsyncLocalStorage<{ get: () => Auth }>();
let nodeAuth: Auth | undefined;

/** Worker entry point for buffered handlers. Await all DB work before returning. */
export function withWorkerRequest<T>(env: WorkerRequestEnvironment, request: Request, run: () => Promise<T>) {
  if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) throw new Error("WORKER_AUTH_CONFIGURATION_REQUIRED");
  return withDb({ runtime: "workers", role: "app", APP_HYPERDRIVE: env.APP_HYPERDRIVE, database: env.database }, async (db) => {
    let auth: Auth | undefined;
    return requestAuth.run({
      get: () => auth ??= makeAuth(db, {
        secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL,
        cookiePrefix: env.cookiePrefix, mail: env.mail,
        ipAddressHeaders: parseList(env.AUTH_IP_ADDRESS_HEADERS), trustedProxies: parseList(env.AUTH_TRUSTED_PROXIES),
      }),
    }, run);
  }, { signal: request.signal });
}

export function getAuth(): Auth {
  const scoped = requestAuth.getStore();
  if (scoped) return scoped.get();
  // Never cache auth built around a database handle that will be closed.
  if (getRequestDb()) throw new Error("AUTH_REQUEST_SCOPE_REQUIRED");
  return nodeAuth ??= makeAuth(getDb(), {
    secret: requiredEnv("BETTER_AUTH_SECRET"), baseURL: requiredEnv("BETTER_AUTH_URL"),
    ipAddressHeaders: parseList(process.env.AUTH_IP_ADDRESS_HEADERS), trustedProxies: parseList(process.env.AUTH_TRUSTED_PROXIES),
  });
}
