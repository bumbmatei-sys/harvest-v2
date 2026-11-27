/**
 * An "Open in maps" link built from free-text location (an address or place name). Nothing is geocoded or embedded:
 * the text goes into a universal maps search link that opens the viewer's maps app or a maps site. Returns null for blank text.
 */
export function mapsHref(location: string | null | undefined): string | null {
  const text = location?.trim();
  if (!text) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
}
