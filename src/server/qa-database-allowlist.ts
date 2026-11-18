type PreviewDatabase = {
  branch: "vercel-preview";
  branchId: string;
  directHost: string;
  pooledHost: string;
  database: string;
};

// Populate from verified Neon compute metadata for vercel-preview only.
// An empty allow-list keeps both QA seeding and preview sign-in disabled.
export const qaPreviewDatabases: readonly PreviewDatabase[] = [];

export function qaDatabaseAllowed(value: string | undefined, mode: "preview" | "local",
  allowlist = qaPreviewDatabases): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hash ||
      [...url.searchParams.keys()].some((key) => key !== "sslmode" && key !== "channel_binding")) return false;
    if (mode === "local") {
      return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && /^\/harvest_test(?:_[a-z0-9]+)*$/.test(url.pathname);
    }
    return (!url.port || url.port === "5432") && allowlist.some((item) =>
      item.branch === "vercel-preview" && item.branchId === "br-shy-hall-baslhh18" &&
      url.pathname === `/${item.database}` && [item.directHost, item.pooledHost].includes(url.hostname));
  } catch {
    return false;
  }
}
