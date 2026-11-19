import { communitiesEnabled } from "./communities-mode";

export function freeCatalogEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production" && communitiesEnabled(env);
}
