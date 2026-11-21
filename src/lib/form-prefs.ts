// Per-viewer conveniences for the Forms list: starred forms and when each form was last opened in this browser. Stored in localStorage only
// (never on the server), so it can be empty or unavailable; every read and write is guarded.
export type FormPrefs = { favorites: string[]; viewed: Record<string, number> };
export const emptyPrefs: FormPrefs = { favorites: [], viewed: {} };
export const prefsKey = (tenantId: string) => `harvest:crm-forms:${tenantId}`;
const MAX = 200;

export function parsePrefs(raw: string | null): FormPrefs {
  if (!raw) return emptyPrefs;
  try {
    const value = JSON.parse(raw) as Partial<FormPrefs>;
    const favorites = Array.isArray(value.favorites) ? value.favorites.filter((id): id is string => typeof id === "string").slice(0, MAX) : [];
    const viewed: Record<string, number> = {};
    if (value.viewed && typeof value.viewed === "object") for (const [id, at] of Object.entries(value.viewed).slice(0, MAX)) if (typeof at === "number" && Number.isFinite(at)) viewed[id] = at;
    return { favorites, viewed };
  } catch { return emptyPrefs; }
}
export const toggleFavorite = (prefs: FormPrefs, id: string): FormPrefs =>
  ({ ...prefs, favorites: prefs.favorites.includes(id) ? prefs.favorites.filter((f) => f !== id) : [...prefs.favorites, id] });
export function touchViewed(prefs: FormPrefs, id: string, now: number): FormPrefs {
  const entries = Object.entries({ ...prefs.viewed, [id]: now }).sort((a, b) => b[1] - a[1]).slice(0, MAX);
  return { ...prefs, viewed: Object.fromEntries(entries) };
}
/** Form ids, most recently opened first. */
export const recents = (prefs: FormPrefs, limit = 5) => Object.entries(prefs.viewed).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);

export function readPrefs(tenantId: string): string | null { try { return localStorage.getItem(prefsKey(tenantId)); } catch { return null; } }
export function writePrefs(tenantId: string, prefs: FormPrefs) {
  try { localStorage.setItem(prefsKey(tenantId), JSON.stringify(prefs)); window.dispatchEvent(new Event("harvest-form-prefs")); } catch { /* storage unavailable: the list still works */ }
}
