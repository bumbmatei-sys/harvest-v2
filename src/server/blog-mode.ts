/** The blog's editor, owner API and public pages are development-only until activated: never in production (the link-in-bio and Docs gate). */
export function blogEnabled(env: Record<string, string | undefined> = process.env) { return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production" && env.HARVEST_ENV !== "production"; }

/**
 * The scheduled-publish job runs only where it is switched on by hand (`HARVEST_BLOG_PUBLISH_ENABLED=1`) in development, test or a preview, never in
 * production. It changes articles from scheduled to published and sends nothing anywhere.
 */
export function blogPublishWorkerEnabled(env: Record<string, string | undefined> = process.env) {
  return blogEnabled(env) && env.HARVEST_BLOG_PUBLISH_ENABLED === "1" && (env.NODE_ENV === "development" || env.NODE_ENV === "test" || env.VERCEL_ENV === "preview");
}
