/** Ways to give (CW-10): the owner screen, its API and the public block are development-only until activated, never in production (same gate as link in bio). */
export function waysToGiveEnabled(env: Record<string, string | undefined> = process.env) { return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production" && env.HARVEST_ENV !== "production"; }
