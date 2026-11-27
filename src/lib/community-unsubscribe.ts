// C15c: the unsubscribe link carries its token in the URL fragment (`/communities/unsubscribe#token=...`), so the token never
// reaches the server, a log or a Referer on GET. The page reads it in the browser and posts it only when the person confirms.
const tokenShape = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** The token from a location hash, or null when it is missing or cannot be a token. Never says which. */
export function unsubscribeTokenFromHash(hash: string): string | null {
  if (typeof hash !== "string" || hash.length > 700) return null;
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token && token.length <= 600 && tokenShape.test(token) ? token : null;
}
