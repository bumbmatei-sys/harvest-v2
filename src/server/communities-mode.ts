// ADR 0013 §11: Communities stay off in production until the founder activates them by setting
// HARVEST_COMMUNITIES=enabled. Local development and tests have them on.
export function communitiesEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production" || env.HARVEST_COMMUNITIES === "enabled";
}
