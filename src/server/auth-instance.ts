import "server-only";
import { getDb } from "../db/client";
import { requiredEnv } from "../lib/env";
import { makeAuth } from "./auth";
const envList = (name: string) => process.env[name]?.split(",").map((value) => value.trim()).filter(Boolean);
let auth: ReturnType<typeof makeAuth> | undefined;
export function getAuth() {
  return auth ??= makeAuth(getDb(), { secret: requiredEnv("BETTER_AUTH_SECRET"), baseURL: requiredEnv("BETTER_AUTH_URL"),
    ipAddressHeaders: envList("AUTH_IP_ADDRESS_HEADERS"), trustedProxies: envList("AUTH_TRUSTED_PROXIES") });
}
