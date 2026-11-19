type PreviewDatabase = {
  branch: "vercel-preview";
  branchId: string;
  directHost: string;
  pooledHost?: string;
  database: string;
};

// Verified against the Neon branch, compute and database records.
export const qaPreviewDatabases: readonly PreviewDatabase[] = [{
  branch: "vercel-preview",
  branchId: "br-shy-hall-baslhh18",
  directHost: "ep-misty-pond-ba96mdcl.c-8.eu-central-1.aws.neon.tech",
  database: "harvest",
}];

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

export function qaSeedDatabaseUrl(env: Record<string, string | undefined>): string {
  const { DATABASE_URL: url, NODE_ENV, VERCEL_ENV } = env;
  if (!url || NODE_ENV === "production" || VERCEL_ENV === "production" || !qaDatabaseAllowed(url, "preview")) {
    throw new Error("QA_SEED_INVALID_TARGET");
  }
  return url;
}
