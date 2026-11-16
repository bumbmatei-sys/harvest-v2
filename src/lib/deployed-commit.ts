/** The Git commit this deployment was built from. Vercel sets it; elsewhere it is null. */
export function deployedCommit(env: Record<string, string | undefined> = process.env) {
  const commit = env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
  return commit && /^[0-9a-f]{40}$/.test(commit) ? commit : null;
}
