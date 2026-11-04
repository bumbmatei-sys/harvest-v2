import "server-only";
import { getDb } from "../db/client";
import { requiredEnv } from "../lib/env";
import { makeAuth } from "./auth";
let auth: ReturnType<typeof makeAuth> | undefined;
export function getAuth() {
  return auth ??= makeAuth(getDb(), { secret: requiredEnv("BETTER_AUTH_SECRET"), baseURL: requiredEnv("BETTER_AUTH_URL") });
}
