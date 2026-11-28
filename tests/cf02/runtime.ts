import { readSiteAddresses } from "../../src/lib/site-address";
import { getDb } from "../../src/db/client";
import { getAuth, withWorkerRequest } from "../../src/server/auth-instance";
import { getRequestDb, withDb, type DatabaseEnvironment } from "../../src/db/request";
import { makeAuth } from "../../src/server/auth";
import type { IsolationRuntime } from "./isolation";

const baseURL = "http://localhost:3000";
export function isolationRuntime(app: DatabaseEnvironment, worker: DatabaseEnvironment, secret: string, requestSignal?: AbortSignal): IsolationRuntime {
  return {
    app: (work, options) => withDb(app, work, {
      ...options,
      signal: requestSignal && options?.signal ? AbortSignal.any([requestSignal, options.signal]) : (options?.signal ?? requestSignal),
    }),
    worker: (work) => withDb(worker, work, { signal: requestSignal }),
    authSecret: secret,
    session: (headers) => {
      if (app.runtime === "node") return withDb(app, (db) => makeAuth(db, { secret, baseURL }).api.getSession({ headers }));
      const request = new Request(`${baseURL}/api/auth/get-session`, { headers, signal: requestSignal });
      return withWorkerRequest({
        APP_HYPERDRIVE: app.APP_HYPERDRIVE,
        BETTER_AUTH_SECRET: secret, addresses: readSiteAddresses({ BETTER_AUTH_URL: baseURL }),
      }, request, () => {
        if (getDb() !== getRequestDb()) throw new Error("Database escaped the request scope");
        if (getAuth() !== getAuth()) throw new Error("Auth instance changed within one request");
        return getAuth().api.getSession({ headers: request.headers });
      });
    },
  };
}
