// Shell slice 2: the three-mode switcher stays off in production until the founder accepts it
// (HARVEST_SHELL_MODES=enabled). Local development and tests have it on; `disabled` forces the
// previous single sidebar anywhere, which is how the flag-off parity run is made.
export function shellModesEnabled(env: Record<string, string | undefined> = process.env) {
  if (env.HARVEST_SHELL_MODES === "disabled") return false;
  return env.NODE_ENV !== "production" || env.HARVEST_SHELL_MODES === "enabled";
}
