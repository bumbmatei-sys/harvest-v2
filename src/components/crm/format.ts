/** Up to two initials for an avatar fallback; never user-facing copy. */
export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("").toUpperCase();
}
