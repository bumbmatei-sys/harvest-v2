export const localQaOrigin = "http://127.0.0.1:3100";

export function qaWalkthroughOrigin(env: Record<string, string | undefined>): string {
  const { QA_PREVIEW_URL: configured, QA_PREVIEW_HOST: pinned, CI: ci } = env;
  if (!configured) {
    if (ci) throw new Error("QA preview URL is required in CI.");
    return localQaOrigin;
  }
  if (!pinned || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(pinned)) {
    throw new Error("Configure the exact pinned QA preview hostname.");
  }
  if (configured !== `https://${pinned}` && configured !== `https://${pinned}/`) {
    throw new Error("QA preview URL must match the pinned HTTPS origin.");
  }
  return `https://${pinned}`;
}
